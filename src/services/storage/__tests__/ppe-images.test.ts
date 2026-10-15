/**
 * PPEye PPE Image Helpers Unit Tests (Mocked)
 *
 * Verifies:
 * - Worker instance identity: relationships maintained strictly by workerInstanceId, never sequence as identity.
 * - Paired uploads: uploadWorkerImagePair handles both FRONT & BACK.
 * - Duplicate prevention: prevents multiple active images on the same side for a worker.
 * - Partial failure: front succeeds while back fails; front is preserved and not discarded.
 * - Retries: retrying a failed pair reuses existing active images without re-uploading or duplicating.
 * - Replacement rollback: upload or DB failure preserves old image and rolls back new files.
 * - Historical evidence: retains old file records when reviews exist or retention is requested.
 */

import {
  getOrCreateWorkerInstance,
  getWorkerImages,
  getWorkerInstance,
  replacePPEImage,
  setPpeImagesDriveDeleterMock,
  setPpeImagesDriveUploaderMock,
  setPpeImagesSupabaseOverride,
  uploadPPEImage,
  uploadWorkerImagePair,
  PartialUploadError,
} from '../ppe-images';
import { StorageErrorCode } from '../storage.errors';

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

// ---------------------------------------------------------------------------
// In-Memory Database and Storage Simulation
// ---------------------------------------------------------------------------

interface MockWorkerInstance {
  id: number;
  submission_id: number;
  sequence_no: number;
  created_at: string;
}

interface MockPPEImage {
  id: number;
  worker_instance_id: number;
  file_id: number;
  side: 'FRONT' | 'BACK';
  created_at: string;
}

interface MockFileRow {
  id: number;
  storage_provider: string;
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: number | null;
  created_at: string;
}

interface MockReview {
  id: number;
  worker_instance_id: number;
  reviewer_id: number;
  verdict: 'SAFE' | 'UNSAFE';
  reviewed_at: string;
}

export async function runPPEImagesTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  // State
  let workerInstances: MockWorkerInstance[] = [];
  let ppeImages: MockPPEImage[] = [];
  let files: MockFileRow[] = [];
  let reviews: MockReview[] = [];

  let nextWorkerId = 1;
  let nextPPEImageId = 1;
  let nextFileId = 1;
  let nextReviewId = 1;

  // Drive storage state
  const remoteDriveFiles = new Map<string, { fileName: string; localUri: string; folderId?: string }>();
  let failDriveUploadFor: string | null = null;
  let simulatePpeImagesUpdateFailure = false;

  function resetState() {
    workerInstances = [];
    ppeImages = [];
    files = [];
    reviews = [];
    nextWorkerId = 1;
    nextPPEImageId = 1;
    nextFileId = 1;
    nextReviewId = 1;
    remoteDriveFiles.clear();
    failDriveUploadFor = null;
    simulatePpeImagesUpdateFailure = false;
  }

  // Drive Uploader & Deleter Mocks
  setPpeImagesDriveUploaderMock(async (params) => {
    if (failDriveUploadFor && params.localUri.includes(failDriveUploadFor)) {
      throw new Error(`Simulated Drive upload error for ${params.fileName}`);
    }
    const fileId = `drive_file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    remoteDriveFiles.set(fileId, {
      fileName: params.fileName,
      localUri: params.localUri,
      folderId: params.folderId,
    });
    return {
      fileId,
      fileName: params.fileName,
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    };
  });

  setPpeImagesDriveDeleterMock(async (fileId) => {
    remoteDriveFiles.delete(fileId);
    return true;
  });

  // Supabase Mock Client
  const mockSupabase: any = {
    from: (table: string) => {
      let selectedCols = '*';
      const filters: Array<{ col: string; op: string; val: any }> = [];

      const queryBuilder: any = {
        select: (cols: string = '*') => {
          selectedCols = cols;
          return queryBuilder;
        },
        eq: (col: string, val: any) => {
          filters.push({ col, op: 'eq', val });
          return queryBuilder;
        },
        insert: (rows: any) => {
          const rowArray = Array.isArray(rows) ? rows : [rows];
          const inserted: any[] = [];

          for (const item of rowArray) {
            if (table === 'ppe_worker_instances') {
              const newRow: MockWorkerInstance = {
                id: nextWorkerId++,
                submission_id: item.submission_id,
                sequence_no: item.sequence_no,
                created_at: new Date().toISOString(),
              };
              workerInstances.push(newRow);
              inserted.push(newRow);
            } else if (table === 'ppe_images') {
              // Check unique constraint on (worker_instance_id, side)
              const existing = ppeImages.find(
                (p) => p.worker_instance_id === item.worker_instance_id && p.side === item.side
              );
              if (existing) {
                return {
                  select: () => ({
                    single: async () => ({
                      data: null,
                      error: { message: 'duplicate key value violates unique constraint "idx_ppe_images_worker_side"', code: '23505' },
                    }),
                  }),
                };
              }
              const newRow: MockPPEImage = {
                id: nextPPEImageId++,
                worker_instance_id: item.worker_instance_id,
                file_id: item.file_id,
                side: item.side,
                created_at: new Date().toISOString(),
              };
              ppeImages.push(newRow);
              inserted.push(newRow);
            } else if (table === 'files') {
              // Check unique constraint on (storage_provider, provider_file_id)
              const existing = files.find(
                (f) => f.storage_provider === item.storage_provider && f.provider_file_id === item.provider_file_id
              );
              if (existing) {
                return {
                  select: () => ({
                    single: async () => ({
                      data: null,
                      error: { message: 'duplicate key value violates unique constraint "idx_files_provider_file"', code: '23505' },
                    }),
                  }),
                };
              }
              const newRow: MockFileRow = {
                id: nextFileId++,
                storage_provider: item.storage_provider ?? 'GOOGLE_DRIVE',
                provider_file_id: item.provider_file_id,
                file_name: item.file_name,
                mime_type: item.mime_type ?? null,
                size_bytes: item.size_bytes ?? null,
                created_by: item.created_by ?? null,
                created_at: new Date().toISOString(),
              };
              files.push(newRow);
              inserted.push(newRow);
            } else if (table === 'ppe_reviews') {
              const newRow: MockReview = {
                id: nextReviewId++,
                worker_instance_id: item.worker_instance_id,
                reviewer_id: item.reviewer_id,
                verdict: item.verdict,
                reviewed_at: new Date().toISOString(),
              };
              reviews.push(newRow);
              inserted.push(newRow);
            }
          }

          return {
            select: () => ({
              single: async () => ({ data: inserted[0] ?? null, error: null }),
            }),
          };
        },
        update: (values: any) => ({
          eq: (col: string, val: any) => ({
            select: () => ({
              single: async () => {
                if (table === 'ppe_images' && simulatePpeImagesUpdateFailure) {
                  return { data: null, error: { message: 'Database update failed', code: '500' } };
                }

                if (table === 'ppe_images') {
                  const target = ppeImages.find((p) => (p as any)[col] === val);
                  if (!target) return { data: null, error: { message: 'Not found' } };
                  Object.assign(target, values);
                  return { data: target, error: null };
                }
                if (table === 'files') {
                  const target = files.find((f) => (f as any)[col] === val);
                  if (!target) return { data: null, error: { message: 'Not found' } };
                  Object.assign(target, values);
                  return { data: target, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        }),
        delete: () => ({
          eq: async (col: string, val: any) => {
            if (table === 'files') {
              files = files.filter((f) => (f as any)[col] !== val);
            } else if (table === 'ppe_images') {
              ppeImages = ppeImages.filter((p) => (p as any)[col] !== val);
            }
            return { error: null };
          },
        }),
        maybeSingle: async () => {
          let list: any[] = [];
          if (table === 'ppe_worker_instances') list = workerInstances;
          if (table === 'ppe_images') list = ppeImages;
          if (table === 'files') list = files;
          if (table === 'ppe_reviews') list = reviews;
          if (table === 'ppe_submissions') list = [{ id: 10, site_name: 'Metro Site North' }];

          for (const f of filters) {
            list = list.filter((item) => item[f.col] === f.val);
          }
          return { data: list[0] ?? null, error: null };
        },
        single: async () => {
          return queryBuilder.maybeSingle();
        },
        then: (resolve: any) => {
          let list: any[] = [];
          if (table === 'ppe_worker_instances') list = workerInstances;
          if (table === 'files') list = files;
          if (table === 'ppe_reviews') list = reviews;
          if (table === 'ppe_images') {
            // Join with files table if select query includes files
            list = ppeImages.map((img) => {
              const file = files.find((f) => f.id === img.file_id);
              return {
                ...img,
                files: file ?? null,
              };
            });
          }

          for (const f of filters) {
            list = list.filter((item) => item[f.col] === f.val);
          }

          resolve({ data: list, error: null });
        },
      };

      return queryBuilder;
    },
  };

  setPpeImagesSupabaseOverride(mockSupabase);

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

  console.log('\n--- PPEye PPE Image Helpers Test Suite ---');

  // =========================================================================
  // 1. Worker Instance Identity & Relationships
  // =========================================================================
  console.log('\n• Suite: Worker Instance Identity & Relationships');

  await test('getOrCreateWorkerInstance creates instance and maintains idempotency', async () => {
    resetState();
    const inst1 = await getOrCreateWorkerInstance(100, 1);
    assert(inst1.id === 1, 'inst1 should have id 1');
    assert(inst1.sequence_no === 1, 'inst1 sequence_no matches');

    // Call again with same submissionId and sequenceNo -> returns same instance
    const inst2 = await getOrCreateWorkerInstance(100, 1);
    assert(inst2.id === 1, 'inst2 must return existing instance id 1');
    assert(workerInstances.length === 1, 'only 1 worker instance should exist');
  });

  await test('Relationships use workerInstanceId as identity, never sequence number', async () => {
    resetState();
    // Two different submissions each have a worker with sequence_no: 1
    const sub1Worker1 = await getOrCreateWorkerInstance(101, 1);
    const sub2Worker1 = await getOrCreateWorkerInstance(102, 1);

    assert(sub1Worker1.id !== sub2Worker1.id, 'Different submissions have distinct workerInstanceIds');

    // Upload front photo for sub1Worker1
    const img1 = await uploadPPEImage({
      workerInstanceId: sub1Worker1.id,
      side: 'FRONT',
      localUri: 'file:///cam/sub1_w1_front.jpg',
      siteName: 'Site 1',
    });

    // Upload front photo for sub2Worker1
    const img2 = await uploadPPEImage({
      workerInstanceId: sub2Worker1.id,
      side: 'FRONT',
      localUri: 'file:///cam/sub2_w1_front.jpg',
      siteName: 'Site 2',
    });

    assert(img1.workerInstanceId === sub1Worker1.id, 'img1 belongs to sub1 worker');
    assert(img2.workerInstanceId === sub2Worker1.id, 'img2 belongs to sub2 worker');

    // Images for sub1Worker1 must only return img1
    const sub1Images = await getWorkerImages(sub1Worker1.id);
    assert(sub1Images.front?.id === img1.id, 'sub1 worker has img1');
    assert(sub1Images.back === null, 'sub1 worker has no back yet');

    const sub2Images = await getWorkerImages(sub2Worker1.id);
    assert(sub2Images.front?.id === img2.id, 'sub2 worker has img2');
  });

  await test('uploadPPEImage rejects non-existent workerInstanceId', async () => {
    resetState();
    await assertAsyncThrows(
      () =>
        uploadPPEImage({
          workerInstanceId: 9999,
          side: 'FRONT',
          localUri: 'file:///cam/photo.jpg',
        }),
      StorageErrorCode.INVALID_INPUT,
      'Non-existent worker instance must reject'
    );
  });

  // =========================================================================
  // 2. Paired Uploads (FRONT & BACK)
  // =========================================================================
  console.log('\n• Suite: Paired Uploads');

  await test('uploadWorkerImagePair uploads and links both FRONT and BACK images', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(200, 2);

    const pairResult = await uploadWorkerImagePair({
      workerInstanceId: worker.id,
      frontLocalUri: 'file:///cam/w2_front.jpg',
      backLocalUri: 'file:///cam/w2_back.jpg',
      siteName: 'West Terminal',
    });

    assert(pairResult.success === true, 'paired upload succeeds');
    assert(pairResult.front !== null, 'front is present');
    assert(pairResult.back !== null, 'back is present');
    assert(pairResult.front?.side === 'FRONT', 'front has side FRONT');
    assert(pairResult.back?.side === 'BACK', 'back has side BACK');
    assert(pairResult.front?.workerInstanceId === worker.id, 'front links to worker');
    assert(pairResult.back?.workerInstanceId === worker.id, 'back links to worker');

    // Verify database rows
    assert(ppeImages.length === 2, '2 ppe_images records in database');
    assert(files.length === 2, '2 files records in database');
  });

  await test('uploadPPEImage prevents duplicate active images on same side', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(200, 3);

    const imgFirst = await uploadPPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      localUri: 'file:///cam/first_front.jpg',
    });

    // Call again with overwrite: false (default)
    const imgSecond = await uploadPPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      localUri: 'file:///cam/second_front.jpg',
      overwrite: false,
    });

    assert(imgFirst.id === imgSecond.id, 'Duplicate call returns existing active image');
    assert(ppeImages.length === 1, 'No duplicate record created in ppe_images');
  });

  // =========================================================================
  // 3. Partial Failure and Retries
  // =========================================================================
  console.log('\n• Suite: Partial Failure & Retries');

  await test('uploadWorkerImagePair preserves succeeded front image on partial failure', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(300, 1);

    // Make back image upload fail
    failDriveUploadFor = 'broken_back';

    const result = await uploadWorkerImagePair({
      workerInstanceId: worker.id,
      frontLocalUri: 'file:///cam/good_front.jpg',
      backLocalUri: 'file:///cam/broken_back.jpg',
      throwOnPartialFailure: false,
    });

    assert(result.success === false, 'Result indicates partial failure');
    assert(result.front !== null, 'Front photo was successfully uploaded and persisted');
    assert(result.back === null, 'Back photo is null');
    assert(result.errors?.back !== undefined, 'Back error is recorded');

    // Crucial: front image is in database and not rolled back
    const stored = await getWorkerImages(worker.id);
    assert(stored.front !== null, 'Front image is stored and active in DB');
    assert(stored.back === null, 'Back image is not present');
  });

  await test('uploadWorkerImagePair with throwOnPartialFailure throws PartialUploadError', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(300, 2);
    failDriveUploadFor = 'fail_back';

    let caughtError: PartialUploadError | null = null;
    try {
      await uploadWorkerImagePair({
        workerInstanceId: worker.id,
        frontLocalUri: 'file:///cam/front.jpg',
        backLocalUri: 'file:///cam/fail_back.jpg',
        throwOnPartialFailure: true,
      });
    } catch (err: any) {
      if (err instanceof PartialUploadError) {
        caughtError = err;
      }
    }

    assert(caughtError !== null, 'Throws PartialUploadError');
    assert(caughtError?.partialResult.front !== null, 'Partial error contains succeeded front result');
  });

  await test('Retrying uploadWorkerImagePair reuses active front without duplicate upload', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(300, 3);

    // Initial partial failure
    failDriveUploadFor = 'flaky_back';
    await uploadWorkerImagePair({
      workerInstanceId: worker.id,
      frontLocalUri: 'file:///cam/front_attempt1.jpg',
      backLocalUri: 'file:///cam/flaky_back.jpg',
    });

    const frontAfterFirstAttempt = (await getWorkerImages(worker.id)).front;
    assert(frontAfterFirstAttempt !== null, 'Front is active');

    // Retry after fixing network / retry with good back URI
    failDriveUploadFor = null;
    const retryResult = await uploadWorkerImagePair({
      workerInstanceId: worker.id,
      frontLocalUri: 'file:///cam/front_attempt1.jpg',
      backLocalUri: 'file:///cam/fixed_back.jpg',
    });

    assert(retryResult.success === true, 'Retry succeeds');
    assert(retryResult.front?.id === frontAfterFirstAttempt?.id, 'Front was reused, not re-uploaded');
    assert(retryResult.back !== null, 'Back is now complete');
    assert(ppeImages.length === 2, 'Exactly 2 ppe_images rows (1 FRONT, 1 BACK)');
  });

  // =========================================================================
  // 4. Replacement Rollback & Historical Evidence
  // =========================================================================
  console.log('\n• Suite: Replacement Rollback & Historical Evidence');

  await test('replacePPEImage rolls back and preserves old image if storage upload fails', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(400, 1);

    const initialFront = await uploadPPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      localUri: 'file:///cam/original_front.jpg',
    });

    // Attempt replacement with failing drive upload
    failDriveUploadFor = 'failing_replacement';

    await assertAsyncThrows(
      () =>
        replacePPEImage({
          workerInstanceId: worker.id,
          side: 'FRONT',
          newLocalUri: 'file:///cam/failing_replacement.jpg',
        }),
      StorageErrorCode.UPLOAD_FAILED,
      'Upload failure during replacement should throw'
    );

    // Verify old image is intact
    const currentImages = await getWorkerImages(worker.id);
    assert(currentImages.front?.id === initialFront.id, 'Old image remains active');
    assert(currentImages.front?.file.id === initialFront.file.id, 'Old file remains linked');
  });

  await test('replacePPEImage rolls back new file if database update fails', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(400, 2);

    const initialFront = await uploadPPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      localUri: 'file:///cam/original_front.jpg',
    });

    const initialFilesCount = files.length;

    // Simulate database update failure
    simulatePpeImagesUpdateFailure = true;

    await assertAsyncThrows(
      () =>
        replacePPEImage({
          workerInstanceId: worker.id,
          side: 'FRONT',
          newLocalUri: 'file:///cam/new_front.jpg',
        }),
      StorageErrorCode.PROVIDER_ERROR,
      'DB update failure during replacement should throw'
    );

    simulatePpeImagesUpdateFailure = false;

    // Rollback check: new file should have been deleted, files count unchanged
    assert(files.length === initialFilesCount, 'Newly created file row was cleaned up on rollback');
    const currentImages = await getWorkerImages(worker.id);
    assert(currentImages.front?.id === initialFront.id, 'Old image is preserved as active');
  });

  await test('replacePPEImage retains old file record when review exists for worker', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(400, 3);

    const initialFront = await uploadPPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      localUri: 'file:///cam/reviewed_front.jpg',
    });

    // Add a review in ppe_reviews for this worker
    reviews.push({
      id: nextReviewId++,
      worker_instance_id: worker.id,
      reviewer_id: 88,
      verdict: 'UNSAFE',
      reviewed_at: new Date().toISOString(),
    });

    // Replace image with retainHistoricalEvidence: false (should still be preserved because reviewed)
    const replacement = await replacePPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      newLocalUri: 'file:///cam/corrected_front.jpg',
      retainHistoricalEvidence: false,
    });

    assert(replacement.file.id !== initialFront.file.id, 'Active image switched to new file');

    // Both old file and new file must exist in files table for audit trail
    const oldFileInDb = files.find((f) => f.id === initialFront.file.id);
    const newFileInDb = files.find((f) => f.id === replacement.file.id);

    assert(oldFileInDb !== undefined, 'Old file record retained as historical evidence for review');
    assert(newFileInDb !== undefined, 'New file record exists in database');
  });

  await test('replacePPEImage retains old file record by default when requested', async () => {
    resetState();
    const worker = await getOrCreateWorkerInstance(400, 4);

    const initialFront = await uploadPPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      localUri: 'file:///cam/v1_front.jpg',
    });

    const replacement = await replacePPEImage({
      workerInstanceId: worker.id,
      side: 'FRONT',
      newLocalUri: 'file:///cam/v2_front.jpg',
      retainHistoricalEvidence: true,
    });

    const oldFileInDb = files.find((f) => f.id === initialFront.file.id);
    assert(oldFileInDb !== undefined, 'Old file record retained when retainHistoricalEvidence is true');
  });

  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${total} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total };
}
