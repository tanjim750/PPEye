import { authStore, subscribeAuthStore } from "@/stores/auth.store";
import { latestCurrentReview } from "@/services/vendor/vendorSubmissions.service";
import { createRefCountedSubscription } from "@/services/realtime/refCountedSubscription";
import { ImageSource } from "expo-image";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Platform } from "react-native";
import { assets } from "@/constants/assets";
import { isDemoMode } from "@/constants/devMode";

export type WorkerIssue = {
  message: string;
  severityKey: "critical" | "missing";
  tags: string[];
  title: string;
  tone: "error" | "warning";
};

export type WorkerReviewSummary = {
  sequenceNo: number;
  workerInstanceId?: number;
  workerName: string;
  status: "safe" | "unsafe" | "review";
  unsafeReasons?: string[];
  otherReasonText?: string;
  frontUri?: string | null;
  backUri?: string | null;
  frontDriveId?: string | null;
  backDriveId?: string | null;
};

export type WorkerCheck = {
  id: string;
  submissionId?: number;
  submittedBy?: number;
  workerId?: number;
  workerInstanceId?: number;
  workerName?: string;
  isResubmissionRequired?: boolean;
  workerCount?: number;
  totalSubmissionWorkers?: number;
  workerReviews?: WorkerReviewSummary[];
  image?: ImageSource;
  issues?: WorkerIssue[];
  reviewerName?: string;
  reviewerNote?: string;
  siteName?: string;
  status: "safe" | "unsafe" | "review";
  timeKey: string;
  timestamp: number; // Unix timestamp in milliseconds for chronological sorting
  titleKey: string;
  unsafeReasons?: string[];
  workerNumber: number;
  isDemo?: boolean;
};

const now = Date.now();
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

let workerChecks: WorkerCheck[] = [];

const LEGACY_WORKER_CHECKS_STORAGE_KEY = 'ppeye:worker_checks:cache:v1';

function getCurrentExternalUserId(): number | null {
  const user = authStore.user;
  if (!user || (user.category !== 'EXTERNAL' && user.role !== 'vendor' && user.role !== 'external')) {
    return null;
  }
  const parsed = Number(user.id);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getWorkerChecksStorageKey(userId: number | null): string | null {
  return userId ? `ppeye:worker_checks:cache:v2:user_${userId}` : null;
}

async function loadCachedWorkerChecks(expectedUserId: number | null = getCurrentExternalUserId()) {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    void AsyncStorage.removeItem(LEGACY_WORKER_CHECKS_STORAGE_KEY).catch(() => {});
    const storageKey = getWorkerChecksStorageKey(expectedUserId);
    if (!expectedUserId || !storageKey) return;
    const json = await AsyncStorage.getItem(storageKey);
    if (getCurrentExternalUserId() !== expectedUserId) return;
    if (json) {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0 && workerChecks.length === 0) {
        workerChecks = parsed.filter(
          (item: WorkerCheck) => !item.submittedBy || Number(item.submittedBy) === expectedUserId
        );
        notify();
      }
    }
  } catch {}
}

async function persistWorkerChecks(data: WorkerCheck[], ownerUserId: number | null = getCurrentExternalUserId()) {
  try {
    const storageKey = getWorkerChecksStorageKey(ownerUserId);
    if (!storageKey) return;
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem(storageKey, JSON.stringify(data.slice(0, 30)));
  } catch {}
}

export function resetWorkerChecksCache(): void {
  workerChecks = [];
  lastWorkerChecksSignature = "";
  lastWorkerChecksSyncTimestamp = 0;
  notify();
}

let trackedAuthUserKey = `${authStore.user?.id ?? ''}:${authStore.user?.category ?? authStore.user?.role ?? ''}`;
subscribeAuthStore(() => {
  const nextKey = `${authStore.user?.id ?? ''}:${authStore.user?.category ?? authStore.user?.role ?? ''}`;
  if (nextKey === trackedAuthUserKey) return;
  trackedAuthUserKey = nextKey;
  resetWorkerChecksCache();
  const extUid = getCurrentExternalUserId();
  if (extUid) {
    void loadCachedWorkerChecks(extUid).then(() => {
      void syncWorkerChecksFromSupabase({ force: true });
    });
  }
});

void loadCachedWorkerChecks();

const listeners = new Set<() => void>();
let workerChecksChannel: any = null;
let workerChecksAppStateSub: { remove: () => void } | null = null;
let workerChecksSyncInterval: ReturnType<typeof setInterval> | null = null;

function stopWorkerChecksPolling() {
  if (workerChecksSyncInterval) clearInterval(workerChecksSyncInterval);
  workerChecksSyncInterval = null;
}

function canSyncWorkerChecksWhileFocused() {
  return listeners.size > 0 && AppState.currentState === 'active';
}

function syncWorkerChecksWhileFocused() {
  if (canSyncWorkerChecksWhileFocused()) void syncWorkerChecksFromSupabase();
}

function startWorkerChecksPolling() {
  if (listeners.size === 0 || AppState.currentState !== 'active' || workerChecksSyncInterval) return;
  workerChecksSyncInterval = setInterval(syncWorkerChecksWhileFocused, 15000);
}

function notify() {
  listeners.forEach((listener) => listener());
}

let lastWorkerChecksSyncTimestamp = 0;
const WORKER_CHECKS_SYNC_COOLDOWN_MS = 6000;
let workerChecksDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSyncWorkerChecks() {
  if (workerChecksDebounceTimer) clearTimeout(workerChecksDebounceTimer);
  workerChecksDebounceTimer = setTimeout(() => {
    syncWorkerChecksWhileFocused();
  }, 400);
}

function ensureWorkerChecksRealtimeSubscription() {
  if (workerChecksChannel || listeners.size === 0) {
    return;
  }
  try {
    const supabase = require("@/services/supabase/client").supabase;
    if (!supabase || typeof supabase.channel !== "function") return;

    workerChecksChannel = supabase
      .channel("ppeye-vendor-worker-checks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_reviews" },
        () => {
          debouncedSyncWorkerChecks();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submission_reviews" },
        () => {
          debouncedSyncWorkerChecks();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ppe_submissions" },
        () => {
          debouncedSyncWorkerChecks();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_images" }, () => { debouncedSyncWorkerChecks(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "ppe_review_reasons" }, () => { debouncedSyncWorkerChecks(); })
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') syncWorkerChecksWhileFocused(); });
  } catch {
    // Ignore channel setup errors in offline mode
  }
}

function cleanupWorkerChecksRealtimeSubscriptionIfIdle() {
  if (listeners.size > 0 || !workerChecksChannel) {
    return;
  }
  try {
    const supabase = require("@/services/supabase/client").supabase;
    if (supabase && typeof supabase.removeChannel === "function") {
      void supabase.removeChannel(workerChecksChannel);
    }
  } catch {
    // Ignore cleanup errors
  } finally {
    workerChecksChannel = null;
  }
}

export function subscribeWorkerChecks(listener: () => void) {
  listeners.add(listener);
  const releaseRealtime = workerChecksRealtimeRefs.acquire();
  return () => {
    listeners.delete(listener);
    releaseRealtime();
  };
}

const workerChecksRealtimeRefs = createRefCountedSubscription(() => {
  ensureWorkerChecksRealtimeSubscription();
  workerChecksAppStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      startWorkerChecksPolling();
      syncWorkerChecksWhileFocused();
    } else {
      stopWorkerChecksPolling();
    }
  });
  startWorkerChecksPolling();
  return () => {
    cleanupWorkerChecksRealtimeSubscriptionIfIdle();
    workerChecksAppStateSub?.remove();
    workerChecksAppStateSub = null;
    stopWorkerChecksPolling();
  };
});

export function getAllWorkerChecks(): WorkerCheck[] {
  return [...workerChecks].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns safe AND unsafe checks for TODAY for vendor home page (up to limit, max 10).
 * Sorted chronologically (latest time first).
 * Excludes yesterday submissions.
 */
export function getRecentTodayChecks(limit = 10): WorkerCheck[] {
  return workerChecks
    .filter(
      (item) =>
        (item.status === "safe" || item.status === "unsafe") &&
        !item.timeKey.startsWith("yesterday"),
    )
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

/**
 * Returns a worker check by its ID or workerNumber.
 */
export function getWorkerCheckById(id: string): WorkerCheck | undefined {
  return workerChecks.find(
    (item) =>
      item.id === id ||
      item.id === `sub_${id}_unsafe` ||
      item.id === `sub_${id}_safe` ||
      item.id === `sub_${id}_review` ||
      item.id === `sub_${id}` ||
      String(item.submissionId) === String(id) ||
      String(item.workerNumber) === String(id),
  );
}

/**
 * Returns safe and unsafe checks (legacy export kept for compatibility).
 */
export function getRecentSafeAndUnsafeChecks(limit = 10): WorkerCheck[] {
  return getRecentTodayChecks(limit);
}

/**
 * Returns safe checks ONLY (for "All History" tab in History view).
 * Sorted chronologically (latest time first).
 * Includes any completed check that has at least one safe worker.
 */
export function getSafeWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => {
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === "safe");
      }
      return item.status === "safe";
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns pending/review checks ONLY (for "All pending" tab in History view).
 * Sorted chronologically (latest time first).
 * Includes any check that has at least one worker under review.
 */
export function getPendingWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => {
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === "review");
      }
      return item.status === "review";
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Returns unsafe checks ONLY (for "All Unsafe" tab in History view).
 * Sorted chronologically (latest time first).
 * Includes any check that has at least one unsafe worker.
 */
export function getUnsafeWorkerChecks(): WorkerCheck[] {
  return workerChecks
    .filter((item) => {
      if (item.workerReviews && item.workerReviews.length > 0) {
        return item.workerReviews.some((w) => w.status === "unsafe");
      }
      return item.status === "unsafe";
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Resubmit an unsafe check - transitions its status from 'unsafe' to 'review' (pending).
 */
export function resubmitWorkerCheck(
  idOrWorkerNumber: string | number,
  options?: {
    backUri?: string;
    frontUri?: string;
    siteName?: string;
    capturedAt?: number;
  },
) {
  const itemTimestamp = options?.capturedAt || Date.now();
  let matched = false;
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      (item.workerNumber === idOrWorkerNumber && item.status === "unsafe") ||
      (typeof idOrWorkerNumber === "string" &&
        item.id.toLowerCase() === idOrWorkerNumber.toLowerCase())
    ) {
      matched = true;
      return {
        ...item,
        image: options?.frontUri ? { uri: options.frontUri } : item.image,
        siteName: options?.siteName || item.siteName,
        status: "review" as const,
        timestamp: itemTimestamp,
      };
    }
    return item;
  });

  if (!matched) return;
  workerChecks = [...workerChecks].sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
  );
  notify();
}

export function toBengaliNumerals(num: number | string): string {
  const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  return String(num).replace(
    /[0-9]/g,
    (digit) => bnDigits[Number(digit)] || digit,
  );
}

export function extractSiteCode(siteName?: string): string {
  if (!siteName) return "Site";
  const trimmed = siteName.trim();
  const dashIndex = trimmed.indexOf(" - ");
  if (dashIndex !== -1) {
    return trimmed.slice(0, dashIndex).trim();
  }
  return trimmed;
}

/**
 * Returns dynamic title for worker check on vendor side:
 * Displays site name directly (Worker prefix removed as per user request).
 */
export function formatWorkerCheckTitle(
  item: { siteName?: string; workerNumber?: number; workerCount?: number; titleKey?: string; workerName?: string },
  t?: (key: string, options?: any) => string,
  language?: string,
): string {
  let site = item.siteName?.trim() || extractSiteCode(item.siteName) || "Site";
  site = site.replace(/^(Worker|কর্মী)\s*[-–—:]\s*/i, "").trim() || "Site";
  if (item.workerNumber) {
    const isBn = language === "bn";
    const workerLabel = isBn ? `কর্মী ${item.workerNumber}` : `Worker ${item.workerNumber}`;
    return `${workerLabel} • ${site}`;
  }
  return site;
}

/**
 * Formats time display using real time:
 * - If today: returns real formatted time (e.g. "06:05 PM")
 * - If yesterday: returns "Yesterday" (or Bengali "গতকাল")
 */
export function formatWorkerCheckTime(
  itemOrTimeKey: string | { timestamp?: number; timeKey?: string },
  t?: (key: string, options?: any) => string,
  explicitTimestamp?: number,
): string {
  let timestamp = explicitTimestamp;
  let timeKey = "";

  if (typeof itemOrTimeKey === "object" && itemOrTimeKey !== null) {
    timestamp = itemOrTimeKey.timestamp;
    timeKey = itemOrTimeKey.timeKey || "";
  } else if (typeof itemOrTimeKey === "string") {
    timeKey = itemOrTimeKey;
  }

  if (timestamp && typeof timestamp === "number" && !isNaN(timestamp)) {
    const date = new Date(timestamp);
    const now = new Date();

    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const isYesterday =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
      ).toDateString() ===
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      ).toDateString();

    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
    const timeStr = `${formattedHours}:${minutes} ${ampm}`;

    if (isToday) {
      return timeStr;
    }
    if (isYesterday) {
      return t
        ? t("external.history.yesterday", { defaultValue: "Yesterday" })
        : "Yesterday";
    }
    return `${date.getDate()} ${date.toLocaleString("en-US", { month: "short" })}`;
  }

  if (t && timeKey) {
    const raw = t(`external.recent.${timeKey}`, { defaultValue: timeKey });
    if (
      timeKey.startsWith("yesterday") ||
      raw.toLowerCase().includes("yesterday") ||
      raw.includes("গতকাল")
    ) {
      return raw.includes("গতকাল") ? "গতকাল" : "Yesterday";
    }
    return raw.replace(/^(Today,\s*|আজ,\s*)/i, "");
  }

  return "Just now";
}

/**
 * Mark a worker as safe (e.g., when Reviewer marks a worker safe).
 */
export function markWorkerSafe(idOrWorkerNumber: string | number) {
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      item.workerNumber === idOrWorkerNumber ||
      String(item.workerNumber) === String(idOrWorkerNumber)
    ) {
      return {
        ...item,
        image: item.image,
        status: "safe",
        timestamp: Date.now(), // Bump timestamp to now
      };
    }
    return item;
  });
  notify();
}

/**
 * Mark a worker as unsafe with reviewer reasons and note.
 */
export function markWorkerUnsafe(
  idOrWorkerNumber: string | number,
  reasons: string[] = [],
  notes?: string,
  reviewerName = "Reviewer",
) {
  let matched = false;
  workerChecks = workerChecks.map((item) => {
    if (
      item.id === idOrWorkerNumber ||
      item.workerNumber === idOrWorkerNumber ||
      String(item.workerNumber) === String(idOrWorkerNumber)
    ) {
      matched = true;
      return {
        ...item,
        image: item.image,
        status: "unsafe",
        unsafeReasons: reasons.length > 0 ? reasons : item.unsafeReasons,
        reviewerNote: notes || item.reviewerNote,
        reviewerName,
        timeKey: "time1042",
        timestamp: Date.now(),
      };
    }
    return item;
  });

  if (!matched && typeof idOrWorkerNumber === "string") return;
  notify();
}

let syncWorkerChecksInFlight: Promise<void> | null = null;
let hasPendingWorkerChecksForceSync = false;
let lastWorkerChecksSignature = "";

/**
 * Synchronizes worker submissions from Supabase in real-time.
 * Features:
 * - Strict role-based isolation (workers only see their submissions; team leaders see all vendor submissions)
 * - Concurrent generation and memory-disk prefetching of FRONT & BACK photo signed URLs
 * - Zero-delay instant display when tapping "Tap to view details"
 */
export async function syncWorkerChecksFromSupabase(options?: { force?: boolean }): Promise<void> {
  const u = authStore.user;
  const cat = String(u?.category || "").trim().toUpperCase();
  const role = String(u?.role || "").trim().toLowerCase();
  const isExternalVendor = cat === "EXTERNAL" || role === "vendor" || role === "external";
  if (!isExternalVendor) return;
  const currentUserId = Number(u?.id);
  if (!Number.isFinite(currentUserId) || currentUserId <= 0) return;

  const now = Date.now();
  if (!options?.force && now - lastWorkerChecksSyncTimestamp < WORKER_CHECKS_SYNC_COOLDOWN_MS) {
    return syncWorkerChecksInFlight || Promise.resolve();
  }

  if (syncWorkerChecksInFlight) {
    if (options?.force) {
      hasPendingWorkerChecksForceSync = true;
    }
    return syncWorkerChecksInFlight;
  }
  lastWorkerChecksSyncTimestamp = now;

  syncWorkerChecksInFlight = (async () => {
    try {
      const supabase = require("@/services/supabase/client").supabase;
      if (!supabase) return;
      const accountKey = `${currentUserId}:${authStore.user?.vendorProfileId}`;
      const profileId = authStore.user?.vendorProfileId;
      if (typeof profileId !== 'number') return;

      const { data: subs, error } = await supabase
        .from("ppe_submissions")
        .select(
          `
          id,
          submitted_by,
          site_name,
          metadata,
          created_at,
          ppe_worker_instances (
            id,
            sequence_no,
            ppe_reviews (
              id,
              verdict,
              reviewed_at,
              ppe_review_reasons (
                note,
                unsafe_reasons (code, label)
              )
            ),
            ppe_images (
              id,
              side,
              file_id,
              created_at,
              files (
                id,
                provider_file_id,
                storage_provider
              )
            )
          )
        `,
        )
        .eq('vendor_profile_id', profileId)
        .eq('submitted_by', currentUserId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (accountKey !== `${Number(authStore.user?.id)}:${authStore.user?.vendorProfileId}`) return;

      if (error || !subs) {
        return;
      }

      // Collect any file_id that wasn't resolved by the relational join
      const missingFileIds: number[] = [];
      for (const sub of subs) {
        for (const w of (sub.ppe_worker_instances as any[]) || []) {
          for (const img of w.ppe_images || []) {
            const raw = Array.isArray(img.files) ? img.files[0] : img.files;
            if (!raw?.provider_file_id && img.file_id) {
              missingFileIds.push(Number(img.file_id));
            }
          }
        }
      }

      const resolvedFileMap = new Map<number, { provider_file_id: string; storage_provider: string }>();
      if (missingFileIds.length > 0) {
        try {
          const { data: fileRows } = await supabase
            .from('files')
            .select('id, provider_file_id, storage_provider')
            .in('id', missingFileIds);
          if (fileRows) {
            for (const f of fileRows) {
              if (f.provider_file_id) {
                resolvedFileMap.set(Number(f.id), {
                  provider_file_id: f.provider_file_id,
                  storage_provider: f.storage_provider || 'SUPABASE',
                });
              }
            }
          }
        } catch {}
      }

      const liveChecks: WorkerCheck[] = [];

      for (const sub of subs) {
        if ((sub as any).submitted_by !== undefined && Number((sub as any).submitted_by) !== currentUserId) {
          continue;
        }
        const workers = (sub.ppe_worker_instances as any[]) || [];
        if (workers.length === 0) continue;

        const workerReviews: WorkerReviewSummary[] = [];
        let anyUnsafe = false;
        let anyPending = false;
        const allUnsafeReasons: string[] = [];
        const allNotes: string[] = [];
        let maxTimestamp = new Date(sub.created_at).getTime();

        for (const w of workers) {
          const review = latestCurrentReview(
            w,
            ((sub as any).metadata?.workerReviews || []).find(
              (item: any) => Number(item.sequenceNo) === Number(w.sequence_no)
            )
          );
          const newestPhotoAt = Math.max(
            0,
            ...(w.ppe_images || []).map((image: any) =>
              new Date(image.created_at || 0).getTime()
            )
          );
          let wStatus: "safe" | "unsafe" | "review" = "review";
          let unsafeReasons: string[] = [];
          let reviewerNote: string | undefined;

          if (review?.verdict === "SAFE") {
            wStatus = "safe";
          } else if (review?.verdict === "UNSAFE") {
            wStatus = "unsafe";
            anyUnsafe = true;
            if (review.ppe_review_reasons && review.ppe_review_reasons.length > 0) {
              unsafeReasons = review.ppe_review_reasons
                .map(
                  (rr: any) =>
                    rr.unsafe_reasons?.label || rr.unsafe_reasons?.code
                )
                .filter(Boolean);
              
              // Extract any note attached to reasons (especially 'other' or custom note)
              const noteEntry = review.ppe_review_reasons.find((rr: any) => Boolean(rr.note && rr.note.trim()));
              reviewerNote = noteEntry?.note?.trim();

              allUnsafeReasons.push(...unsafeReasons);
            }

            // Fallback to metadata if relational note was missing for THIS worker
            if (!reviewerNote) {
              const metaWorker = (Array.isArray(sub.metadata?.workerReviews) ? sub.metadata.workerReviews : []).find(
                (mw: any) => Number(mw.sequenceNo) === Number(w.sequence_no)
              );
              reviewerNote =
                metaWorker?.otherReasonText?.trim() ||
                (workers.length === 1
                  ? sub.metadata?.otherReasonText?.trim() || sub.metadata?.combinedNotes?.trim()
                  : undefined);
            }

            if (reviewerNote) allNotes.push(reviewerNote);
          } else {
            // Check metadata if review relation row is not yet loaded
            const metaWorker = (Array.isArray(sub.metadata?.workerReviews) ? sub.metadata.workerReviews : []).find(
              (mw: any) => Number(mw.sequenceNo) === Number(w.sequence_no)
            );
            if (metaWorker?.status === "unsafe") {
              wStatus = "unsafe";
              anyUnsafe = true;
              unsafeReasons = metaWorker.unsafeReasons || [];
              reviewerNote =
                metaWorker?.otherReasonText?.trim() ||
                (workers.length === 1
                  ? sub.metadata?.otherReasonText?.trim() || sub.metadata?.combinedNotes?.trim()
                  : undefined);
              allUnsafeReasons.push(...unsafeReasons);
              if (reviewerNote) allNotes.push(reviewerNote);
            } else if (metaWorker?.status === "safe") {
              wStatus = "safe";
            } else {
              anyPending = true;
            }
          }

          const frontImg = [...(w.ppe_images || [])]
            .filter((img: any) => String(img.side || '').toUpperCase() === "FRONT")
            .sort(
              (a: any, b: any) =>
                new Date(b.created_at || 0).getTime() -
                new Date(a.created_at || 0).getTime()
            )[0];
          const backImg = [...(w.ppe_images || [])]
            .filter((img: any) => String(img.side || '').toUpperCase() === "BACK")
            .sort(
              (a: any, b: any) =>
                new Date(b.created_at || 0).getTime() -
                new Date(a.created_at || 0).getTime()
            )[0];

          const frontRawFile = Array.isArray(frontImg?.files) ? frontImg.files[0] : frontImg?.files;
          const backRawFile = Array.isArray(backImg?.files) ? backImg.files[0] : backImg?.files;

          let frontFileId = frontRawFile?.provider_file_id;
          let frontStorageProvider = frontRawFile?.storage_provider;
          if (!frontFileId && frontImg?.file_id) {
            const resolved = resolvedFileMap.get(Number(frontImg.file_id));
            if (resolved) {
              frontFileId = resolved.provider_file_id;
              frontStorageProvider = resolved.storage_provider;
            }
          }

          let backFileId = backRawFile?.provider_file_id;
          let backStorageProvider = backRawFile?.storage_provider;
          if (!backFileId && backImg?.file_id) {
            const resolved = resolvedFileMap.get(Number(backImg.file_id));
            if (resolved) {
              backFileId = resolved.provider_file_id;
              backStorageProvider = resolved.storage_provider;
            }
          }

          let frontUri: string | null = null;
          let backUri: string | null = null;
          const { supabaseStorageService } = require('@/services/storage/supabase-storage.client');
          const { Image } = require('expo-image');
          const { getCachedImageUriSync } = require('@/utils/image');

          if (frontFileId && (frontStorageProvider === 'SUPABASE' || frontFileId.includes('/'))) {
            const localCached = getCachedImageUriSync(frontFileId);
            if (localCached && (Platform.OS !== 'web' || !localCached.startsWith('file://'))) {
              frontUri = localCached;
            }
          }

          if (backFileId && (backStorageProvider === 'SUPABASE' || backFileId.includes('/'))) {
            const localCached = getCachedImageUriSync(backFileId);
            if (localCached && (Platform.OS !== 'web' || !localCached.startsWith('file://'))) {
              backUri = localCached;
            }
          }

          const latestReviewAt = review?.reviewed_at
            ? new Date(review.reviewed_at).getTime()
            : 0;
          maxTimestamp = Math.max(maxTimestamp, newestPhotoAt, latestReviewAt);

          workerReviews.push({
            sequenceNo: Number(w.sequence_no),
            workerInstanceId: w.id,
            workerName: `Worker ${w.sequence_no}`,
            status: wStatus,
            unsafeReasons,
            otherReasonText: reviewerNote,
            frontDriveId: (frontStorageProvider === 'SUPABASE' || frontFileId?.includes('/')) ? frontFileId : null,
            backDriveId: (backStorageProvider === 'SUPABASE' || backFileId?.includes('/')) ? backFileId : null,
            frontUri: frontUri || undefined,
            backUri: backUri || undefined,
          });
        }

        // Group workers by verdict status so mixed submissions produce clean separate cards:
        // - Safe workers group -> sub_${sub.id}_safe
        // - Unsafe workers group -> sub_${sub.id}_unsafe
        // - Pending review workers group -> sub_${sub.id}_review
        const safeWorkerReviews = workerReviews.filter((w) => w.status === "safe");
        const unsafeWorkerReviews = workerReviews.filter((w) => w.status === "unsafe");
        const pendingWorkerReviews = workerReviews.filter((w) => w.status === "review");

        const statusGroups: Array<{
          status: "safe" | "unsafe" | "review";
          workersList: WorkerReviewSummary[];
        }> = [];

        if (unsafeWorkerReviews.length > 0) {
          statusGroups.push({ status: "unsafe", workersList: unsafeWorkerReviews });
        }
        if (safeWorkerReviews.length > 0) {
          statusGroups.push({ status: "safe", workersList: safeWorkerReviews });
        }
        if (pendingWorkerReviews.length > 0) {
          statusGroups.push({ status: "review", workersList: pendingWorkerReviews });
        }

        // Helper to resolve preview image for a group
        const resolveGroupImage = (groupWorkers: WorkerReviewSummary[]): string | undefined => {
          const primary = groupWorkers[0];
          let imgUrl: string | undefined = primary?.frontUri || primary?.backUri || undefined;
          if (!imgUrl && primary) {
            const wInstance = workers.find(
              (w) =>
                Number(w.sequence_no) === Number(primary.sequenceNo) ||
                w.id === primary.workerInstanceId
            );
            if (wInstance?.ppe_images) {
              const wImgs = (wInstance.ppe_images || []).slice().sort((a: any, b: any) => {
                const aSide = String(a.side || '').toUpperCase();
                const bSide = String(b.side || '').toUpperCase();
                if (aSide === 'FRONT' && bSide !== 'FRONT') return -1;
                if (bSide === 'FRONT' && aSide !== 'FRONT') return 1;
                return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
              });
              if (wImgs.length > 0) {
                const rawFile = Array.isArray(wImgs[0]?.files) ? wImgs[0].files[0] : wImgs[0]?.files;
                let fId = rawFile?.provider_file_id;
                if (!fId && wImgs[0]?.file_id) {
                  const res = resolvedFileMap.get(Number(wImgs[0].file_id));
                  if (res) fId = res.provider_file_id;
                }
                if (fId) {
                  const { getCachedImageUriSync } = require("@/utils/image");
                  imgUrl = getCachedImageUriSync(fId) ?? undefined;
                }
              }
            }
          }
          return imgUrl;
        };

        for (const grp of statusGroups) {
          const grpStatus = grp.status;
          const grpWorkers = grp.workersList;
          const primaryWorker = grpWorkers[0];
          const grpImageUrl = resolveGroupImage(grpWorkers);

          const groupUnsafeReasons = Array.from(
            new Set(grpWorkers.flatMap((w) => w.unsafeReasons || []))
          );
          const groupNotes = grpWorkers
            .map((w) => w.otherReasonText)
            .filter(Boolean) as string[];

          liveChecks.push({
            id: `sub_${sub.id}_${grpStatus}`,
            submissionId: sub.id,
            submittedBy: currentUserId,
            workerId: primaryWorker?.workerInstanceId,
            workerInstanceId: primaryWorker?.workerInstanceId,
            workerName: primaryWorker?.workerName,
            isResubmissionRequired: grpStatus === "unsafe",
            workerCount: grpWorkers.length,
            totalSubmissionWorkers: workers.length,
            workerReviews: grpWorkers, // Contains ONLY workers belonging to this status group
            image: grpImageUrl ? ({ uri: grpImageUrl } as any) : undefined,
            siteName: sub.site_name,
            status: grpStatus,
            timeKey: "today",
            timestamp: maxTimestamp,
            titleKey: `sub_${sub.id}_${grpStatus}`,
            workerNumber: undefined as any, // undefined so title displays site name directly
            unsafeReasons: groupUnsafeReasons,
            reviewerNote: groupNotes.join("; ") || (grpStatus === "unsafe" ? sub.metadata?.otherReasonText : undefined),
          });
        }
      }

      const nextChecks = [...liveChecks].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
      );
      const nextSignature = nextChecks.map((check) => [
        check.id,
        check.status,
        check.timestamp,
        check.siteName,
        check.workerNumber,
        check.image?.uri || "",
        (check.unsafeReasons || []).join(","),
        check.reviewerNote || "",
      ].join(":")).join("|");
      if (nextSignature !== lastWorkerChecksSignature) {
        lastWorkerChecksSignature = nextSignature;
        workerChecks = nextChecks;
        void persistWorkerChecks(nextChecks, currentUserId);
        notify();
      }

      // Sync reviewed checks to vendor notifications so badges and history stay accurate
      try {
        const { syncWorkerChecksToNotifications } = require('@/services/notifications/notification.service');
        syncWorkerChecksToNotifications(nextChecks);
      } catch {}

      // Non-blocking parallel prefetch in background so images warm up without delaying UI
      const missingPhotos: string[] = [];
      for (const check of nextChecks) {
        if (!check.image?.uri) {
          const fid = check.workerReviews?.[0]?.frontDriveId;
          if (fid && !missingPhotos.includes(fid)) missingPhotos.push(fid);
        }
      }
      if (missingPhotos.length > 0) {
        setTimeout(async () => {
          try {
            const { supabaseStorageService } = require('@/services/storage/supabase-storage.client');
            const { Image } = require('expo-image');
            await Promise.all(
              missingPhotos.slice(0, 10).map(async (photoPath) => {
                const bucket = photoPath.startsWith('users/') ? 'avatars' : 'evidence';
                const signed = await supabaseStorageService.createSignedUrl(bucket, photoPath, 86400 * 7);
                const u = typeof signed === 'string' ? signed : signed?.signedUrl;
                if (u && typeof u === 'string' && u.startsWith('http')) {
                  for (const c of workerChecks) {
                    if (!c.image?.uri && c.workerReviews?.[0]?.frontDriveId === photoPath) {
                      c.image = { uri: u };
                    }
                  }
                  if (Image && typeof Image.prefetch === 'function') {
                    Image.prefetch(u, 'memory-disk').catch(() => {});
                  }
                }
              })
            );
            notify();
          } catch {}
        }, 60);
      }
    } catch (err) {
      console.warn("[WorkerChecks] syncWorkerChecksFromSupabase caught:", err);
    } finally {
      syncWorkerChecksInFlight = null;
      if (hasPendingWorkerChecksForceSync) {
        hasPendingWorkerChecksForceSync = false;
        setTimeout(() => {
          void syncWorkerChecksFromSupabase({ force: true });
        }, 100);
      }
    }
  })();

  return syncWorkerChecksInFlight;
}

/**
 * Hook providing reactive access to worker checks with time sorting
 */
export function useWorkerChecks(enabled = true) {
  const [, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void syncWorkerChecksFromSupabase();
      return subscribeWorkerChecks(() => setTick((t) => t + 1));
    }, [enabled]),
  );

  return {
    allChecks: enabled ? getAllWorkerChecks() : [],
    pendingChecks: enabled ? getPendingWorkerChecks() : [],
    recentChecks: enabled ? getRecentTodayChecks(10) : [],
    safeChecks: enabled ? getSafeWorkerChecks() : [],
    unsafeChecks: enabled ? getUnsafeWorkerChecks() : [],
    markWorkerSafe,
    markWorkerUnsafe,
    resubmitWorkerCheck,
    syncWorkerChecksFromSupabase,
  };
}
