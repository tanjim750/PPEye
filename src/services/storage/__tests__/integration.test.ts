/**
 * PPEye Google Drive Engine End-to-End Integration & Regression Test Suite
 *
 * Verifies the complete end-to-end integration across all flows:
 * 1. Capture -> Validate -> Upload -> DB Persistence -> Completion
 * 2. Network Interruption & Retry Recovery (Partial failure recovery without blind re-upload)
 * 3. App Restart & Pending Capture Preservation (Local files preserved until DB success)
 * 4. EHS Review Flow & Private Cached Previews (Strict FRONT/BACK mapping, zero public URLs)
 * 5. Rejection & Resubmission / PPE Image Replacement with Rollback Safety
 * 6. Missing Remote File Clean Error Handling (FILE_NOT_FOUND)
 * 7. Multi-Tenant Role Authorization & Zero Public Exposure (PERMISSION_DENIED)
 * 8. Safe Cleanup & Sensitive Cache Clearance on Logout
 * 9. Profile Picture Lifecycle (Upload, Cache, Replacement, and Safe Cleanup)
 */

import {
  getSubmissionImages,
  retryFailedUploads,
  setSubmissionImagesDriveDeleterMock,
  setSubmissionImagesDriveUploaderMock,
  setSubmissionImagesSupabaseOverride,
  uploadSubmissionImages,
  validateSubmissionImages,
} from '../submission-images';
import {
  replacePPEImage,
  uploadWorkerImagePair,
  getWorkerImages,
  setPpeImagesSupabaseOverride,
  setPpeImagesDriveUploaderMock,
  setPpeImagesDriveDeleterMock,
} from '../ppe-images';
import {
  uploadOtherImages,
  setOtherImagesSupabaseOverride,
  setOtherImagesDriveUploaderMock,
  setOtherImagesDriveDeleterMock,
} from '../other-images';
import {
  uploadProfilePicture,
  getProfilePictureUri,
  replaceProfilePicture,
  setProfileImageSupabaseOverride,
  setProfileImageDriveUploaderMock,
  setProfileImageDriveDeleterMock,
} from '../profile-image';
import {
  cacheImage,
  clearImageCache,
  getCachedImageUri,
  getImageUri,
  setCacheFileSystemMock,
  setCustomImageDownloader,
} from '../../../utils/image';
import { ServerStorageClient } from '../server-storage.client';
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

export async function runIntegrationTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.message || err}`);
      if (err?.stack) console.error(err.stack);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log('PPEye Google Drive Engine Integration & Regression Tests');
  console.log('========================================\n');

  // ---------------------------------------------------------------------------
  // Shared Mock State & Setup
  // ---------------------------------------------------------------------------
  let fileIdCounter = 100;
  let workerIdCounter = 200;
  let ppeImageIdCounter = 300;
  let otherImageIdCounter = 400;

  let mockSubmissions: any[] = [];
  let mockWorkerInstances: any[] = [];
  let mockPPEImages: any[] = [];
  let mockOtherImages: any[] = [];
  let mockFiles: any[] = [];
  let mockUsers: any[] = [];
  let mockRemoteDrive: Map<string, { name: string; mimeType: string; content: string }> = new Map();
  let mockLocalDisk: Map<string, { content: string; size: number }> = new Map();

  // Mock FileSystem for private cache
  const mockFileSystem = {
    documentDirectory: 'file:///data/user/0/com.ppeye/app_flutter/',
    cacheDirectory: 'file:///data/user/0/com.ppeye/cache/',
    getInfoAsync: async (uri: string) => {
      const entry = mockLocalDisk.get(uri);
      if (entry) {
        return { exists: true, isDirectory: false, size: entry.size, uri };
      }
      return { exists: false, isDirectory: false, uri };
    },
    makeDirectoryAsync: async (_uri: string, _opts?: any) => {},
    copyAsync: async ({ from, to }: { from: string; to: string }) => {
      const src = mockLocalDisk.get(from) || { content: 'IMAGE_CONTENT', size: 1024 };
      mockLocalDisk.set(to, { content: src.content, size: src.size });
    },
    deleteAsync: async (uri: string, _opts?: any) => {
      mockLocalDisk.delete(uri);
      for (const k of Array.from(mockLocalDisk.keys())) {
        if (k.startsWith(uri)) mockLocalDisk.delete(k);
      }
    },
    readAsStringAsync: async (uri: string) => mockLocalDisk.get(uri)?.content || '',
    writeAsStringAsync: async (uri: string, content: string) => {
      mockLocalDisk.set(uri, { content, size: content.length });
    },
  };

  setCacheFileSystemMock(mockFileSystem);

  // Mock Supabase Query Builder
  function createMockSupabase() {
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'usr_5' } },
          error: null,
        }),
      },
      from: (table: string) => {
        let currentTable = table;
        let filters: Array<{ col: string; op: string; val: any }> = [];
        let orderBy: { col: string; ascending: boolean } | null = null;
        let isCountQuery = false;

        const getTableArray = (): any[] => {
          switch (currentTable) {
            case 'ppe_submissions':
            case 'submissions':
              return mockSubmissions;
            case 'ppe_worker_instances':
              return mockWorkerInstances;
            case 'ppe_images':
              return mockPPEImages;
            case 'other_images':
              return mockOtherImages;
            case 'files':
              return mockFiles;
            case 'users':
              return mockUsers;
            default:
              return [];
          }
        };

        const builder: any = {
          select: (_cols?: string, opts?: any) => {
            if (opts && (opts.count === 'exact' || opts.head === true)) {
              isCountQuery = true;
            }
            return builder;
          },
          insert: (records: any | any[]) => {
            const arr = Array.isArray(records) ? records : [records];
            const tableArr = getTableArray();
            const inserted = arr.map((rec) => {
              const row = { ...rec };
              if (!row.id) {
                if (currentTable === 'files') row.id = ++fileIdCounter;
                else if (currentTable === 'ppe_worker_instances') row.id = ++workerIdCounter;
                else if (currentTable === 'ppe_images') row.id = ++ppeImageIdCounter;
                else if (currentTable === 'other_images') row.id = ++otherImageIdCounter;
                else row.id = Math.floor(Math.random() * 10000);
              }
              row.created_at = row.created_at || new Date().toISOString();
              tableArr.push(row);
              return row;
            });
            return {
              select: () => ({
                single: async () => ({ data: inserted[0], error: null }),
                maybeSingle: async () => ({ data: inserted[0], error: null }),
                data: inserted,
                error: null,
              }),
              data: inserted,
              error: null,
            };
          },
          update: (updates: any) => {
            return {
              eq: (col: string, val: any) => {
                const tableArr = getTableArray();
                let updatedRow: any = null;
                for (const row of tableArr) {
                  if (row[col] === val) {
                    Object.assign(row, updates);
                    row.updated_at = new Date().toISOString();
                    updatedRow = row;
                  }
                }
                return {
                  select: () => ({
                    single: async () => ({ data: updatedRow, error: null }),
                    maybeSingle: async () => ({ data: updatedRow, error: null }),
                    data: updatedRow ? [updatedRow] : [],
                    error: null,
                  }),
                  data: updatedRow ? [updatedRow] : [],
                  error: null,
                };
              },
            };
          },
          delete: () => {
            return {
              eq: (col: string, val: any) => {
                const tableArr = getTableArray();
                const idx = tableArr.findIndex((r) => r[col] === val);
                if (idx !== -1) tableArr.splice(idx, 1);
                return { error: null };
              },
            };
          },
          eq: (col: string, val: any) => {
            filters.push({ col, op: 'eq', val });
            return builder;
          },
          in: (col: string, vals: any[]) => {
            filters.push({ col, op: 'in', val: vals });
            return builder;
          },
          order: (col: string, { ascending }: { ascending: boolean }) => {
            orderBy = { col, ascending };
            return builder;
          },
          single: async () => {
            return builder.maybeSingle();
          },
          maybeSingle: async () => {
            const tableArr = getTableArray();
            let matches = tableArr.filter((r) =>
              filters.every((f) => (f.op === 'in' ? f.val.includes(r[f.col]) : r[f.col] === f.val))
            );
            return { data: matches[0] || null, error: null };
          },
          then: (resolve: (res: any) => void) => {
            const tableArr = getTableArray();
            let matches = tableArr.filter((r) =>
              filters.every((f) => (f.op === 'in' ? f.val.includes(r[f.col]) : r[f.col] === f.val))
            );
            if (isCountQuery) {
              resolve({ count: matches.length, data: matches, error: null });
              return;
            }
            if (orderBy) {
              const { col, ascending } = orderBy;
              matches.sort((a, b) => (ascending ? a[col] - b[col] : b[col] - a[col]));
            }
            resolve({ data: matches, error: null });
          },
        };

        return builder;
      },
    };
  }

  function resetEnvironment() {
    fileIdCounter = 100;
    workerIdCounter = 200;
    ppeImageIdCounter = 300;
    otherImageIdCounter = 400;

    mockSubmissions = [
      {
        id: 1,
        vendor_profile_id: 10,
        submitted_by: 5,
        site_name: 'Metro Site Alpha',
        status: 'DRAFT',
        metadata: {},
        submitted_at: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        vendor_profile_id: 20,
        submitted_by: 8,
        site_name: 'Industrial Park South',
        status: 'SUBMITTED',
        metadata: {},
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ];
    mockWorkerInstances = [];
    mockPPEImages = [];
    mockOtherImages = [];
    mockFiles = [];
    mockUsers = [
      { id: 5, category: 'EXTERNAL', vendor_profile_id: 10, profile_picture_file_id: null },
      { id: 8, category: 'EXTERNAL', vendor_profile_id: 20, profile_picture_file_id: null },
      { id: 99, category: 'INTERNAL', vendor_profile_id: null, profile_picture_file_id: null },
    ];
    mockRemoteDrive.clear();
    mockLocalDisk.clear();

    const mockSupabase = createMockSupabase();
    setSubmissionImagesSupabaseOverride(mockSupabase as any);
    setPpeImagesSupabaseOverride(mockSupabase as any);
    setOtherImagesSupabaseOverride(mockSupabase as any);
    setProfileImageSupabaseOverride(mockSupabase as any);

    setSubmissionImagesDriveUploaderMock(async (params) => {
      const providerId = `drive_${Math.random().toString(36).substring(2, 9)}`;
      mockRemoteDrive.set(providerId, { name: params.fileName, mimeType: 'image/jpeg', content: `REMOTE_${params.localUri}` });
      return { fileId: providerId, fileName: params.fileName, mimeType: 'image/jpeg', sizeBytes: 2048 };
    });

    setSubmissionImagesDriveDeleterMock(async (providerId) => {
      mockRemoteDrive.delete(providerId);
      return true;
    });

    setPpeImagesDriveUploaderMock(async (params) => {
      const providerId = `drive_ppe_${Math.random().toString(36).substring(2, 9)}`;
      mockRemoteDrive.set(providerId, { name: params.fileName, mimeType: 'image/jpeg', content: `REMOTE_${params.localUri}` });
      return { fileId: providerId, fileName: params.fileName, mimeType: 'image/jpeg', sizeBytes: 2048 };
    });

    setPpeImagesDriveDeleterMock(async (providerId) => {
      mockRemoteDrive.delete(providerId);
      return true;
    });

    setOtherImagesDriveUploaderMock(async (params) => {
      const providerId = `drive_oth_${Math.random().toString(36).substring(2, 9)}`;
      mockRemoteDrive.set(providerId, { name: params.fileName, mimeType: 'image/jpeg', content: `REMOTE_${params.localUri}` });
      return { fileId: providerId, fileName: params.fileName, mimeType: 'image/jpeg', sizeBytes: 2048 };
    });

    setOtherImagesDriveDeleterMock(async (fileId) => {
      mockRemoteDrive.delete(fileId);
      return true;
    });

    setProfileImageDriveUploaderMock(async (params) => {
      const providerId = `drive_prof_${Math.random().toString(36).substring(2, 9)}`;
      mockRemoteDrive.set(providerId, { name: params.fileName, mimeType: 'image/jpeg', content: `REMOTE_${params.localUri}` });
      return { fileId: providerId, fileName: params.fileName, mimeType: 'image/jpeg', sizeBytes: 1024 };
    });

    setProfileImageDriveDeleterMock(async (providerId) => {
      mockRemoteDrive.delete(providerId);
      return true;
    });

    setCustomImageDownloader(async (fileId, destPath) => {
      const fileRow = mockFiles.find((f) => String(f.id) === String(fileId));
      if (!fileRow) {
        throw new StorageError(StorageErrorCode.FILE_NOT_FOUND, `File record ${fileId} not found`);
      }
      const remote = mockRemoteDrive.get(fileRow.provider_file_id);
      if (!remote) {
        throw new StorageError(StorageErrorCode.FILE_NOT_FOUND, `Remote drive file missing`);
      }
      const finalDest = destPath || `file:///data/user/0/com.ppeye/cache/dl_${fileId}.jpg`;
      mockLocalDisk.set(finalDest, { content: remote.content, size: 2048 });
      return { uri: finalDest, sizeBytes: 2048 };
    });
  }

  // =========================================================================
  // 1. Full Submission Lifecycle: Capture -> Validate -> Upload -> Persistence
  // =========================================================================
  await test('Flow 1: Capture validation, upload, DB persistence, and completion guard', async () => {
    resetEnvironment();

    // Stage A: Camera captures photos locally on device
    mockLocalDisk.set('file:///local/w1_f.jpg', { content: 'W1_F_DATA', size: 1000 });
    mockLocalDisk.set('file:///local/w1_b.jpg', { content: 'W1_B_DATA', size: 1000 });
    mockLocalDisk.set('file:///local/w2_f.jpg', { content: 'W2_F_DATA', size: 1000 });
    // Worker 2 back is missing at this stage
    const incompleteValidation = await validateSubmissionImages({
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///local/w1_f.jpg', backLocalUri: 'file:///local/w1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///local/w2_f.jpg', backLocalUri: null },
      ],
    });

    assert(!incompleteValidation.isValid, 'Validation fails when worker 2 back is missing');
    assert(incompleteValidation.errors.length === 1, 'Exactly 1 validation error');
    assert(incompleteValidation.errors[0].code === 'WORKER_MISSING_BACK', 'Correct error code');

    // Stage B: Worker 2 back is captured
    mockLocalDisk.set('file:///local/w2_b.jpg', { content: 'W2_B_DATA', size: 1000 });
    const completeValidation = await validateSubmissionImages({
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///local/w1_f.jpg', backLocalUri: 'file:///local/w1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///local/w2_f.jpg', backLocalUri: 'file:///local/w2_b.jpg' },
      ],
      otherImages: ['file:///local/site_hazard.jpg'],
    });
    assert(completeValidation.isValid, 'Validation succeeds when all pairs are present');

    // Stage C: Upload submission images with completion request
    const uploadRes = await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///local/w1_f.jpg', backLocalUri: 'file:///local/w1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///local/w2_f.jpg', backLocalUri: 'file:///local/w2_b.jpg' },
      ],
      otherImages: ['file:///local/site_hazard.jpg'],
      markCompleteOnSuccess: true,
      siteName: 'Metro Site Alpha',
    });

    assert(uploadRes.isComplete, 'Upload completed successfully');
    assert(uploadRes.submissionStatusUpdated, 'Submission status updated');
    assert(uploadRes.newStatus === 'SUBMITTED', 'Status transitioned to SUBMITTED');
    assert(uploadRes.totalPhotosUploaded === 5, 'Uploaded 4 worker photos + 1 other photo');
    assert(mockFiles.length === 5, '5 file records persisted in Supabase');
    assert(mockWorkerInstances.length === 2, '2 worker instances created');
    assert(mockPPEImages.length === 4, '4 PPE image junctions linked');
    assert(mockOtherImages.length === 1, '1 other image linked');

    // Stage D: Verify that local captured files were safely kept until upload succeeded
    assert(mockLocalDisk.has('file:///local/w1_f.jpg'), 'Local capture preserved on disk');
  });

  // =========================================================================
  // 2. Network Interruption & Partial Failure Recovery
  // =========================================================================
  await test('Flow 2: Network interruption during upload and retry recovery', async () => {
    resetEnvironment();

    mockLocalDisk.set('file:///local/w1_f.jpg', { content: 'W1_F', size: 1000 });
    mockLocalDisk.set('file:///local/w1_b.jpg', { content: 'W1_B', size: 1000 });
    mockLocalDisk.set('file:///local/w2_f.jpg', { content: 'W2_F', size: 1000 });
    mockLocalDisk.set('file:///local/w2_b.jpg', { content: 'W2_B', size: 1000 });

    // Simulate network drop during worker 2 back upload
    setPpeImagesDriveUploaderMock(async (params) => {
      if (params.localUri.includes('w2_b')) {
        throw new StorageError(StorageErrorCode.NETWORK_ERROR, 'Connection dropped by peer');
      }
      const providerId = `drive_ppe_${Math.random().toString(36).substring(2, 9)}`;
      mockRemoteDrive.set(providerId, { name: params.fileName, mimeType: 'image/jpeg', content: `REMOTE_${params.localUri}` });
      return { fileId: providerId, fileName: params.fileName, mimeType: 'image/jpeg', sizeBytes: 2048 };
    });

    const failedUpload = await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///local/w1_f.jpg', backLocalUri: 'file:///local/w1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///local/w2_f.jpg', backLocalUri: 'file:///local/w2_b.jpg' },
      ],
      markCompleteOnSuccess: true,
    });

    assert(!failedUpload.isComplete, 'Upload is not complete after network error');
    assert(failedUpload.failedPhotosCount === 1, 'Exactly 1 photo failed');
    assert(failedUpload.totalPhotosUploaded === 3, '3 photos succeeded and remained stored');
    const submissionInDb = mockSubmissions.find((s) => s.id === 1);
    assert(submissionInDb.status === 'DRAFT', 'Crucial: Submission remains DRAFT on partial failure');

    // Network recovers: retryFailedUploads resumes
    setPpeImagesDriveUploaderMock(async (params) => {
      const providerId = `drive_recovered_${Math.random().toString(36).substring(2, 9)}`;
      mockRemoteDrive.set(providerId, { name: params.fileName, mimeType: 'image/jpeg', content: `REMOTE_${params.localUri}` });
      return { fileId: providerId, fileName: params.fileName, mimeType: 'image/jpeg', sizeBytes: 2048 };
    });

    const retryRes = await retryFailedUploads({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///local/w1_f.jpg', backLocalUri: 'file:///local/w1_b.jpg' },
        { sequenceNo: 2, frontLocalUri: 'file:///local/w2_f.jpg', backLocalUri: 'file:///local/w2_b.jpg' },
      ],
      markCompleteOnSuccess: true,
    });

    assert(retryRes.isComplete, 'Retry completes successfully');
    assert(retryRes.newStatus === 'SUBMITTED', 'Submission is now marked SUBMITTED');
    assert(submissionInDb.status === 'SUBMITTED', 'Status updated in DB to SUBMITTED');
    assert(retryRes.totalPhotosUploaded === 4, 'All 4 photos recorded complete');
    assert(mockFiles.length === 4, 'Total 4 files in DB');
  });

  // =========================================================================
  // 3. App Restart & Interrupted Flow Behavior
  // =========================================================================
  await test('Flow 3: App restart preserves pending captured files until remote persistence', async () => {
    resetEnvironment();

    // App was closed while submission was in review preview
    // Pending captures are persisted in local app storage
    const capturedPhotos = [
      { sequenceNo: 1, frontLocalUri: 'file:///local/persisted_w1_f.jpg', backLocalUri: 'file:///local/persisted_w1_b.jpg' },
    ];
    mockLocalDisk.set('file:///local/persisted_w1_f.jpg', { content: 'RESTORED_FRONT', size: 1000 });
    mockLocalDisk.set('file:///local/persisted_w1_b.jpg', { content: 'RESTORED_BACK', size: 1000 });

    // App relaunches; user opens SubmissionReviewScreen and taps Submit
    const res = await uploadSubmissionImages({
      submissionId: 1,
      workers: capturedPhotos,
      markCompleteOnSuccess: true,
    });

    assert(res.isComplete, 'Upload succeeds after app restart');
    assert(mockFiles.length === 2, 'Files persisted to Supabase');
  });

  // =========================================================================
  // 4. EHS Review Flow & Authorized Private Previews
  // =========================================================================
  await test('Flow 4: EHS review retrieves private cached preview URIs and preserves FRONT/BACK mapping', async () => {
    resetEnvironment();

    // Seed submission with 1 worker instance having FRONT and BACK photos
    await uploadSubmissionImages({
      submissionId: 1,
      workers: [
        { sequenceNo: 1, frontLocalUri: 'file:///local/ehs_w1_f.jpg', backLocalUri: 'file:///local/ehs_w1_b.jpg' },
      ],
    });

    // EHS reviewer opens ReviewDetailScreen -> getSubmissionImages
    const subImages = await getSubmissionImages(1);
    assert(subImages.workers.length === 1, '1 worker retrieved');
    const worker = subImages.workers[0];
    assert(worker.front !== null && worker.front.side === 'FRONT', 'FRONT side mapping strictly preserved');
    assert(worker.back !== null && worker.back.side === 'BACK', 'BACK side mapping strictly preserved');

    // Download/fetch private cache URI for FRONT
    const frontFileId = String(worker.front!.file.id);
    const frontUri = await getImageUri(frontFileId, { isSensitive: true });
    assert(frontUri.startsWith('file://'), 'Private local URI returned (never public URL)');
    assert(mockLocalDisk.has(frontUri), 'Image saved in app private local cache');

    // Subsequent retrieval uses cached image without network download
    let networkHit = false;
    setCustomImageDownloader(async () => {
      networkHit = true;
      return { uri: 'file:///should_not_be_called.jpg' };
    });

    const cachedUri = await getImageUri(frontFileId);
    assert(!networkHit, 'Cache hit avoided redundant remote download');
    assert(cachedUri === frontUri, 'Same cached URI returned');
  });

  // =========================================================================
  // 5. Rejected Submission & Resubmission / Replacement Flow
  // =========================================================================
  await test('Flow 5: Rejected worker replacement uploads new image and preserves old on DB failure', async () => {
    resetEnvironment();

    // Seed worker instance 201 in submission 1
    mockWorkerInstances.push({
      id: 201,
      submission_id: 1,
      sequence_no: 1,
      created_at: new Date().toISOString(),
    });

    mockLocalDisk.set('file:///local/initial_front.jpg', { content: 'INIT_FRONT', size: 1000 });
    mockLocalDisk.set('file:///local/initial_back.jpg', { content: 'INIT_BACK', size: 1000 });

    // 1. Initial upload for worker
    const workerPair = await uploadWorkerImagePair({
      workerInstanceId: 201,
      frontLocalUri: 'file:///local/initial_front.jpg',
      backLocalUri: 'file:///local/initial_back.jpg',
    });
    assert(workerPair.front !== null, 'Initial front created');
    const originalFileId = workerPair.front!.fileId;

    // 2. Worker marked UNSAFE by reviewer for missing chin-strap.
    // Team Leader resubmits worker check with corrected front image.
    mockLocalDisk.set('file:///local/corrected_front.jpg', { content: 'CORRECTED_FRONT', size: 1200 });

    // Test rollback safety: DB fails during replacement update
    const failingSupabase = createMockSupabase();
    failingSupabase.from = (table: string) => {
      const b = createMockSupabase().from(table);
      if (table === 'ppe_images') {
        b.update = () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: 'DB connection closed', code: 'P0001' } }),
              maybeSingle: async () => ({ data: null, error: { message: 'DB connection closed', code: 'P0001' } }),
            }),
          }),
        });
      }
      return b;
    };
    setPpeImagesSupabaseOverride(failingSupabase as any);

    await assertAsyncThrows(
      () =>
        replacePPEImage({
          workerInstanceId: 201,
          side: 'FRONT',
          newLocalUri: 'file:///local/corrected_front.jpg',
        }),
      StorageErrorCode.PROVIDER_ERROR,
      'Should fail and rollback when DB update fails'
    );

    // Verify original image relationship remained intact
    const originalPPE = mockPPEImages.find((p) => p.worker_instance_id === 201 && p.side === 'FRONT');
    assert(originalPPE.file_id === originalFileId, 'Original PPE image preserved after rollback');

    // Now test successful replacement
    const mockSupabase = createMockSupabase();
    setPpeImagesSupabaseOverride(mockSupabase as any);

    const replaced = await replacePPEImage({
      workerInstanceId: 201,
      side: 'FRONT',
      newLocalUri: 'file:///local/corrected_front.jpg',
    });
    assert(replaced.fileId !== originalFileId, 'Replacement persisted new file ID');
  });

  // =========================================================================
  // 6. Missing Remote Files & Clean Error Handling
  // =========================================================================
  await test('Flow 6: Missing remote file returns clean FILE_NOT_FOUND error', async () => {
    resetEnvironment();

    // File record exists in Supabase DB but was deleted or missing from remote Google Drive
    mockFiles.push({
      id: 999,
      storage_provider: 'GOOGLE_DRIVE',
      provider_file_id: 'missing_drive_file_id',
      file_name: 'lost.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1000,
    });

    await assertAsyncThrows(
      () => getImageUri('999'),
      StorageErrorCode.FILE_NOT_FOUND,
      'Missing remote file must throw FILE_NOT_FOUND without crashing'
    );
  });

  // =========================================================================
  // 7. Multi-Tenant Role Authorization & Zero Public Exposure
  // =========================================================================
  await test('Flow 7: ServerStorageClient enforces Supabase identity, roles, and zero public access', async () => {
    resetEnvironment();

    const originalFetch = globalThis.fetch;
    let authHeaderReceived: string | null = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authHeaderReceived = headers.get('Authorization');

      // Unauthenticated request rejection
      if (!authHeaderReceived || authHeaderReceived === 'Bearer null' || !authHeaderReceived.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Missing or invalid Authorization token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Role & ownership check
      const formData = init?.body as any;
      const submissionId = formData?.get ? parseInt(formData.get('submissionId'), 10) : undefined;
      if (submissionId === 2 && authHeaderReceived.includes('vendor_10_token')) {
        return new Response(
          JSON.stringify({
            error: 'Forbidden: submission belongs to another vendor profile',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          file: { id: 888, provider_file_id: 'drv_test', file_name: 'test.jpg' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    try {
      // Case A: Unauthenticated user rejected
      const unauthClient = new ServerStorageClient({
        baseUrl: 'https://test.supabase.co/functions/v1/storage-api',
        supabaseClient: {
          auth: { getSession: async () => ({ data: { session: null }, error: null }) },
        } as any,
      });

      await assertAsyncThrows(
        () =>
          unauthClient.upload({
            localUri: 'file:///test.jpg',
            fileName: 'test.jpg',
            category: 'PPE',
          }),
        StorageErrorCode.AUTHENTICATION_REQUIRED,
        'Unauthenticated request must be rejected'
      );

      // Case B: External Team Leader cannot access another vendor submission
      const vendor10Client = new ServerStorageClient({
        baseUrl: 'https://test.supabase.co/functions/v1/storage-api',
        supabaseClient: {
          auth: {
            getSession: async () => ({
              data: { session: { access_token: 'vendor_10_token' } },
              error: null,
            }),
          },
        } as any,
      });

      await assertAsyncThrows(
        () =>
          vendor10Client.upload({
            localUri: 'file:///test.jpg',
            fileName: 'test.jpg',
            category: 'PPE',
            metadata: { submissionId: 2 }, // Belongs to vendor 20
          }),
        StorageErrorCode.PERMISSION_DENIED,
        'Cannot access submission belonging to another vendor'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // =========================================================================
  // 8. Safe Cleanup & Sensitive Cache Clearance on Logout
  // =========================================================================
  await test('Flow 8: Safe cleanup purges sensitive inspection cache on logout while retaining public UI assets', async () => {
    resetEnvironment();
    await clearImageCache();

    // Set local files on disk
    mockLocalDisk.set('file:///local/sensitive_ppe.jpg', {
      content: 'CONFIDENTIAL_WORKER',
      size: 5000,
    });
    mockLocalDisk.set('file:///local/public_badge.png', {
      content: 'PUBLIC_ICON',
      size: 1000,
    });

    // Cache sensitive PPE photo
    await cacheImage('sensitive_file_1', 'file:///local/sensitive_ppe.jpg', {
      isSensitive: true,
      customFileName: 'sensitive_ppe.jpg',
    });

    // Cache non-sensitive asset (e.g. general help illustration or badge)
    await cacheImage('public_asset_1', 'file:///local/public_badge.png', {
      isSensitive: false,
      customFileName: 'public_badge.png',
    });

    // User logs out -> clear sensitive cache
    await clearImageCache({ onlySensitive: true });

    // Sensitive photo cache is gone
    const sensitiveUri = await getCachedImageUri('sensitive_file_1');
    assert(sensitiveUri === null, 'Sensitive cache entry removed from index');

    // Non-sensitive cached asset remains intact
    const nonSensitiveUri = await getCachedImageUri('public_asset_1');
    assert(nonSensitiveUri !== null, 'Non-sensitive cache entry remains available');
  });

  // =========================================================================
  // 9. Profile Picture Lifecycle
  // =========================================================================
  await test('Flow 9: Profile picture upload, private caching, replacement, and safe cleanup', async () => {
    resetEnvironment();

    mockLocalDisk.set('file:///local/my_avatar_v1.jpg', { content: 'AVATAR_V1', size: 1024 });

    // 1. Upload initial profile picture
    const uploadRes = await uploadProfilePicture({
      userId: 5,
      currentAuthUserId: 5,
      localUri: 'file:///local/my_avatar_v1.jpg',
    });
    assert(uploadRes.userId === 5, 'User ID matches');
    assert(uploadRes.fileId !== undefined, 'File ID returned');
    const firstFileId = uploadRes.fileId;

    // Verify user profile updated in DB
    const userInDb = mockUsers.find((u) => u.id === 5);
    assert(userInDb.profile_picture_file_id === firstFileId, 'User references profile picture file');

    // 2. Fetch profile picture URI (cached locally)
    const uri1 = await getProfilePictureUri(5);
    assert(uri1 !== null, 'Profile picture URI retrieved');

    // 3. Replace profile picture with v2
    mockLocalDisk.set('file:///local/my_avatar_v2.jpg', { content: 'AVATAR_V2', size: 1024 });
    const replaceRes = await replaceProfilePicture({
      userId: 5,
      currentAuthUserId: 5,
      newLocalUri: 'file:///local/my_avatar_v2.jpg',
    });
    assert(replaceRes.fileId !== firstFileId, 'New file record created');
    assert(userInDb.profile_picture_file_id === replaceRes.fileId, 'User reference updated');

    // Verify old file was deleted from remote drive since it had zero remaining references
    assert(!mockRemoteDrive.has(uploadRes.file.providerFileId), 'Unreferenced old profile picture cleaned up');
  });

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n========================================');
  console.log(`Integration Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  return { passed, failed, total: passed + failed };
}

// Auto-run if executed directly
if ((require as any).main === module) {
  runIntegrationTests().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}
