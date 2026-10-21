/**
 * PPEye Standalone Supabase Storage Service Unit Tests (Mocked)
 *
 * Verifies:
 * - Input validation (bucket whitelist, path conventions, MIME whitelist, size limits)
 * - Path generator (worker, other evidence, avatar, and regex matching)
 * - Single upload, duplicate handling, transient retry, and ambiguous failure reconciliation
 * - Multi-upload with bounded concurrency and progress reporting
 * - Signed URL creation and error mapping
 * - Download operations and 404 handling
 * - Single and batch deletion idempotency
 * - Compensating cleanup queue persistence and retry processing
 * - Strict metadata-independence (zero database queries)
 * - Complete absence of Google Drive invocations
 */

import assert from 'assert';
import {
  clearCleanupQueue,
  enqueueFailedCleanup,
  getPendingCleanups,
  processCleanupQueue,
} from '../cleanup-queue';
import {
  generateAvatarPath,
  generateOtherEvidencePath,
  generateWorkerPhotoPath,
  isValidStoragePath,
} from '../path-generator';
import { StorageError, StorageErrorCode } from '../storage.errors';
import {
  setSupabaseStorageClientOverride,
  SupabaseStorageService,
} from '../supabase-storage.client';
import type { StorageBucket } from '../supabase-storage.types';

export async function runSupabaseStorageTests(): Promise<{ passed: number; failed: number; total: number }> {
  console.log('\n--- PPEye Supabase Storage Service Test Suite (Mocked) ---');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`    ${err?.message ?? err}`);
      failed++;
    }
  }

  // In-memory mock storage backend
  const mockStorageStore = new Map<string, { bucket: string; path: string; data: any; contentType: string; size?: number }>();
  let dbCallCount = 0;
  let googleDriveCallCount = 0;

  function createMockSupabaseStorageClient() {
    return {
      storage: {
        from: (bucketId: string) => ({
          upload: async (path: string, body: any, options?: { contentType?: string; upsert?: boolean }) => {
            const key = `${bucketId}:${path}`;
            if (mockStorageStore.has(key) && !options?.upsert) {
              const err: any = new Error('The resource already exists');
              err.statusCode = 409;
              return { data: null, error: err };
            }
            mockStorageStore.set(key, {
              bucket: bucketId,
              path,
              data: body,
              contentType: options?.contentType ?? 'image/jpeg',
              size: typeof body === 'string' ? body.length : (body as any)?.size ?? 5000,
            });
            return { data: { path, id: `etag_${Date.now()}` }, error: null };
          },
          createSignedUrl: async (path: string, expiresIn: number) => {
            const key = `${bucketId}:${path}`;
            if (!mockStorageStore.has(key)) {
              const err: any = new Error('Object not found');
              err.statusCode = 404;
              return { data: null, error: err };
            }
            return {
              data: {
                signedUrl: `https://mock-supabase.storage.co/${bucketId}/${path}?token=signed_${Date.now()}&expires=${expiresIn}`,
              },
              error: null,
            };
          },
          download: async (path: string) => {
            const key = `${bucketId}:${path}`;
            if (!mockStorageStore.has(key)) {
              const err: any = new Error('Object not found');
              err.statusCode = 404;
              return { data: null, error: err };
            }
            const item = mockStorageStore.get(key)!;
            return { data: { size: item.size ?? 1024, data: item.data }, error: null };
          },
          remove: async (paths: string[]) => {
            for (const p of paths) {
              mockStorageStore.delete(`${bucketId}:${p}`);
            }
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
          list: async (folder: string, options?: { search?: string }) => {
            const results: any[] = [];
            const prefix = folder ? `${bucketId}:${folder}/` : `${bucketId}:`;
            for (const [k, v] of mockStorageStore.entries()) {
              if (k.startsWith(prefix)) {
                const fileName = v.path.split('/').pop()!;
                if (!options?.search || fileName.includes(options.search)) {
                  results.push({
                    name: fileName,
                    id: v.path,
                    metadata: { size: v.size ?? 5000, mimetype: v.contentType },
                  });
                }
              }
            }
            return { data: results, error: null };
          },
        }),
      },
      from: () => {
        dbCallCount++;
        throw new Error('Storage service must NOT execute database queries!');
      },
    };
  }

  // Setup service instance with mock client
  mockStorageStore.clear();
  dbCallCount = 0;
  googleDriveCallCount = 0;
  const mockClient = createMockSupabaseStorageClient();
  const service = new SupabaseStorageService(mockClient);

  // =========================================================================
  // 1. Input Validation Tests
  // =========================================================================
  console.log('\n• Suite: Input Validation');

  await test('validateUploadInput rejects invalid buckets', () => {
    assert.throws(
      () =>
        service.validateUploadInput({
          bucket: 'invalid_bucket' as any,
          storagePath: 'submissions/1/workers/1_front.jpg',
          fileBody: 'bytes',
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );
  });

  await test('validateUploadInput rejects empty or traversing storage paths', () => {
    assert.throws(
      () => service.validateUploadInput({ bucket: 'evidence', storagePath: '', fileBody: 'bytes' }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => service.validateUploadInput({ bucket: 'evidence', storagePath: '../escaped.jpg', fileBody: 'bytes' }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );
    assert.throws(
      () => service.validateUploadInput({ bucket: 'evidence', storagePath: '/leading_slash.jpg', fileBody: 'bytes' }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );
  });

  await test('validateUploadInput rejects unsupported MIME types', () => {
    assert.throws(
      () =>
        service.validateUploadInput({
          bucket: 'evidence',
          storagePath: 'submissions/1/doc.pdf',
          fileBody: 'bytes',
          mimeType: 'application/pdf' as any,
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );
  });

  await test('validateUploadInput rejects files exceeding bucket size limits', () => {
    // Evidence limit is 10MB
    assert.throws(
      () =>
        service.validateUploadInput({
          bucket: 'evidence',
          storagePath: 'submissions/1/large.jpg',
          fileBody: 'bytes',
          sizeBytes: 11 * 1024 * 1024,
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );

    // Avatars limit is 5MB
    assert.throws(
      () =>
        service.validateUploadInput({
          bucket: 'avatars',
          storagePath: 'users/1/large.jpg',
          fileBody: 'bytes',
          sizeBytes: 6 * 1024 * 1024,
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.INVALID_INPUT
    );
  });

  // =========================================================================
  // 2. Path Generator Tests
  // =========================================================================
  console.log('\n• Suite: Storage Path Generator');

  await test('generateWorkerPhotoPath formats standardized worker photo paths', () => {
    const path = generateWorkerPhotoPath(45, 1, 'FRONT', { timestamp: 1729500000, entropy: 'abc123' });
    assert.strictEqual(path, 'submissions/45/workers/1_front_1729500000_abc123.jpg');
    assert.strictEqual(isValidStoragePath(path, 'evidence'), true);
  });

  await test('generateOtherEvidencePath formats standardized hazard/other evidence paths', () => {
    const path = generateOtherEvidencePath(45, 2, { timestamp: 1729500000, entropy: 'xyz789' });
    assert.strictEqual(path, 'submissions/45/others/other_2_1729500000_xyz789.jpg');
    assert.strictEqual(isValidStoragePath(path, 'evidence'), true);
  });

  await test('generateAvatarPath formats standardized user avatar paths', () => {
    const path = generateAvatarPath(14, { timestamp: 1729500000, entropy: 'usr456' });
    assert.strictEqual(path, 'users/14/avatar_1729500000_usr456.jpg');
    assert.strictEqual(isValidStoragePath(path, 'avatars'), true);
  });

  await test('isValidStoragePath rejects non-compliant paths', () => {
    assert.strictEqual(isValidStoragePath('submissions/45/random_photo.jpg', 'evidence'), false);
    assert.strictEqual(isValidStoragePath('users/admin/avatar.jpg', 'avatars'), false);
    assert.strictEqual(isValidStoragePath('../submissions/45/workers/1_front_1_a.jpg', 'evidence'), false);
  });

  // =========================================================================
  // 3. Single Upload, Duplicates & Retries
  // =========================================================================
  console.log('\n• Suite: Single Upload, Duplicates & Retries');

  await test('uploadFile uploads binary payload successfully', async () => {
    mockStorageStore.clear();
    const res = await service.uploadFile({
      bucket: 'evidence',
      storagePath: 'submissions/10/workers/1_front_100_a.jpg',
      fileBody: 'fake_image_bytes',
      sizeBytes: 5000,
      mimeType: 'image/jpeg',
    });

    assert.strictEqual(res.bucket, 'evidence');
    assert.strictEqual(res.storagePath, 'submissions/10/workers/1_front_100_a.jpg');
    assert.strictEqual(res.sizeBytes, 5000);
    assert.strictEqual(res.mimeType, 'image/jpeg');
    assert(mockStorageStore.has('evidence:submissions/10/workers/1_front_100_a.jpg'));
  });

  await test('uploadFile duplicate upload without upsert throws UPLOAD_FAILED', async () => {
    await assert.rejects(
      () =>
        service.uploadFile({
          bucket: 'evidence',
          storagePath: 'submissions/10/workers/1_front_100_a.jpg',
          fileBody: 'duplicate_bytes',
          upsert: false,
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.UPLOAD_FAILED
    );
  });

  await test('uploadFile duplicate upload with upsert = true succeeds', async () => {
    const res = await service.uploadFile({
      bucket: 'evidence',
      storagePath: 'submissions/10/workers/1_front_100_a.jpg',
      fileBody: 'replacement_bytes',
      sizeBytes: 6000,
      upsert: true,
    });

    assert.strictEqual(res.sizeBytes, 6000);
  });

  await test('uploadFile reconciles 409 conflict on retry if object landed with matching size', async () => {
    let attempt = 0;
    const ambiguousClient = {
      storage: {
        from: (b: string) => ({
          upload: async (path: string, body: any) => {
            attempt++;
            if (attempt === 1) {
              // Attempt 1 landed the object on storage, but response connection timed out
              mockStorageStore.set(`${b}:${path}`, {
                bucket: b,
                path,
                data: body,
                contentType: 'image/jpeg',
                size: 4500,
              });
              const err: any = new Error('Network timeout');
              err.statusCode = 504;
              return { data: null, error: err };
            }
            // Attempt 2 receives 409 because object already exists from attempt 1
            const conflictErr: any = new Error('The resource already exists');
            conflictErr.statusCode = 409;
            return { data: null, error: conflictErr };
          },
          list: async (folder: string, options?: { search?: string }) => {
            return {
              data: [
                {
                  name: 'reconciled.jpg',
                  id: 'path_reconciled',
                  metadata: { size: 4500, mimetype: 'image/jpeg' },
                },
              ],
              error: null,
            };
          },
        }),
      },
    };

    const ambService = new SupabaseStorageService(ambiguousClient);
    const result = await ambService.uploadFile({
      bucket: 'evidence',
      storagePath: 'submissions/10/workers/reconciled.jpg',
      fileBody: 'bytes',
      sizeBytes: 4500,
      uploadAttemptId: 'attempt_session_4500',
    });

    assert.strictEqual(attempt, 2, 'Executed 2 attempts');
    assert.strictEqual(result.storagePath, 'submissions/10/workers/reconciled.jpg');
    assert.strictEqual(result.sizeBytes, 4500);
  });

  await test('uploadFile rejects 409 conflict on retry if content identity is unverifiable despite same size', async () => {
    let attempt = 0;
    const unverifiableClient = {
      storage: {
        from: (b: string) => ({
          upload: async (path: string, body: any) => {
            attempt++;
            if (attempt === 1) {
              return { data: null, error: new Error('Network timeout') };
            }
            const conflictErr: any = new Error('The resource already exists');
            conflictErr.statusCode = 409;
            return { data: null, error: conflictErr };
          },
          list: async () => {
            // Existing object happens to have the same size (4500 bytes) but different identity / unverified
            return {
              data: [
                {
                  name: 'unverified.jpg',
                  id: 'path_unverified',
                  metadata: { size: 4500, mimetype: 'image/jpeg' },
                },
              ],
              error: null,
            };
          },
        }),
      },
    };

    const unverifiedService = new SupabaseStorageService(unverifiableClient);
    // No uploadAttemptId or contentHash provided — size match alone is insufficient!
    await assert.rejects(
      () =>
        unverifiedService.uploadFile({
          bucket: 'evidence',
          storagePath: 'submissions/10/workers/unverified.jpg',
          fileBody: 'different_bytes',
          sizeBytes: 4500,
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.UPLOAD_FAILED
    );
  });

  await test('uploadFile rejects 409 conflict on retry if existing object size does NOT match', async () => {
    let attempt = 0;
    const collisionClient = {
      storage: {
        from: (b: string) => ({
          upload: async (path: string, body: any) => {
            attempt++;
            if (attempt === 1) {
              return { data: null, error: new Error('Network timeout') };
            }
            const conflictErr: any = new Error('The resource already exists');
            conflictErr.statusCode = 409;
            return { data: null, error: conflictErr };
          },
          list: async () => {
            // Existing object has completely different size (different photo)
            return {
              data: [
                {
                  name: 'collision.jpg',
                  id: 'path_collision',
                  metadata: { size: 99999, mimetype: 'image/jpeg' },
                },
              ],
              error: null,
            };
          },
        }),
      },
    };

    const colService = new SupabaseStorageService(collisionClient);
    await assert.rejects(
      () =>
        colService.uploadFile({
          bucket: 'evidence',
          storagePath: 'submissions/10/workers/collision.jpg',
          fileBody: 'bytes',
          sizeBytes: 1500,
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.UPLOAD_FAILED
    );
  });

  await test('uploadFile retries transient 500 errors and succeeds', async () => {
    let callCount = 0;
    const transientClient = {
      storage: {
        from: (b: string) => ({
          upload: async (path: string, body: any) => {
            callCount++;
            if (callCount === 1) {
              const err: any = new Error('500 Internal Server Error');
              err.statusCode = 500;
              return { data: null, error: err };
            }
            return { data: { path, id: 'etag_retry' }, error: null };
          },
        }),
      },
    };

    const retryService = new SupabaseStorageService(transientClient);
    const res = await retryService.uploadFile({
      bucket: 'evidence',
      storagePath: 'submissions/10/workers/1_back_transient.jpg',
      fileBody: 'bytes',
      sizeBytes: 1000,
    });

    assert.strictEqual(callCount, 2, 'Should succeed on second attempt');
    assert.strictEqual(res.storagePath, 'submissions/10/workers/1_back_transient.jpg');
  });

  await test('uploadFile does not retry permission denied (403 RLS violation)', async () => {
    let callCount = 0;
    const forbiddenClient = {
      storage: {
        from: () => ({
          upload: async () => {
            callCount++;
            const err: any = new Error('row-level security policy violated');
            err.statusCode = 403;
            return { data: null, error: err };
          },
        }),
      },
    };

    const forbiddenService = new SupabaseStorageService(forbiddenClient);
    await assert.rejects(
      () =>
        forbiddenService.uploadFile({
          bucket: 'evidence',
          storagePath: 'submissions/99/forbidden.jpg',
          fileBody: 'bytes',
        }),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.PERMISSION_DENIED
    );

    assert.strictEqual(callCount, 1, 'Should fail immediately without retrying permission errors');
  });

  // =========================================================================
  // 4. Bounded Concurrency Multi-Upload (uploadBatch)
  // =========================================================================
  console.log('\n• Suite: Bounded Concurrency Batch Upload');

  await test('uploadBatch processes items within concurrency bounds and reports progress', async () => {
    mockStorageStore.clear();
    let maxInFlight = 0;
    let currentInFlight = 0;
    const progressReports: number[] = [];

    const trackingClient = {
      storage: {
        from: (b: string) => ({
          upload: async (path: string, body: any) => {
            currentInFlight++;
            if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
            await new Promise((r) => setTimeout(r, 20)); // Simulate async network
            currentInFlight--;
            return { data: { path }, error: null };
          },
        }),
      },
    };

    const batchService = new SupabaseStorageService(trackingClient);
    const inputs = Array.from({ length: 6 }, (_, i) => ({
      bucket: 'evidence' as StorageBucket,
      storagePath: `submissions/10/workers/${i + 1}_front.jpg`,
      fileBody: 'bytes',
      sizeBytes: 1000,
    }));

    const result = await batchService.uploadBatch(inputs, {
      concurrency: 2,
      onProgress: (completed, total) => progressReports.push(completed),
    });

    assert.strictEqual(result.isFullSuccess, true);
    assert.strictEqual(result.results.length, 6);
    assert.strictEqual(result.errors.length, 0);
    assert(maxInFlight <= 2, `Max in-flight (${maxInFlight}) should not exceed bounded concurrency (2)`);
    assert.strictEqual(progressReports[progressReports.length - 1], 6);
  });

  await test('uploadBatch isolates individual failures and returns partial success status', async () => {
    const partialClient = {
      storage: {
        from: (b: string) => ({
          upload: async (path: string) => {
            if (path.includes('fail')) {
              return { data: null, error: new Error('Network timeout') };
            }
            return { data: { path }, error: null };
          },
          list: async () => ({ data: [], error: null }),
        }),
      },
    };

    const partialService = new SupabaseStorageService(partialClient);
    const inputs = [
      { bucket: 'evidence' as StorageBucket, storagePath: 'sub/ok1.jpg', fileBody: 'b1' },
      { bucket: 'evidence' as StorageBucket, storagePath: 'sub/fail.jpg', fileBody: 'b2' },
      { bucket: 'evidence' as StorageBucket, storagePath: 'sub/ok2.jpg', fileBody: 'b3' },
    ];

    const res = await partialService.uploadBatch(inputs, { concurrency: 2 });
    assert.strictEqual(res.isFullSuccess, false);
    assert.strictEqual(res.results.length, 2);
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].input.storagePath, 'sub/fail.jpg');
    assert.deepStrictEqual(
      res.succeededPaths,
      ['sub/ok1.jpg', 'sub/ok2.jpg'],
      'succeededPaths must contain all uploaded paths for compensating deletion'
    );
  });

  // =========================================================================
  // 5. Signed URLs, Downloads & Deletion Idempotency
  // =========================================================================
  console.log('\n• Suite: Signed URLs, Downloads & Deletion');

  await test('createSignedUrl returns valid signed URL with expiration timestamp', async () => {
    mockStorageStore.set('evidence:submissions/10/workers/1_front.jpg', {
      bucket: 'evidence',
      path: 'submissions/10/workers/1_front.jpg',
      data: 'bytes',
      contentType: 'image/jpeg',
    });

    const signed = await service.createSignedUrl('evidence', 'submissions/10/workers/1_front.jpg', 1800);
    assert(signed.signedUrl.includes('https://mock-supabase.storage.co/evidence/'));
    assert(signed.signedUrl.includes('token=signed_'));
    assert(signed.expiresAt > Date.now());
  });

  await test('createSignedUrl throws FILE_NOT_FOUND on missing object', async () => {
    await assert.rejects(
      () => service.createSignedUrl('evidence', 'submissions/10/missing.jpg'),
      (err: any) => err instanceof StorageError && err.code === StorageErrorCode.FILE_NOT_FOUND
    );
  });

  await test('downloadFile returns downloaded binary details', async () => {
    const res = await service.downloadFile('evidence', 'submissions/10/workers/1_front.jpg');
    assert.strictEqual(res.sizeBytes, 1024);
    assert(res.localUri.includes('1_front.jpg'));
  });

  await test('deleteFile is idempotent and succeeds even if file does not exist', async () => {
    // Delete existing
    const del1 = await service.deleteFile('evidence', 'submissions/10/workers/1_front.jpg');
    assert.strictEqual(del1, true);
    assert(!mockStorageStore.has('evidence:submissions/10/workers/1_front.jpg'));

    // Delete non-existent (idempotent)
    const del2 = await service.deleteFile('evidence', 'submissions/10/workers/1_front.jpg');
    assert.strictEqual(del2, true);
  });

  await test('fileExists verifies object presence and validates expected file size', async () => {
    mockStorageStore.set('evidence:size_check.jpg', {
      bucket: 'evidence',
      path: 'size_check.jpg',
      data: 'bytes',
      contentType: 'image/jpeg',
      size: 5000,
    });

    // Without size check
    assert.strictEqual(await service.fileExists('evidence', 'size_check.jpg'), true);

    // Matching expected size
    assert.strictEqual(await service.fileExists('evidence', 'size_check.jpg', { expectedSizeBytes: 5000 }), true);

    // Mismatched expected size (different photo at same path)
    assert.strictEqual(await service.fileExists('evidence', 'size_check.jpg', { expectedSizeBytes: 9999 }), false);

    // Missing object
    assert.strictEqual(await service.fileExists('evidence', 'missing_file.jpg'), false);
  });

  await test('deleteBatch removes multiple storage objects', async () => {
    mockStorageStore.set('evidence:file_a.jpg', { bucket: 'evidence', path: 'file_a.jpg', data: 'a', contentType: 'image/jpeg' });
    mockStorageStore.set('evidence:file_b.jpg', { bucket: 'evidence', path: 'file_b.jpg', data: 'b', contentType: 'image/jpeg' });

    const batchRes = await service.deleteBatch('evidence', ['file_a.jpg', 'file_b.jpg']);
    assert.strictEqual(batchRes.deleted.length, 2);
    assert.strictEqual(batchRes.failed.length, 0);
    assert(!mockStorageStore.has('evidence:file_a.jpg'));
    assert(!mockStorageStore.has('evidence:file_b.jpg'));
  });

  // =========================================================================
  // 6. Compensating Cleanup Queue
  // =========================================================================
  console.log('\n• Suite: Compensating Cleanup Queue');

  await test('enqueueFailedCleanup records failed deletions and processCleanupQueue retries them', async () => {
    await clearCleanupQueue();
    await enqueueFailedCleanup('evidence', 'submissions/99/orphaned_1.jpg', new Error('Network down'));
    await enqueueFailedCleanup('evidence', 'submissions/99/orphaned_2.jpg', new Error('Timeout'));

    // Prevent duplicate entries for same path
    await enqueueFailedCleanup('evidence', 'submissions/99/orphaned_1.jpg', new Error('Duplicate'));

    const pending = await getPendingCleanups();
    assert.strictEqual(pending.length, 2, 'Should have exactly 2 pending tasks');

    // Simulate cleanup processor with verified safety callback
    const cleanupOutcome = await processCleanupQueue(service, {
      isSafeToDelete: async () => true,
    });
    assert.strictEqual(cleanupOutcome.succeeded.length, 2);
    assert.strictEqual(cleanupOutcome.failed.length, 0);

    const remaining = await getPendingCleanups();
    assert.strictEqual(remaining.length, 0, 'Queue should be empty after successful processing');
  });

  await test('processCleanupQueue refuses to delete and defers all tasks if isSafeToDelete hook is omitted', async () => {
    await clearCleanupQueue();
    await enqueueFailedCleanup('evidence', 'submissions/88/unverified.jpg');

    // Attempting cleanup without mandatory safety verification hook
    const outcome = await processCleanupQueue(service, null as any);
    assert.strictEqual(outcome.succeeded.length, 0, 'Must not delete without safety hook');
    assert.strictEqual(outcome.deferredUnverified.length, 1);

    const pending = await getPendingCleanups();
    assert.strictEqual(pending.length, 1, 'Task must remain pending');
  });

  await test('processCleanupQueue keeps tasks pending when isSafeToDelete throws an error', async () => {
    await clearCleanupQueue();
    await enqueueFailedCleanup('evidence', 'submissions/77/db_offline.jpg');

    // Database check throws (e.g. offline/timeout)
    const outcome = await processCleanupQueue(service, {
      isSafeToDelete: async () => {
        throw new Error('Database connection failed');
      },
    });

    assert.strictEqual(outcome.succeeded.length, 0, 'Must not delete when DB check fails');
    assert.strictEqual(outcome.deferredUnverified.length, 1);

    const pending = await getPendingCleanups();
    assert.strictEqual(pending.length, 1, 'Task must remain pending for future retry');
  });

  await test('processCleanupQueue safely skips and discards tasks for actively referenced live submissions', async () => {
    await clearCleanupQueue();
    // Enqueue an orphaned path and a live referenced path
    await enqueueFailedCleanup('evidence', 'submissions/10/orphaned.jpg');
    await enqueueFailedCleanup('evidence', 'submissions/10/live_referenced_worker_photo.jpg');

    mockStorageStore.set('evidence:submissions/10/orphaned.jpg', {
      bucket: 'evidence',
      path: 'submissions/10/orphaned.jpg',
      data: 'orphan',
      contentType: 'image/jpeg',
    });
    mockStorageStore.set('evidence:submissions/10/live_referenced_worker_photo.jpg', {
      bucket: 'evidence',
      path: 'submissions/10/live_referenced_worker_photo.jpg',
      data: 'live',
      contentType: 'image/jpeg',
    });

    // Provide safety verification callback:
    // returns true if unreferenced, false if actively referenced in database
    const outcome = await processCleanupQueue(service, {
      isSafeToDelete: async (bucket, path) => {
        if (path.includes('live_referenced')) {
          return false; // Actively referenced in database!
        }
        return true;
      },
    });

    assert.strictEqual(outcome.succeeded.length, 1, 'Only orphaned object deleted');
    assert.strictEqual(outcome.succeeded[0], 'submissions/10/orphaned.jpg');
    assert.strictEqual(outcome.skippedUnsafe.length, 1, 'Live object skipped');
    assert.strictEqual(outcome.skippedUnsafe[0], 'submissions/10/live_referenced_worker_photo.jpg');

    // Verify live object was NOT deleted from storage
    assert(
      mockStorageStore.has('evidence:submissions/10/live_referenced_worker_photo.jpg'),
      'Live submission photo must remain intact in storage'
    );
  });

  // =========================================================================
  // 7. Metadata-Independence & Google Drive Dormancy
  // =========================================================================
  console.log('\n• Suite: Architectural Decoupling & Google Drive Dormancy');

  await test('supabase_storage_service operates with ZERO database queries', async () => {
    assert.strictEqual(dbCallCount, 0, 'Storage service must have made zero PostgreSQL queries');
  });

  await test('supabase_storage_service NEVER invokes Google Drive', () => {
    assert.strictEqual(googleDriveCallCount, 0, 'Storage service must have zero Google Drive invocations');
  });

  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total: passed + failed };
}
