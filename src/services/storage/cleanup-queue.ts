/**
 * PPEye Supabase Storage Service — Compensating Cleanup Queue
 *
 * Provides a best-effort, persistent queue for orphaned storage objects that failed
 * to be removed during compensating cleanups (e.g. due to client-side network drop).
 *
 * ⚠️ ARCHITECTURAL LIMITATION & DURABILITY NOTICE:
 * - This queue is stored in client-side AsyncStorage (or in-memory when AsyncStorage is unavailable).
 * - It is BEST-EFFORT ONLY. It does NOT provide distributed two-phase commit guarantees across
 *   device uninstalls, hard app crashes, or permanent device loss.
 * - Server-side bucket lifecycle policies or background cron tasks are recommended as a secondary
 *   safety net for long-term orphaned object reclamation.
 */

import type { StorageBucket } from './supabase-storage.types';

export interface CleanupTask {
  id: string;
  bucket: StorageBucket;
  storagePath: string;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

const CLEANUP_STORAGE_KEY = 'ppeye_storage_failed_cleanups';
let inMemoryQueue: CleanupTask[] = [];

async function getStorage(): Promise<{ getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void> }> {
  // If running in Node.js headless environment without window/React Native host, use inMemoryQueue
  if (typeof window === 'undefined' && typeof (globalThis as any).nativeCallSyncHook === 'undefined') {
    return {
      getItem: async () => JSON.stringify(inMemoryQueue),
      setItem: async (_k: string, v: string) => {
        inMemoryQueue = JSON.parse(v);
      },
    };
  }

  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    if (AsyncStorage) return AsyncStorage;
  } catch {}

  return {
    getItem: async () => JSON.stringify(inMemoryQueue),
    setItem: async (_k: string, v: string) => {
      inMemoryQueue = JSON.parse(v);
    },
  };
}

/**
 * Enqueues a failed storage deletion for future retry.
 */
export async function enqueueFailedCleanup(
  bucket: StorageBucket,
  storagePath: string,
  error?: unknown
): Promise<void> {
  const task: CleanupTask = {
    id: `${bucket}:${storagePath}:${Date.now()}`,
    bucket,
    storagePath,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
  };

  try {
    const storage = await getStorage();
    const existingRaw = await storage.getItem(CLEANUP_STORAGE_KEY);
    const existing: CleanupTask[] = existingRaw ? JSON.parse(existingRaw) : [];

    // Avoid duplicate queue entries for the same path
    const alreadyPresent = existing.some((t) => t.bucket === bucket && t.storagePath === storagePath);
    if (!alreadyPresent) {
      existing.push(task);
      await storage.setItem(CLEANUP_STORAGE_KEY, JSON.stringify(existing));
    }
  } catch (queueErr) {
    console.warn('[CleanupQueue] Failed to persist cleanup task to AsyncStorage:', queueErr);
    inMemoryQueue.push(task);
  }
}

/**
 * Retrieves all pending cleanup tasks.
 */
export async function getPendingCleanups(): Promise<CleanupTask[]> {
  try {
    const storage = await getStorage();
    const raw = await storage.getItem(CLEANUP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : inMemoryQueue;
  } catch {
    return inMemoryQueue;
  }
}

/**
 * Clears the cleanup queue (used in testing or maintenance).
 */
export async function clearCleanupQueue(): Promise<void> {
  inMemoryQueue = [];
  try {
    const storage = await getStorage();
    await storage.setItem(CLEANUP_STORAGE_KEY, JSON.stringify([]));
  } catch {}
}

export type ReferenceSafetyDecision =
  | 'SAFE_TO_DELETE'       // Positively verified unreferenced -> delete
  | 'ACTIVELY_REFERENCED'  // Positively verified referenced by live row -> discard task
  | 'CHECK_FAILED_RETRY';  // Verification failed/unverified -> keep task pending

export interface ProcessCleanupQueueOptions {
  /**
   * MANDATORY Safety Guard:
   * Verification callback (e.g. from database service) checking whether the storagePath
   * is actively referenced in database tables (public.files, ppe_images, etc.).
   *
   * RULES:
   * - Must return 'SAFE_TO_DELETE' (or true) ONLY if confirmed completely unreferenced in database.
   * - Must return 'ACTIVELY_REFERENCED' (or false) if confirmed referenced by a live submission or avatar.
   * - Must return 'CHECK_FAILED_RETRY' if network/database is offline or status cannot be verified.
   * - If this callback throws or fails (e.g. network error), the task remains PENDING.
   * - If this callback is omitted, processCleanupQueue REFUSES to delete any objects (fail-safe).
   */
  isSafeToDelete: (
    bucket: StorageBucket,
    path: string
  ) => Promise<ReferenceSafetyDecision | boolean>;
  maxAttempts?: number;
  ttlMs?: number;
}

/**
 * Retries all pending cleanup tasks using the provided storage service.
 * Deletion operations are idempotent: 404/not-found is considered successful removal.
 *
 * MANDATORY SAFETY CONTRACT:
 * - isSafeToDelete is strictly required. Deletion will NOT execute without it.
 * - If reference verification fails or throws an exception, the task is KEPT PENDING.
 * - Live objects referenced by successful submissions are permanently discarded from cleanup.
 * - Cleanup tasks older than 7 days are automatically evicted.
 */
export async function processCleanupQueue(
  storageService: { deleteFile: (bucket: StorageBucket, path: string) => Promise<boolean> },
  options: ProcessCleanupQueueOptions
): Promise<{ succeeded: string[]; failed: string[]; skippedUnsafe: string[]; deferredUnverified: string[] }> {
  const pending = await getPendingCleanups();
  if (pending.length === 0) {
    return { succeeded: [], failed: [], skippedUnsafe: [], deferredUnverified: [] };
  }

  // Fail-safe: Refuse deletion if safety verification hook is omitted
  if (!options || typeof options.isSafeToDelete !== 'function') {
    console.warn(
      '[CleanupQueue] FAIL-SAFE: isSafeToDelete verification hook is mandatory. Refusing to delete storage objects without reference verification.'
    );
    return {
      succeeded: [],
      failed: [],
      skippedUnsafe: [],
      deferredUnverified: pending.map((t) => t.storagePath),
    };
  }

  const maxAttempts = options.maxAttempts ?? 5;
  const ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  const now = Date.now();

  const succeeded: string[] = [];
  const failed: string[] = [];
  const skippedUnsafe: string[] = [];
  const deferredUnverified: string[] = [];
  const remaining: CleanupTask[] = [];

  for (const task of pending) {
    const ageMs = now - new Date(task.enqueuedAt).getTime();
    if (ageMs > ttlMs) {
      console.warn('[CleanupQueue] Evicting expired cleanup task (>7 days):', task.storagePath);
      continue;
    }

    // Reference Check: Verify with database whether the object is unreferenced
    let decision: ReferenceSafetyDecision;
    try {
      const res = await options.isSafeToDelete(task.bucket, task.storagePath);
      if (res === 'SAFE_TO_DELETE' || res === true) {
        decision = 'SAFE_TO_DELETE';
      } else if (res === 'ACTIVELY_REFERENCED' || res === false) {
        decision = 'ACTIVELY_REFERENCED';
      } else {
        decision = 'CHECK_FAILED_RETRY';
      }
    } catch (checkErr) {
      // If reference check throws (e.g. database offline), NEVER assume unreferenced!
      // Keep task pending for future evaluation.
      console.warn('[CleanupQueue] Reference check failed or threw; keeping task pending:', task.storagePath);
      remaining.push(task);
      deferredUnverified.push(task.storagePath);
      continue;
    }

    if (decision === 'CHECK_FAILED_RETRY') {
      console.warn('[CleanupQueue] Reference check unverified or failed; keeping task pending:', task.storagePath);
      remaining.push(task);
      deferredUnverified.push(task.storagePath);
      continue;
    }

    if (decision === 'ACTIVELY_REFERENCED') {
      // Actively referenced by a live submission or user profile! Discard from cleanup.
      console.warn('[CleanupQueue] Object is actively referenced in database. Aborting deletion:', task.storagePath);
      skippedUnsafe.push(task.storagePath);
      continue;
    }

    try {
      task.attempts++;
      const ok = await storageService.deleteFile(task.bucket, task.storagePath);
      if (ok) {
        succeeded.push(task.storagePath);
      } else if (task.attempts < maxAttempts) {
        remaining.push(task);
      } else {
        failed.push(task.storagePath);
      }
    } catch (err: any) {
      task.lastError = err?.message ?? String(err);
      if (task.attempts < maxAttempts) {
        remaining.push(task);
      } else {
        console.warn(`[CleanupQueue] Dropping task after ${maxAttempts} failed attempts:`, task.storagePath);
        failed.push(task.storagePath);
      }
    }
  }

  try {
    const storage = await getStorage();
    await storage.setItem(CLEANUP_STORAGE_KEY, JSON.stringify(remaining));
  } catch (writeErr) {
    console.warn('[CleanupQueue] Failed to update cleanup queue in AsyncStorage:', writeErr);
    inMemoryQueue = remaining;
  }

  return {
    succeeded,
    failed,
    skippedUnsafe,
    deferredUnverified,
  };
}
