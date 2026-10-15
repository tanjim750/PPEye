/**
 * PPEye Upload Queue & Consistency Recovery Unit Tests (Mocked)
 *
 * Verifies:
 * - Configurable concurrency of two: throttles parallel executions to 2.
 * - Error classification (isRetryableError): 500, 503, 429, network timeouts vs 400, 401, 403, INVALID_INPUT.
 * - Retry delay calculation (calculateRetryDelay): bounded backoff, jitter, and Retry-After parsing.
 * - Consistency recovery: preserves Drive upload IDs and avoids blind re-upload on Supabase/relationship retry.
 * - Duplicate prevention: deduplicates concurrent requests for the same key.
 * - Cancellation: distinguishes queued cancellation from transport cancellation (AbortController).
 * - Progress tracking: stage-based progress without claiming byte-level progress unless exposed.
 * - Cleanup: clears completed uploads and reconciles orphaned Drive files.
 */

import {
  calculateRetryDelay,
  cancelPendingUpload,
  clearCompletedUploads,
  cleanupOrphanedUploads,
  getUploadStatus,
  isRetryableError,
  setQueueDriveDeleterMock,
  uploadWithRetry,
  UploadQueue,
} from '../upload-queue';
import { StorageError, StorageErrorCode } from '../storage.errors';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function assertAsyncThrows(
  promiseFn: () => Promise<any>,
  expectedCode?: string,
  message?: string
): Promise<void> {
  let threw = false;
  try {
    await promiseFn();
  } catch (err: any) {
    threw = true;
    if (expectedCode) {
      assert(
        err?.code === expectedCode,
        `Expected error code '${expectedCode}', received '${err?.code}' (${err?.message}): ${message}`
      );
    }
  }
  assert(threw, `Expected async function to throw, but it succeeded: ${message}`);
}

export async function runUploadQueueTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  const deletedDriveFiles: string[] = [];
  setQueueDriveDeleterMock(async (fileId: string) => {
    deletedDriveFiles.push(fileId);
    return true;
  });

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed++;
      console.log(`  ✔ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✖ [FAIL] ${name}`);
      console.error(`    ${err?.stack ?? err?.message ?? err}`);
    }
  };

  console.log('\n--- PPEye Upload Queue & Consistency Recovery Test Suite ---');

  // =========================================================================
  // 1. Error Classification & Delay Calculation
  // =========================================================================
  console.log('\n• Suite: Error Classification & Backoff Delay');

  await test('isRetryableError correctly classifies transient vs permanent errors', () => {
    // Retryable errors
    assert(isRetryableError(new StorageError(StorageErrorCode.NETWORK_ERROR, 'Connection reset')), 'NETWORK_ERROR is retryable');
    assert(isRetryableError(new StorageError(StorageErrorCode.PROVIDER_UNAVAILABLE, '503 Unavailable')), 'PROVIDER_UNAVAILABLE is retryable');
    assert(isRetryableError({ status: 503 }), 'HTTP 503 is retryable');
    assert(isRetryableError({ statusCode: 429 }), 'HTTP 429 is retryable');
    assert(isRetryableError(new Error('fetch failed')), 'fetch failed message is retryable');
    assert(isRetryableError(new Error('ETIMEDOUT: Connection timed out')), 'ETIMEDOUT is retryable');

    // Non-retryable errors
    assert(!isRetryableError(new StorageError(StorageErrorCode.INVALID_INPUT, 'Missing parameter')), 'INVALID_INPUT is non-retryable');
    assert(!isRetryableError(new StorageError(StorageErrorCode.PERMISSION_DENIED, 'Forbidden')), 'PERMISSION_DENIED is non-retryable');
    assert(!isRetryableError(new StorageError(StorageErrorCode.AUTHENTICATION_REQUIRED, 'Login required')), 'AUTHENTICATION_REQUIRED is non-retryable');
    assert(!isRetryableError({ status: 400 }), 'HTTP 400 is non-retryable');
    assert(!isRetryableError({ status: 401 }), 'HTTP 401 is non-retryable');
    assert(!isRetryableError({ status: 403 }), 'HTTP 403 is non-retryable');
    assert(!isRetryableError({ status: 404 }), 'HTTP 404 is non-retryable');
    assert(!isRetryableError(new Error('AbortError: The user aborted a request')), 'AbortError is non-retryable');
  });

  await test('calculateRetryDelay calculates bounded exponential backoff with jitter and respects Retry-After', () => {
    // Exponential calculation
    const delay0 = calculateRetryDelay(0, undefined, { baseDelayMs: 100, maxDelayMs: 5000, jitter: false });
    const delay1 = calculateRetryDelay(1, undefined, { baseDelayMs: 100, maxDelayMs: 5000, jitter: false });
    const delay2 = calculateRetryDelay(2, undefined, { baseDelayMs: 100, maxDelayMs: 5000, jitter: false });

    assert(delay0 === 100, `delay0 should be 100ms, got ${delay0}`);
    assert(delay1 === 200, `delay1 should be 200ms, got ${delay1}`);
    assert(delay2 === 400, `delay2 should be 400ms, got ${delay2}`);

    // Maximum delay bound
    const maxBoundDelay = calculateRetryDelay(10, undefined, { baseDelayMs: 1000, maxDelayMs: 3000, jitter: false });
    assert(maxBoundDelay === 3000, `Delay capped at maxDelayMs, got ${maxBoundDelay}`);

    // Respects numeric Retry-After (seconds)
    const delayRetryAfterSec = calculateRetryDelay(0, { retryAfter: 5 }, { maxDelayMs: 10000 });
    assert(delayRetryAfterSec === 5000, `5 seconds converted to 5000ms, got ${delayRetryAfterSec}`);

    // Respects Retry-After header string
    const delayRetryAfterHeader = calculateRetryDelay(0, { response: { headers: { 'retry-after': '3' } } }, { maxDelayMs: 10000 });
    assert(delayRetryAfterHeader === 3000, `Header 3 seconds converted to 3000ms, got ${delayRetryAfterHeader}`);
  });

  // =========================================================================
  // 2. Concurrency of Two
  // =========================================================================
  console.log('\n• Suite: Concurrency Management');

  await test('Queue enforces concurrency of 2: maximum 2 active tasks running simultaneously', async () => {
    const queue = new UploadQueue({ concurrency: 2 });
    let maxObservedActive = 0;
    let completedCount = 0;

    const makeTask = (id: string, durationMs: number) => {
      return queue.enqueue({
        id,
        executor: async () => {
          const currentActive = queue.getActiveCount();
          if (currentActive > maxObservedActive) {
            maxObservedActive = currentActive;
          }
          await new Promise((r) => setTimeout(r, durationMs));
          completedCount++;
          return id;
        },
      });
    };

    // Launch 5 tasks concurrently
    const p1 = makeTask('t1', 20);
    const p2 = makeTask('t2', 20);
    const p3 = makeTask('t3', 10);
    const p4 = makeTask('t4', 10);
    const p5 = makeTask('t5', 10);

    await Promise.all([p1, p2, p3, p4, p5]);

    assert(completedCount === 5, 'All 5 tasks completed');
    assert(maxObservedActive <= 2, `Active tasks never exceeded concurrency limit 2 (observed: ${maxObservedActive})`);
  });

  // =========================================================================
  // 3. Deduplication of Concurrent Requests
  // =========================================================================
  console.log('\n• Suite: Deduplication of Concurrent Requests');

  await test('Avoids duplicate concurrent operations for same key and returns shared result', async () => {
    const queue = new UploadQueue({ concurrency: 2 });
    let executionCount = 0;

    const taskFactory = () =>
      queue.enqueue({
        key: 'upload_key_photo_worker_1_front',
        executor: async () => {
          executionCount++;
          await new Promise((r) => setTimeout(r, 20));
          return { driveFileId: 'shared_drive_101' };
        },
      });

    // Enqueue 3 calls with the same key concurrently
    const [res1, res2, res3] = await Promise.all([taskFactory(), taskFactory(), taskFactory()]);

    assert(executionCount === 1, `Executor called exactly once, got ${executionCount}`);
    assert(res1.driveFileId === 'shared_drive_101', 'res1 received result');
    assert(res2.driveFileId === 'shared_drive_101', 'res2 received result');
    assert(res3.driveFileId === 'shared_drive_101', 'res3 received result');
  });

  // =========================================================================
  // 4. Consistency Recovery (Drive-Success / Supabase-Failure)
  // =========================================================================
  console.log('\n• Suite: Consistency Recovery (Drive-Success / Supabase-Failure)');

  await test('Preserves successful Drive upload ID and avoids blind re-upload on retry', async () => {
    const queue = new UploadQueue({ concurrency: 2, defaultBaseDelayMs: 10 });
    let driveUploadCount = 0;
    let dbAttempts = 0;

    const result = await queue.enqueue({
      id: 'task_consistency_test',
      maxRetries: 3,
      baseDelayMs: 10,
      executor: async (ctx) => {
        // Step 1: Storage Upload (Google Drive)
        if (!ctx.task.driveFileId) {
          driveUploadCount++;
          ctx.setDriveFileId('drive_file_persisted_777');
        }

        // Step 2: Database Persistence (Supabase files record)
        dbAttempts++;
        if (dbAttempts === 1) {
          // Simulate transient 503 database network error on first attempt
          throw new StorageError(StorageErrorCode.NETWORK_ERROR, '503 Service Unavailable: Supabase connection timeout');
        }

        ctx.setFileRecordId(555);

        // Step 3: Relationship Persistence
        return {
          driveFileId: ctx.task.driveFileId,
          fileRecordId: ctx.task.fileRecordId,
        };
      },
    });

    assert(result.driveFileId === 'drive_file_persisted_777', 'driveFileId matches');
    assert(result.fileRecordId === 555, 'fileRecordId matches');
    assert(driveUploadCount === 1, `Drive upload called only ONCE (no blind re-upload on retry, got ${driveUploadCount})`);
    assert(dbAttempts === 2, `DB persistence retried and succeeded on attempt 2 (got ${dbAttempts})`);
  });

  // =========================================================================
  // 5. Cancellation (Queued vs Transport)
  // =========================================================================
  console.log('\n• Suite: Cancellation (Queued vs Transport)');

  await test('cancelPendingUpload distinguishes queued cancellation from transport cancellation', async () => {
    const queue = new UploadQueue({ concurrency: 1 }); // concurrency 1 to queue 2nd task
    let transportAborted = false;

    // Task 1: in-flight task
    const p1 = queue.enqueue({
      id: 't_active',
      executor: async (ctx) => {
        ctx.signal.addEventListener('abort', () => {
          transportAborted = true;
        });
        await new Promise((r) => setTimeout(r, 40));
        return 'done';
      },
    });

    // Task 2: queued task
    const p2 = queue.enqueue({
      id: 't_queued',
      executor: async () => 'done2',
    });

    // Cancel queued task 2 while task 1 is running
    const status2Before = queue.getStatus('t_queued');
    assert(status2Before?.state === 'QUEUED', 'Task 2 is in QUEUED state');

    const cancelledQueued = queue.cancel('t_queued');
    assert(cancelledQueued === true, 'Queued task cancelled');

    const status2After = queue.getStatus('t_queued');
    assert(status2After?.state === 'CANCELLED', 'Task 2 state updated to CANCELLED');
    assert(status2After?.cancellationType === 'queued', 'Cancellation type is queued');

    // Cancel active task 1 in-flight
    const cancelledTransport = queue.cancel('t_active');
    assert(cancelledTransport === true, 'In-flight task cancelled');

    const status1After = queue.getStatus('t_active');
    assert(status1After?.state === 'CANCELLED', 'Task 1 state updated to CANCELLED');
    assert(status1After?.cancellationType === 'transport', 'Cancellation type is transport');
    assert(Boolean(transportAborted), 'AbortSignal notified transport cancellation');

    // Promises should reject with cancellation
    await assertAsyncThrows(() => p1, StorageErrorCode.UPLOAD_FAILED, 'Task 1 rejected');
    await assertAsyncThrows(() => p2, StorageErrorCode.UPLOAD_FAILED, 'Task 2 rejected');
  });

  // =========================================================================
  // 6. Progress Tracking & Status Inspection
  // =========================================================================
  console.log('\n• Suite: Stage-Based Progress Tracking');

  await test('Reports stage-based progress truthfully without fake byte streams', async () => {
    const stages: string[] = [];

    await uploadWithRetry({
      id: 'progress_task',
      onProgress: (p) => {
        stages.push(p.stage);
      },
      executor: async (ctx) => {
        ctx.setDriveFileId('drv_1');
        ctx.setFileRecordId(10);
        return 'success';
      },
    });

    assert(stages.includes('queued'), 'Recorded queued stage');
    assert(stages.includes('storage_upload'), 'Recorded storage_upload stage');
    assert(stages.includes('db_persistence'), 'Recorded db_persistence stage');
    assert(stages.includes('completed'), 'Recorded completed stage');

    const status = getUploadStatus('progress_task');
    assert(status?.state === 'COMPLETED', 'Status is COMPLETED');
    assert(status?.progress.percent === 100, 'Percent is 100');
  });

  // =========================================================================
  // 7. Cleanup & Reconciliation of Orphaned Uploads
  // =========================================================================
  console.log('\n• Suite: Cleanup & Orphaned Reconciliation');

  await test('clearCompletedUploads clears finished tasks from history', () => {
    const count = clearCompletedUploads();
    assert(count >= 1, `Cleared completed tasks from history (cleared ${count})`);
  });

  await test('cleanupOrphaned cleans up orphaned Drive files from failed/cancelled tasks', async () => {
    const queue = new UploadQueue({ concurrency: 2 });
    deletedDriveFiles.length = 0;

    // Enqueue task that succeeds on Drive, but permanently fails on DB persistence
    try {
      await queue.enqueue({
        id: 'orphaned_task_test',
        maxRetries: 0, // no retries, fail immediately
        executor: async (ctx) => {
          ctx.setDriveFileId('drive_orphaned_file_999');
          throw new StorageError(StorageErrorCode.PERMISSION_DENIED, 'Permanent schema violation');
        },
      });
    } catch {}

    const status = queue.getStatus('orphaned_task_test');
    assert(status?.state === 'FAILED', 'Task failed');
    assert(deletedDriveFiles.includes('drive_orphaned_file_999'), 'Orphaned Drive file was automatically cleaned up on terminal failure');
  });

  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${total} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total };
}
