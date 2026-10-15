/**
 * PPEye High-Level Submission Image Service Unit Tests (Mocked)
 *
 * Verifies:
 * 1. Validation:
 *    - Incomplete worker pairs (missing front only, missing back only, missing both).
 *    - Structured validation issues for preview warnings (ERROR, WARNING, INFO).
 *    - Optional Others evidence (0 allowed, >0 validated).
 *    - Empty worker list rejected.
 * 2. Upload Coordination & Database Persistence:
 *    - Coordinates Google Drive uploads, files rows, worker instance creation, ppe_images, other_images.
 *    - Exactly one active FRONT and BACK per worker instance.
 *    - Reusable site name and parent folder ID.
 * 3. Partial Failure & Completion Guard:
 *    - Handles partial failure: succeeded photos remain safely stored and linked.
 *    - Crucial: DOES NOT mark submission complete if any required worker photo or relation failed/missing.
 *    - Submission status remains 'DRAFT' upon partial failure.
 * 4. Successful Retries (retryFailedUploads):
 *    - Inspects database and preserves already-uploaded photos without duplicate uploads.
 *    - Uploads only missing/failed photos.
 *    - Successfully marks submission 'SUBMITTED' once all required images are persisted.
 * 5. Retrieval & Progress Inspection:
 *    - getSubmissionImages computes correct summary and isFullyPersisted flag.
 *    - getUploadProgress reports live in-flight or persisted progress truthfully.
 */

import {
  getSubmissionImages,
  getUploadProgress,
  retryFailedUploads,
  setSubmissionImagesDriveDeleterMock,
  setSubmissionImagesDriveUploaderMock,
  setSubmissionImagesSupabaseOverride,
  uploadSubmissionImages,
  validateSubmissionImages,
} from '../submission-images';
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

interface MockSubmission {
  id: number;
  vendor_profile_id: number;
  submitted_by: number;
  site_name: string;
  metadata: any;
  status: string;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

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

interface MockOtherImage {
  id: number;
  submission_id: number;
  file_id: number;
  sequence_no: number;
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

export async function runSubmissionImagesTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  // In-memory tables
  let submissions: MockSubmission[] = [];
  let workerInstances: MockWorkerInstance[] = [];
  let ppeImages: MockPPEImage[] = [];
  let otherImages: MockOtherImage[] = [];
  let files: MockFileRow[] = [];
  let driveUploadedFiles: Map<string, { fileName: string; folderId?: string }> = new Map();
  let driveDeletedFiles: string[] = [];

  let nextSubmissionId = 10;
  let nextWorkerInstanceId = 100;
  let nextPPEImageId = 200;
  let nextOtherImageId = 300;
  let nextFileId = 400;
  let driveFailUploadForFileName: string | null = null;

  function resetState() {
    submissions = [
      {
        id: 1,
        vendor_profile_id: 1,
        submitted_by: 5,
        site_name: 'Metro Site North',
        metadata: {},
        status: 'DRAFT',
        submitted_at: null,
        completed_at: null,
        created_at: '2026-10-15T10:00:00.000Z',
        updated_at: '2026-10-15T10:00:00.000Z',
      },
    ];
    workerInstances = [];
    ppeImages = [];
    otherImages = [];
    files = [];
    driveUploadedFiles.clear();
    driveDeletedFiles = [];
    nextSubmissionId = 10;
    nextWorkerInstanceId = 100;
    nextPPEImageId = 200;
    nextOtherImageId = 300;
    nextFileId = 400;
    driveFailUploadForFileName = null;
  }

  // Create mock Supabase client
  function createMockSupabase(): any {
    return {
      from: (table: string) => {
        let currentFilters: Array<(item: any) => boolean> = [];
        let orderByCol: string | null = null;
        let isAscending = true;

        const chain: any = {
          select: (columns?: string) => chain,
          eq: (column: string, value: any) => {
            currentFilters.push((item: any) => item[column] === value);
            return chain;
          },
          in: (column: string, values: any[]) => {
            currentFilters.push((item: any) => values.includes(item[column]));
            return chain;
          },
          order: (column: string, opts?: { ascending?: boolean }) => {
            orderByCol = column;
            isAscending = opts?.ascending ?? true;
            return chain;
          },
          limit: (n: number) => chain,
          maybeSingle: async () => {
            let list: any[] = [];
            if (table === 'ppe_submissions') list = submissions;
            else if (table === 'ppe_worker_instances') list = workerInstances;
            else if (table === 'ppe_images') list = ppeImages;
            else if (table === 'other_images') list = otherImages;
            else if (table === 'files') list = files;
            else if (table === 'vendor_members') list = [{ id: 1, vendor_profile_id: 1, user_id: 5 }];

            let matched = list.filter((item) => currentFilters.every((f) => f(item)));
            if (matched.length === 0) return { data: null, error: null };
            return { data: { ...matched[0] }, error: null };
          },
          single: async () => {
            const res = await chain.maybeSingle();
            if (!res.data) {
              return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
            }
            return res;
          },
          insert: (payload: any) => {
            const isArray = Array.isArray(payload);
            const items = isArray ? payload : [payload];
            const inserted: any[] = [];

            for (const item of items) {
              if (table === 'ppe_submissions') {
                const row: MockSubmission = {
                  id: item.id || ++nextSubmissionId,
                  vendor_profile_id: item.vendor_profile_id ?? 1,
                  submitted_by: item.submitted_by ?? 5,
                  site_name: item.site_name || 'PPEye Site',
                  metadata: item.metadata || {},
                  status: item.status || 'DRAFT',
                  submitted_at: item.submitted_at || null,
                  completed_at: item.completed_at || null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                submissions.push(row);
                inserted.push(row);
              } else if (table === 'ppe_worker_instances') {
                const row: MockWorkerInstance = {
                  id: item.id || ++nextWorkerInstanceId,
                  submission_id: item.submission_id,
                  sequence_no: item.sequence_no,
                  created_at: new Date().toISOString(),
                };
                workerInstances.push(row);
                inserted.push(row);
              } else if (table === 'ppe_images') {
                const row: MockPPEImage = {
                  id: item.id || ++nextPPEImageId,
                  worker_instance_id: item.worker_instance_id,
                  file_id: item.file_id,
                  side: item.side,
                  created_at: new Date().toISOString(),
                };
                ppeImages.push(row);
                inserted.push(row);
              } else if (table === 'other_images') {
                const row: MockOtherImage = {
                  id: item.id || ++nextOtherImageId,
                  submission_id: item.submission_id,
                  file_id: item.file_id,
                  sequence_no: item.sequence_no ?? otherImages.length + 1,
                  created_at: new Date().toISOString(),
                };
                otherImages.push(row);
                inserted.push(row);
              } else if (table === 'files') {
                const row: MockFileRow = {
                  id: item.id || ++nextFileId,
                  storage_provider: item.storage_provider,
                  provider_file_id: item.provider_file_id,
                  file_name: item.file_name,
                  mime_type: item.mime_type || null,
                  size_bytes: item.size_bytes || null,
                  created_by: item.created_by || null,
                  created_at: new Date().toISOString(),
                };
                files.push(row);
                inserted.push(row);
              }
            }

            return {
              select: () => ({
                single: async () => ({ data: { ...inserted[0] }, error: null }),
                maybeSingle: async () => ({ data: { ...inserted[0] }, error: null }),
                then: (resolve: any) => resolve({ data: isArray ? inserted : inserted[0], error: null }),
              }),
              then: (resolve: any) => resolve({ data: isArray ? inserted : inserted[0], error: null }),
            };
          },
          update: (payload: any) => {
            return {
              eq: (col: string, val: any) => {
                currentFilters.push((item: any) => item[col] === val);
                return {
                  select: () => ({
                    single: async () => {
                      let list: any[] = [];
                      if (table === 'ppe_submissions') list = submissions;
                      let matched = list.find((item) => currentFilters.every((f) => f(item)));
                      if (matched) {
                        Object.assign(matched, payload);
                        return { data: { ...matched }, error: null };
                      }
                      return { data: null, error: { message: 'Not found' } };
                    },
                  }),
                  then: (resolve: any) => {
                    let list: any[] = [];
                    if (table === 'ppe_submissions') list = submissions;
                    let matched = list.find((item) => currentFilters.every((f) => f(item)));
                    if (matched) {
                      Object.assign(matched, payload);
                      return resolve({ data: { ...matched }, error: null });
                    }
                    return resolve({ data: null, error: { message: 'Not found' } });
                  },
                };
              },
            };
          },
          delete: () => ({
            eq: (col: string, val: any) => {
              if (table === 'ppe_images') {
                ppeImages = ppeImages.filter((img) => img[col as keyof MockPPEImage] !== val);
              } else if (table === 'other_images') {
                otherImages = otherImages.filter((img) => img[col as keyof MockOtherImage] !== val);
              } else if (table === 'files') {
                files = files.filter((f) => f[col as keyof MockFileRow] !== val);
              }
              return {
                then: (resolve: any) => resolve({ data: null, error: null }),
              };
            },
          }),
          then: (resolve: any) => {
            let list: any[] = [];
            if (table === 'ppe_submissions') list = submissions;
            else if (table === 'ppe_worker_instances') list = workerInstances;
            else if (table === 'ppe_images') list = ppeImages;
            else if (table === 'other_images') list = otherImages;
            else if (table === 'files') list = files;

            let result = list.filter((item) => currentFilters.every((f) => f(item)));
            if (orderByCol) {
              result.sort((a, b) => {
                const va = a[orderByCol!];
                const vb = b[orderByCol!];
                return isAscending ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
              });
            }

            // Expand files relation if ppe_images
            if (table === 'ppe_images') {
              result = result.map((img) => {
                const fileRec = files.find((f) => f.id === img.file_id);
                return {
                  ...img,
                  files: fileRec ? { ...fileRec } : null,
                };
              });
            }
            if (table === 'other_images') {
              result = result.map((img) => {
                const fileRec = files.find((f) => f.id === img.file_id);
                return {
                  ...img,
                  files: fileRec ? { ...fileRec } : null,
                };
              });
            }

            return resolve({ data: result, error: null });
          },
        };

        return chain;
      },
    };
  }

  // Setup mock injectors
  const mockSupabase = createMockSupabase();
  setSubmissionImagesSupabaseOverride(mockSupabase);

  setSubmissionImagesDriveUploaderMock(async (params) => {
    if (driveFailUploadForFileName && params.fileName.includes(driveFailUploadForFileName)) {
      throw new Error(`Simulated Google Drive network upload failure for ${params.fileName}`);
    }
    const fileId = `drive_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    driveUploadedFiles.set(fileId, { fileName: params.fileName, folderId: params.folderId });
    return {
      fileId,
      fileName: params.fileName,
      mimeType: 'image/jpeg',
      sizeBytes: 10240,
    };
  });

  setSubmissionImagesDriveDeleterMock(async (fileId) => {
    driveDeletedFiles.push(fileId);
    driveUploadedFiles.delete(fileId);
    return true;
  });

  async function test(name: string, fn: () => Promise<void>) {
    try {
      resetState();
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`    ${err?.message || err}`);
      if (err?.stack) console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n')}`);
      failed++;
    }
  }

  console.log('\n--- PPEye High-Level Submission Image Service Test Suite ---');

  // =========================================================================
  // 1. Validation: Incomplete Pairs & Structured Preview Warnings
  // =========================================================================
  console.log('\n• Suite: Validation: Incomplete Pairs & Preview Warnings');

  await test('Rejects empty workers array with NO_WORKERS_PROVIDED error', async () => {
    const val = await validateSubmissionImages({
      workers: [],
    });

    assert(val.isValid === false, 'Empty workers list is invalid');
    assert(val.errors.length === 1, 'Contains 1 error');
    assert(val.errors[0].code === 'NO_WORKERS_PROVIDED', 'Error code is NO_WORKERS_PROVIDED');
  });

  await test('Detects incomplete worker pairs (missing front only, missing back only, missing both)', async () => {
    const val = await validateSubmissionImages({
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///worker1_front.jpg', backLocalUri: null }, // missing back
        { sequenceNo: 2, frontLocalUri: null, backLocalUri: 'file:///worker2_back.jpg' }, // missing front
        { sequenceNo: 3, frontLocalUri: null, backLocalUri: null },                       // missing both
        { sequenceNo: 4, frontLocalUri: 'file:///w4_f.jpg', backLocalUri: 'file:///w4_b.jpg' }, // complete
      ],
    });

    assert(val.isValid === false, 'Payload is invalid due to incomplete pairs');
    assert(val.errors.length === 3, `Expected 3 errors, got ${val.errors.length}`);

    const errBack = val.errors.find((e) => e.code === 'WORKER_MISSING_BACK');
    assert(Boolean(errBack && errBack.sequenceNo === 1 && errBack.side === 'BACK'), 'Identified missing BACK on worker 1');

    const errFront = val.errors.find((e) => e.code === 'WORKER_MISSING_FRONT');
    assert(Boolean(errFront && errFront.sequenceNo === 2 && errFront.side === 'FRONT'), 'Identified missing FRONT on worker 2');

    const errBoth = val.errors.find((e) => e.code === 'WORKER_EMPTY_PAIR');
    assert(Boolean(errBoth && errBoth.sequenceNo === 3), 'Identified missing both on worker 3');

    assert(val.summary.totalWorkers === 4, 'totalWorkers is 4');
    assert(val.summary.validWorkers === 1, 'validWorkers is 1');
    assert(val.summary.incompleteWorkers === 3, 'incompleteWorkers is 3');
  });

  await test('Validates complete worker pairs successfully', async () => {
    const val = await validateSubmissionImages({
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///w1_f.jpg', backLocalUri: 'file:///w1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///w2_f.jpg', backLocalUri: 'file:///w2_b.jpg' },
      ],
    });

    assert(val.isValid === true, 'All worker pairs complete, isValid is true');
    assert(val.errors.length === 0, 'No validation errors');
    assert(val.summary.validWorkers === 2, '2 valid workers');
    assert(val.summary.incompleteWorkers === 0, '0 incomplete workers');
  });

  // =========================================================================
  // 2. Validation: Optional Others Evidence
  // =========================================================================
  console.log('\n• Suite: Validation: Optional Others Evidence');

  await test('Others images remain optional at storage layer (0 allowed)', async () => {
    const val = await validateSubmissionImages({
      workers: [{ sequenceNo: 1, frontLocalUri: 'file:///w1_f.jpg', backLocalUri: 'file:///w1_b.jpg' }],
      otherImages: [], // 0 optional photos
    });

    assert(val.isValid === true, 'Validation passes with 0 others photos');
    assert(val.summary.otherPhotosCount === 0, 'otherPhotosCount is 0');
    assert(val.warnings.some((w) => w.code === 'OPTIONAL_OTHERS_EMPTY'), 'Includes informational note for empty others');
  });

  await test('Warns on empty string localUri in optional others without failing valid workers', async () => {
    const val = await validateSubmissionImages({
      workers: [{ sequenceNo: 1, frontLocalUri: 'file:///w1_f.jpg', backLocalUri: 'file:///w1_b.jpg' }],
      otherImages: ['file:///hazard1.jpg', '   '], // second is whitespace/empty
    });

    assert(val.hasWarnings === true, 'hasWarnings is true');
    assert(val.warnings.some((w) => w.code === 'INVALID_FILE_URI'), 'Warns on empty localUri in others');
  });

  // =========================================================================
  // 3. Upload: Coordinated Execution & Database Persistence
  // =========================================================================
  console.log('\n• Suite: Upload Coordination & Database Persistence');

  await test('Uploads worker pairs and optional others, persisting files, ppe_images, other_images and marking complete', async () => {
    let progressUpdates: string[] = [];

    const res = await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///worker1_f.jpg', backLocalUri: 'file:///worker1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///worker2_f.jpg', backLocalUri: 'file:///worker2_b.jpg' },
      ],
      otherImages: ['file:///hazard_ladder.jpg'],
      markCompleteOnSuccess: true,
      onProgress: (p) => {
        progressUpdates.push(p.stage);
      },
    });

    assert(res.isComplete === true, 'Upload completed successfully');
    assert(res.submissionStatusUpdated === true, 'Submission status updated');
    assert(res.newStatus === 'SUBMITTED', 'Status updated to SUBMITTED');
    assert(res.workers.length === 2, '2 workers processed');
    assert(res.workers[0].isComplete === true, 'Worker 1 isComplete');
    assert(res.workers[1].isComplete === true, 'Worker 2 isComplete');
    assert(res.otherImages.length === 1, '1 Other photo persisted');
    assert(res.totalPhotosUploaded === 5, 'Total 5 photos uploaded (2x2 + 1)');

    // Verify DB records
    assert(workerInstances.length === 2, '2 worker instances created');
    assert(ppeImages.length === 4, '4 ppe_images linked (2 FRONT, 2 BACK)');
    assert(otherImages.length === 1, '1 other_images linked');
    assert(files.length === 5, '5 files persisted in files table');

    // Verify submission row was marked submitted
    const sub = submissions.find((s) => s.id === 1);
    assert(sub?.status === 'SUBMITTED', 'Submission status is SUBMITTED in DB');
    assert(sub?.completed_at !== null, 'completed_at timestamp recorded');

    // Verify progress milestones
    assert(progressUpdates.includes('validating'), 'Progress recorded validating');
    assert(progressUpdates.includes('uploading_workers'), 'Progress recorded uploading_workers');
    assert(progressUpdates.includes('uploading_others'), 'Progress recorded uploading_others');
    assert(progressUpdates.includes('completed'), 'Progress recorded completed');
  });

  // =========================================================================
  // 4. Incomplete Pairs & Partial Failures: Completion Guard
  // =========================================================================
  console.log('\n• Suite: Incomplete Pairs & Partial Failures');

  await test('Incomplete pair preserves front photo but DOES NOT mark submission complete', async () => {
    const res = await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        // Worker 1: front provided, back omitted
        { sequenceNo: 1, frontLocalUri: 'file:///w1_front.jpg', backLocalUri: null },
      ],
      markCompleteOnSuccess: true,
    });

    assert(res.isComplete === false, 'Submission is NOT complete');
    assert(res.submissionStatusUpdated === false, 'Submission status NOT updated');
    assert(res.workers[0].front !== null, 'Worker 1 front was successfully uploaded and persisted');
    assert(res.workers[0].back === null, 'Worker 1 back is null');
    assert(res.workers[0].isComplete === false, 'Worker 1 is not complete');
    assert(res.errors.some((e) => e.code === 'WORKER_MISSING_BACK'), 'Error recorded for missing back');

    // Submission status in DB MUST remain DRAFT
    const sub = submissions.find((s) => s.id === 1);
    assert(sub?.status === 'DRAFT', 'CRITICAL: Submission remains DRAFT in DB');
    assert(sub?.completed_at === null, 'completed_at remains null');
  });

  await test('Partial storage failure preserves succeeded photos and blocks completion', async () => {
    // Simulate Drive failure only on worker 2 back photo
    driveFailUploadForFileName = 'w2_back';

    const res = await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///w1_front.jpg', backLocalUri: 'file:///w1_back.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///w2_front.jpg', backLocalUri: 'file:///w2_back.jpg' },
      ],
      markCompleteOnSuccess: true,
    });

    assert(res.isComplete === false, 'Submission is NOT complete due to partial failure');
    assert(res.submissionStatusUpdated === false, 'Submission status NOT updated');

    // Worker 1: both front and back succeeded
    assert(res.workers[0].isComplete === true, 'Worker 1 is complete');
    // Worker 2: front succeeded, back failed
    assert(res.workers[1].front !== null, 'Worker 2 front preserved');
    assert(res.workers[1].back === null, 'Worker 2 back failed');
    assert(res.workers[1].isComplete === false, 'Worker 2 is incomplete');

    assert(ppeImages.length === 3, '3 photos safely persisted in ppe_images table');
    const sub = submissions.find((s) => s.id === 1);
    assert(sub?.status === 'DRAFT', 'Submission remains DRAFT');
  });

  // =========================================================================
  // 5. Successful Retries (retryFailedUploads)
  // =========================================================================
  console.log('\n• Suite: Successful Retries');

  await test('retryFailedUploads reuses existing active photos and only uploads missing ones to complete submission', async () => {
    // Step 1: Initial upload with partial failure (worker 2 back fails)
    driveFailUploadForFileName = 'w2_back';

    const initialRes = await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///w1_front.jpg', backLocalUri: 'file:///w1_back.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///w2_front.jpg', backLocalUri: 'file:///w2_back.jpg' },
      ],
      markCompleteOnSuccess: true,
    });

    assert(initialRes.isComplete === false, 'Initial upload had partial failure');
    assert(ppeImages.length === 3, '3 photos in DB');
    const initialUploadCount = driveUploadedFiles.size;
    assert(initialUploadCount === 3, '3 Drive files created initially');

    // Step 2: Clear failure and trigger retryFailedUploads
    driveFailUploadForFileName = null;

    const retryRes = await retryFailedUploads({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///w1_front.jpg', backLocalUri: 'file:///w1_back.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///w2_front.jpg', backLocalUri: 'file:///w2_back.jpg' },
      ],
      markCompleteOnSuccess: true,
    });

    assert(retryRes.isComplete === true, 'Retry completed successfully');
    assert(retryRes.submissionStatusUpdated === true, 'Submission status updated on retry');
    assert(retryRes.newStatus === 'SUBMITTED', 'Status transitioned to SUBMITTED');

    // Only 1 additional photo should have been uploaded to Drive (worker 2 back)
    assert(
      driveUploadedFiles.size === initialUploadCount + 1,
      `Only missing photo uploaded (total in Drive: ${driveUploadedFiles.size})`
    );
    assert(ppeImages.length === 4, 'All 4 ppe_images now linked in DB');

    const sub = submissions.find((s) => s.id === 1);
    assert(sub?.status === 'SUBMITTED', 'Submission status in DB is now SUBMITTED');
    assert(sub?.completed_at !== null, 'completed_at recorded on retry success');
  });

  // =========================================================================
  // 6. Retrieval & Progress Inspection
  // =========================================================================
  console.log('\n• Suite: Retrieval & Progress Inspection');

  await test('getSubmissionImages returns full structure, workers, others, and correct summary', async () => {
    // Upload 1 worker pair and 1 other photo
    await uploadSubmissionImages({
      submissionId: 1,
      workers: [{ sequenceNo: 1, frontLocalUri: 'file:///w1_f.jpg', backLocalUri: 'file:///w1_b.jpg' }],
      otherImages: ['file:///other_excavator.jpg'],
      markCompleteOnSuccess: true,
    });

    const info = await getSubmissionImages(1);
    assert(info.submissionId === 1, 'submissionId matches');
    assert(info.siteName === 'Metro Site North', 'siteName matches');
    assert(info.workers.length === 1, '1 worker instance');
    assert(info.workers[0].isComplete === true, 'Worker isComplete');
    assert(info.workers[0].front?.side === 'FRONT', 'Worker front side is FRONT');
    assert(info.workers[0].back?.side === 'BACK', 'Worker back side is BACK');
    assert(info.otherImages.length === 1, '1 Other image returned');
    assert(info.summary.totalWorkers === 1, 'totalWorkers is 1');
    assert(info.summary.completeWorkers === 1, 'completeWorkers is 1');
    assert(info.summary.incompleteWorkers === 0, 'incompleteWorkers is 0');
    assert(info.summary.isFullyPersisted === true, 'isFullyPersisted is true');
  });

  await test('getUploadProgress returns persisted progress and worker statuses', async () => {
    await uploadSubmissionImages({
      submissionId: 1,
      workers: [{ sequenceNo: 1, frontLocalUri: 'file:///w1_f.jpg', backLocalUri: 'file:///w1_b.jpg' }],
      otherImages: [],
      markCompleteOnSuccess: true,
    });

    const progress = await getUploadProgress(1);
    assert(progress.submissionId === 1, 'submissionId is 1');
    assert(progress.percent === 100, 'percent is 100%');
    assert(progress.state === 'COMPLETED', 'state is COMPLETED');
    assert(progress.stage === 'completed', 'stage is completed');
    assert(progress.workers[0].frontStatus === 'success', 'frontStatus is success');
    assert(progress.workers[0].backStatus === 'success', 'backStatus is success');
  });

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  return { passed, failed, total: passed + failed };
}

// Auto-run if executed directly
if ((require as any).main === module) {
  runSubmissionImagesTests().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}
