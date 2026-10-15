/**
 * PPEye Others Evidence Helpers Unit Tests (Mocked)
 *
 * Verifies:
 * - Empty lists: returns immediate empty result without storage side-effects.
 * - Multiple uploads: stable sequence ordering (e.g. sequence 1, 2, 3...).
 * - Partial success: individual failure records error while preserving succeeded uploads.
 * - Individual retries: allows retrying failed items without duplicating existing evidence.
 * - Authorization checks: enforces submission ownership / vendor membership.
 * - Removal & Audit protection: rejects deleting evidence from audited/reviewed submissions.
 * - Shared evidence protection: preserves underlying file if shared across records.
 * - Database relationship failure: rolls back storage binary and file record if insertion fails.
 */

import {
  getOtherImages,
  removeOtherImage,
  setOtherImagesDriveDeleterMock,
  setOtherImagesDriveUploaderMock,
  setOtherImagesSupabaseOverride,
  uploadOtherImage,
  uploadOtherImages,
  PartialOtherUploadError,
} from '../other-images';
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
// In-Memory Simulation State
// ---------------------------------------------------------------------------

interface MockSubmission {
  id: number;
  vendor_profile_id: number;
  submitted_by: number;
  site_name: string;
  status: string;
}

interface MockVendorMember {
  id: number;
  vendor_profile_id: number;
  user_id: number;
}

interface MockOtherImage {
  id: number;
  submission_id: number;
  file_id: number;
  sequence_no: number | null;
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

interface MockOtherReview {
  id: number;
  submission_id: number;
  reviewer_id: number;
  verdict: 'SAFE' | 'UNSAFE';
  reason?: string;
}

export async function runOtherImagesTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  // State collections
  let submissions: MockSubmission[] = [];
  let vendorMembers: MockVendorMember[] = [];
  let otherImages: MockOtherImage[] = [];
  let files: MockFileRow[] = [];
  let otherReviews: MockOtherReview[] = [];
  let sharedFiles: Set<number> = new Set(); // file IDs referenced elsewhere (e.g. users / ppe_images)

  let nextSubmissionId = 1;
  let nextOtherImageId = 1;
  let nextFileId = 1;
  let nextReviewId = 1;

  // Storage mock state
  const remoteDriveFiles = new Map<string, { fileName: string; localUri: string; folderId?: string }>();
  let failDriveUploadFor: string | null = null;
  let simulateOtherImagesInsertFailure = false;

  function resetState() {
    submissions = [];
    vendorMembers = [];
    otherImages = [];
    files = [];
    otherReviews = [];
    sharedFiles = new Set();
    nextSubmissionId = 1;
    nextOtherImageId = 1;
    nextFileId = 1;
    nextReviewId = 1;
    remoteDriveFiles.clear();
    failDriveUploadFor = null;
    simulateOtherImagesInsertFailure = false;

    // Seed default submission & vendor
    submissions.push({
      id: 10,
      vendor_profile_id: 100,
      submitted_by: 50,
      site_name: 'Metro Site Alpha',
      status: 'DRAFT',
    });
    vendorMembers.push({
      id: 1,
      vendor_profile_id: 100,
      user_id: 51, // vendor teammate
    });
  }

  // Drive Uploader & Deleter Mocks
  setOtherImagesDriveUploaderMock(async (params) => {
    if (failDriveUploadFor && params.localUri.includes(failDriveUploadFor)) {
      throw new Error(`Simulated Drive upload error for ${params.fileName}`);
    }
    const fileId = `drive_other_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    remoteDriveFiles.set(fileId, {
      fileName: params.fileName,
      localUri: params.localUri,
      folderId: params.folderId,
    });
    return {
      fileId,
      fileName: params.fileName,
      mimeType: 'image/jpeg',
      sizeBytes: 1500,
    };
  });

  setOtherImagesDriveDeleterMock(async (fileId) => {
    remoteDriveFiles.delete(fileId);
    return true;
  });

  // Supabase Mock Client
  const mockSupabase: any = {
    from: (table: string) => {
      let selectedCols = '*';
      const filters: Array<{ col: string; op: string; val: any }> = [];
      let sortCol: string | null = null;
      let sortAsc: boolean = true;

      const queryBuilder: any = {
        select: (cols: string = '*') => {
          selectedCols = cols;
          return queryBuilder;
        },
        eq: (col: string, val: any) => {
          filters.push({ col, op: 'eq', val });
          return queryBuilder;
        },
        order: (col: string, options?: any) => {
          sortCol = col;
          sortAsc = options?.ascending ?? true;
          return queryBuilder;
        },
        insert: (rows: any) => {
          const rowArray = Array.isArray(rows) ? rows : [rows];
          const inserted: any[] = [];

          if (table === 'other_images' && simulateOtherImagesInsertFailure) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: 'Foreign key or relation insert failed', code: '23503' },
                }),
              }),
            };
          }

          for (const item of rowArray) {
            if (table === 'other_images') {
              const newRow: MockOtherImage = {
                id: nextOtherImageId++,
                submission_id: item.submission_id,
                file_id: item.file_id,
                sequence_no: item.sequence_no ?? null,
                created_at: new Date().toISOString(),
              };
              otherImages.push(newRow);
              inserted.push(newRow);
            } else if (table === 'files') {
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
            }
          }

          return {
            select: () => ({
              single: async () => ({ data: inserted[0] ?? null, error: null }),
            }),
          };
        },
        delete: () => ({
          eq: async (col: string, val: any) => {
            if (table === 'other_images') {
              otherImages = otherImages.filter((r) => (r as any)[col] !== val);
            } else if (table === 'files') {
              files = files.filter((r) => (r as any)[col] !== val);
            }
            return { error: null };
          },
        }),
        maybeSingle: async () => {
          let list: any[] = [];
          if (table === 'ppe_submissions') list = submissions;
          if (table === 'vendor_members') list = vendorMembers;
          if (table === 'other_images') list = otherImages;
          if (table === 'files') list = files;
          if (table === 'other_reviews') list = otherReviews;

          for (const f of filters) {
            list = list.filter((item) => item[f.col] === f.val);
          }
          return { data: list[0] ?? null, error: null };
        },
        single: async () => {
          return queryBuilder.maybeSingle();
        },
        then: (resolve: any) => {
          // Handle count queries for reference checking
          if (['users', 'ppe_images'].includes(table)) {
            const fileIdVal = filters.find((f) => f.col === 'file_id' || f.col === 'profile_picture_file_id')?.val;
            const isShared = fileIdVal && sharedFiles.has(fileIdVal);
            resolve({ count: isShared ? 1 : 0, error: null });
            return;
          }

          let list: any[] = [];
          if (table === 'ppe_submissions') list = submissions;
          if (table === 'vendor_members') list = vendorMembers;
          if (table === 'other_reviews') list = otherReviews;
          if (table === 'submission_reviews') list = []; // empty
          if (table === 'files') list = files;
          if (table === 'other_images') {
            // Join with files
            list = otherImages.map((img) => {
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

          if (sortCol) {
            list.sort((a, b) => {
              const valA = a[sortCol!];
              const valB = b[sortCol!];
              if (valA === valB) return 0;
              return sortAsc ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
            });
          }

          resolve({ data: list, error: null });
        },
      };

      return queryBuilder;
    },
  };

  setOtherImagesSupabaseOverride(mockSupabase);

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

  console.log('\n--- PPEye Others Evidence Helpers Test Suite ---');

  // =========================================================================
  // 1. Empty Lists & Basic Upload
  // =========================================================================
  console.log('\n• Suite: Empty Lists & Single Upload');

  await test('uploadOtherImages handles empty list gracefully without side-effects', async () => {
    resetState();
    const result = await uploadOtherImages({
      submissionId: 10,
      images: [],
    });

    assert(result.success === true, 'Empty list result is success');
    assert(result.total === 0, 'Total images 0');
    assert(result.succeeded === 0, 'Succeeded 0');
    assert(result.failed === 0, 'Failed 0');
    assert(result.newlyUploaded.length === 0, 'newlyUploaded is empty');
    assert(remoteDriveFiles.size === 0, 'No remote files uploaded');
    assert(files.length === 0, 'No files created in database');
  });

  await test('uploadOtherImage uploads single photo and assigns sequence number', async () => {
    resetState();
    const stored = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/hazard_1.jpg',
      userId: 50,
    });

    assert(stored.submissionId === 10, 'submissionId matches');
    assert(stored.sequenceNo === 1, 'Assigned sequenceNo 1');
    assert(stored.file.fileName.includes('other_1.jpg'), `Filename includes other_1: ${stored.file.fileName}`);
    assert(otherImages.length === 1, '1 other_images record in DB');
    assert(files.length === 1, '1 files record in DB');
    assert(remoteDriveFiles.size === 1, '1 remote file in Drive');
  });

  // =========================================================================
  // 2. Multiple Uploads & Stable Sequence Ordering
  // =========================================================================
  console.log('\n• Suite: Multiple Uploads & Sequence Ordering');

  await test('uploadOtherImages preserves stable sequential ordering across batch', async () => {
    resetState();
    const batchResult = await uploadOtherImages({
      submissionId: 10,
      images: [
        'file:///cam/site_ladder.jpg',
        'file:///cam/site_scaffolding.jpg',
        'file:///cam/site_cables.jpg',
      ],
      userId: 50,
    });

    assert(batchResult.success === true, 'Batch upload succeeds');
    assert(batchResult.total === 3, 'Total 3');
    assert(batchResult.succeeded === 3, 'Succeeded 3');
    assert(batchResult.newlyUploaded.length === 3, '3 newly uploaded items');

    const all = await getOtherImages(10);
    assert(all.length === 3, '3 stored images');
    assert(all[0].sequenceNo === 1, '1st item sequence 1');
    assert(all[1].sequenceNo === 2, '2nd item sequence 2');
    assert(all[2].sequenceNo === 3, '3rd item sequence 3');

    // Add another image; should continue with sequence 4
    const nextImg = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/site_signage.jpg',
    });
    assert(nextImg.sequenceNo === 4, 'Next image sequence continues at 4');
  });

  // =========================================================================
  // 3. Partial Success & Individual Retries
  // =========================================================================
  console.log('\n• Suite: Partial Success & Individual Retries');

  await test('uploadOtherImages handles individual failures while preserving succeeded uploads', async () => {
    resetState();
    // Second photo will fail Drive upload
    failDriveUploadFor = 'broken_photo';

    const batchResult = await uploadOtherImages({
      submissionId: 10,
      images: [
        'file:///cam/valid_photo_1.jpg',
        'file:///cam/broken_photo.jpg',
        'file:///cam/valid_photo_2.jpg',
      ],
      throwOnPartialFailure: false,
    });

    assert(batchResult.success === false, 'Batch indicates partial failure');
    assert(batchResult.total === 3, 'Total is 3');
    assert(batchResult.succeeded === 2, '2 succeeded');
    assert(batchResult.failed === 1, '1 failed');
    assert(batchResult.errors?.length === 1, '1 error reported');
    assert(batchResult.errors?.[0].index === 1, 'Failure on index 1');

    // Crucial: 2 succeeded photos are in database
    const currentInDb = await getOtherImages(10);
    assert(currentInDb.length === 2, '2 succeeded photos remain persisted in DB');
    assert(currentInDb[0].sequenceNo === 1, 'first sequence is 1');
    assert(currentInDb[1].sequenceNo === 3, 'third sequence is 3');
  });

  await test('uploadOtherImages with throwOnPartialFailure throws PartialOtherUploadError', async () => {
    resetState();
    failDriveUploadFor = 'fail_item';

    let caught: PartialOtherUploadError | null = null;
    try {
      await uploadOtherImages({
        submissionId: 10,
        images: ['file:///cam/good.jpg', 'file:///cam/fail_item.jpg'],
        throwOnPartialFailure: true,
      });
    } catch (err: any) {
      if (err instanceof PartialOtherUploadError) {
        caught = err;
      }
    }

    assert(caught !== null, 'Throws PartialOtherUploadError');
    assert(caught?.partialResult.succeeded === 1, 'Partial result records 1 succeeded');
  });

  await test('Individual retry succeeds without duplicating existing evidence', async () => {
    resetState();
    failDriveUploadFor = 'unstable';

    // Attempt 1: photo 1 succeeds, photo 2 fails
    const attempt1 = await uploadOtherImages({
      submissionId: 10,
      images: ['file:///cam/stable.jpg', 'file:///cam/unstable.jpg'],
      throwOnPartialFailure: false,
    });
    assert(attempt1.succeeded === 1, 'Only 1 succeeded on attempt 1');

    // Fix network and retry ONLY the failed item
    failDriveUploadFor = null;
    const retryResult = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/fixed.jpg',
      sequenceNo: 2, // explicit sequence to fill slot
    });

    assert(retryResult.sequenceNo === 2, 'Retry image filled sequence slot 2');

    const totalStored = await getOtherImages(10);
    assert(totalStored.length === 2, 'Exactly 2 other_images in total');
    assert(totalStored[0].sequenceNo === 1, '1st item sequence 1');
    assert(totalStored[1].sequenceNo === 2, '2nd item sequence 2');
  });

  // =========================================================================
  // 4. Authorization Checks
  // =========================================================================
  console.log('\n• Suite: Authorization Checks');

  await test('Rejects non-existent submissionId with INVALID_INPUT', async () => {
    resetState();
    await assertAsyncThrows(
      () =>
        uploadOtherImage({
          submissionId: 99999,
          localUri: 'file:///cam/pic.jpg',
        }),
      StorageErrorCode.INVALID_INPUT,
      'Non-existent submission must reject'
    );
  });

  await test('Rejects unauthorized user not linked to submission or vendor with PERMISSION_DENIED', async () => {
    resetState();
    // User 999 is neither submitted_by (50) nor vendor member (51)
    await assertAsyncThrows(
      () =>
        uploadOtherImage({
          submissionId: 10,
          localUri: 'file:///cam/pic.jpg',
          userId: 999,
        }),
      StorageErrorCode.PERMISSION_DENIED,
      'Unauthorized user must reject'
    );
  });

  await test('Allows authorized vendor teammate to add evidence', async () => {
    resetState();
    // User 51 is a teammate in vendor_members for vendor_profile_id 100
    const stored = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/teammate_pic.jpg',
      userId: 51,
    });
    assert(stored.id > 0, 'Vendor teammate allowed to upload evidence');
  });

  // =========================================================================
  // 5. Evidence Removal & Protection (Audit & Shared Protection)
  // =========================================================================
  console.log('\n• Suite: Evidence Removal & Protection');

  await test('removeOtherImage deletes unreviewed, unshared evidence and cleans up file', async () => {
    resetState();
    const stored = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/to_remove.jpg',
    });

    const fileId = stored.file.id;
    const providerFileId = stored.file.providerFileId;

    assert(otherImages.length === 1, '1 other_images record');
    assert(files.length === 1, '1 file record');
    assert(remoteDriveFiles.has(providerFileId), 'File exists on Drive');

    const removed = await removeOtherImage(stored.id);
    assert(removed === true, 'removeOtherImage returns true');
    assert(otherImages.length === 0, 'other_images row removed');
    assert(files.length === 0, 'Unshared files row removed');
    assert(!remoteDriveFiles.has(providerFileId), 'Unshared file deleted from Drive');
  });

  await test('removeOtherImage blocks deletion when submission has already been reviewed/audited', async () => {
    resetState();
    const stored = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/audited_hazard.jpg',
    });

    // Add a review in other_reviews for this submission
    otherReviews.push({
      id: nextReviewId++,
      submission_id: 10,
      reviewer_id: 88,
      verdict: 'SAFE',
    });

    // Attempt removal without force
    await assertAsyncThrows(
      () => removeOtherImage(stored.id),
      StorageErrorCode.PERMISSION_DENIED,
      'Deleting audited evidence must be blocked'
    );

    // Verify evidence remains preserved
    assert(otherImages.length === 1, 'other_images record preserved');
    assert(files.length === 1, 'files record preserved');
  });

  await test('removeOtherImage preserves underlying file if shared with other entities', async () => {
    resetState();
    const stored = await uploadOtherImage({
      submissionId: 10,
      localUri: 'file:///cam/shared_pic.jpg',
    });

    // Mark file as shared with another entity (e.g. users profile picture or ppe_images)
    sharedFiles.add(stored.file.id);

    const removed = await removeOtherImage(stored.id);
    assert(removed === true, 'other_images row removed');
    assert(otherImages.length === 0, 'other_images row deleted');

    // Crucial: file record and Drive binary MUST BE PRESERVED because it is shared
    const fileInDb = files.find((f) => f.id === stored.file.id);
    assert(fileInDb !== undefined, 'Shared file record was preserved in database');
    assert(remoteDriveFiles.has(stored.file.providerFileId), 'Shared file preserved in Drive');
  });

  // =========================================================================
  // 6. Database Relationship Failures & Rollback
  // =========================================================================
  console.log('\n• Suite: Database Relationship Failures');

  await test('Rolls back storage binary and file record if other_images insert fails', async () => {
    resetState();
    simulateOtherImagesInsertFailure = true;

    await assertAsyncThrows(
      () =>
        uploadOtherImage({
          submissionId: 10,
          localUri: 'file:///cam/failing_insert.jpg',
        }),
      StorageErrorCode.PROVIDER_ERROR,
      'Insert failure should throw'
    );

    simulateOtherImagesInsertFailure = false;

    // Verify rollback: no orphaned file record or remote Drive file left behind
    assert(otherImages.length === 0, 'No other_images row');
    assert(files.length === 0, 'No orphaned files row');
    assert(remoteDriveFiles.size === 0, 'No orphaned remote Drive file');
  });

  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${total} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total };
}
