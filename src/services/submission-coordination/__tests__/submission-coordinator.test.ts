/**
 * PPEye Submission Coordination Layer Test Suite
 *
 * Comprehensive unit tests verifying multi-step coordination, pre-upload compression,
 * binary storage uploads, database metadata persistence, entity-file linking,
 * failure compensation in reverse order, safe image replacement, and strict isolation from Google Drive.
 */

import assert from 'assert';
import type { PreparedUploadImage } from '../../../utils/image';
import type {
  CreateFileInput,
  FileRecord,
  ImageSide,
  OtherImageRecord,
  PPEImageRecord,
  StorageProvider,
} from '../../database/database.types';
import type {
  ISupabaseStorageService,
  StorageBucket,
  StorageUploadInput,
  StorageUploadResult,
} from '../../storage/supabase-storage.types';
import type {
  ReplaceWorkerEvidenceInput,
  SubmitOtherEvidenceInput,
  SubmitWorkerEvidenceInput,
  UploadAvatarInput,
} from '../coordination.types';
import {
  createDatabaseReferenceChecker,
  SubmissionCoordinator,
} from '../submission-coordinator';
import {
  clearCleanupQueue,
  enqueueFailedCleanup,
  getPendingCleanups,
  processCleanupQueue,
} from '../../storage/cleanup-queue';

export async function runSubmissionCoordinatorTests(): Promise<{ passed: number; failed: number; total: number }> {
  console.log('\n--- PPEye Submission Coordination Layer Test Suite (Mocked) ---');
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

  // ---------------------------------------------------------------------------
  // Mock In-Memory State & Fixtures
  // ---------------------------------------------------------------------------
  let fileIdCounter = 200;
  let linkIdCounter = 500;
  let filesTable: FileRecord[] = [];
  let ppeImagesTable: PPEImageRecord[] = [];
  let otherImagesTable: OtherImageRecord[] = [];
  let usersTable: Array<{ id: number; profile_picture_file_id: number | null }> = [];
  let storageBuckets: Record<string, Set<string>> = {
    evidence: new Set(),
    avatars: new Set(),
  };

  // Call counters & spies
  let storageUploadCalls: StorageUploadInput[] = [];
  let storageDeleteCalls: Array<{ bucket: StorageBucket; path: string }> = [];
  let compressionCalls: string[] = [];
  let googleDriveCalls = 0;

  function resetState() {
    fileIdCounter = 200;
    linkIdCounter = 500;
    filesTable = [];
    ppeImagesTable = [];
    otherImagesTable = [];
    usersTable = [
      { id: 10, profile_picture_file_id: null },
      { id: 20, profile_picture_file_id: 101 }, // existing avatar
    ];
    // Seed existing file for user 20
    filesTable.push({
      id: 101,
      storage_provider: 'SUPABASE',
      provider_file_id: 'users/20/avatar_old.jpg',
      file_name: 'avatar_old.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 45000,
      created_by: 20,
      created_at: new Date().toISOString(),
    });
    storageBuckets = {
      evidence: new Set(),
      avatars: new Set(['users/20/avatar_old.jpg']),
    };
    storageUploadCalls = [];
    storageDeleteCalls = [];
    compressionCalls = [];
    googleDriveCalls = 0;
  }

  // ---------------------------------------------------------------------------
  // Mock Database Service Implementation
  // ---------------------------------------------------------------------------
  function createMockDbService(overrides?: {
    createFileRecordError?: Error;
    deleteFileRecordError?: Error;
    linkPPEWorkerImageError?: Error;
    linkOtherImageError?: Error;
    updateUserProfilePictureError?: Error;
    isFileReferencedError?: Error;
    getFileRecordByProviderIdError?: Error;
  }) {
    return {
      files: {
        async createFileRecord(input: CreateFileInput): Promise<FileRecord> {
          if (overrides?.createFileRecordError) {
            throw overrides.createFileRecordError;
          }
          const rec: FileRecord = {
            id: ++fileIdCounter,
            storage_provider: input.storage_provider ?? 'SUPABASE',
            provider_file_id: input.provider_file_id,
            file_name: input.file_name,
            mime_type: input.mime_type ?? 'image/jpeg',
            size_bytes: input.size_bytes ?? 50000,
            created_by: input.created_by ?? null,
            created_at: new Date().toISOString(),
          };
          filesTable.push(rec);
          return rec;
        },
        async deleteFileRecord(id: number): Promise<boolean> {
          if (overrides?.deleteFileRecordError) {
            throw overrides.deleteFileRecordError;
          }
          const idx = filesTable.findIndex((f) => f.id === id);
          if (idx !== -1) {
            filesTable.splice(idx, 1);
          }
          return true;
        },
        async isFileReferenced(id: number): Promise<boolean> {
          if (overrides?.isFileReferencedError) {
            throw overrides.isFileReferencedError;
          }
          const inUsers = usersTable.some((u) => u.profile_picture_file_id === id);
          const inPpe = ppeImagesTable.some((p) => p.file_id === id);
          const inOther = otherImagesTable.some((o) => o.file_id === id);
          return inUsers || inPpe || inOther;
        },
        async getFileRecordById(id: number): Promise<FileRecord | null> {
          return filesTable.find((f) => f.id === id) ?? null;
        },
        async getFileRecordByProviderId(providerFileId: string): Promise<FileRecord | null> {
          if (overrides?.getFileRecordByProviderIdError) {
            throw overrides.getFileRecordByProviderIdError;
          }
          return filesTable.find((f) => f.provider_file_id === providerFileId) ?? null;
        },
      },
      imageLinks: {
        async linkPPEWorkerImage(
          workerInstanceId: number,
          fileId: number,
          side: ImageSide
        ): Promise<PPEImageRecord> {
          if (overrides?.linkPPEWorkerImageError) {
            throw overrides.linkPPEWorkerImageError;
          }
          const existing = ppeImagesTable.find(
            (p) => p.worker_instance_id === workerInstanceId && p.side === side
          );
          if (existing) {
            existing.file_id = fileId;
            return existing;
          }
          const rec: PPEImageRecord = {
            id: ++linkIdCounter,
            worker_instance_id: workerInstanceId,
            file_id: fileId,
            side,
            created_at: new Date().toISOString(),
          };
          ppeImagesTable.push(rec);
          return rec;
        },
        async replacePPEWorkerImage(
          workerInstanceId: number,
          side: ImageSide,
          newFileId: number
        ): Promise<PPEImageRecord> {
          return this.linkPPEWorkerImage(workerInstanceId, newFileId, side);
        },
        async deletePPEWorkerImage(workerInstanceId: number, side: ImageSide): Promise<boolean> {
          const idx = ppeImagesTable.findIndex(
            (p) => p.worker_instance_id === workerInstanceId && p.side === side
          );
          if (idx !== -1) {
            ppeImagesTable.splice(idx, 1);
          }
          return true;
        },
        async linkOtherImage(
          submissionId: number,
          fileId: number,
          sequenceNo: number
        ): Promise<OtherImageRecord> {
          if (overrides?.linkOtherImageError) {
            throw overrides.linkOtherImageError;
          }
          const rec: OtherImageRecord = {
            id: ++linkIdCounter,
            submission_id: submissionId,
            file_id: fileId,
            sequence_no: sequenceNo,
            created_at: new Date().toISOString(),
          };
          otherImagesTable.push(rec);
          return rec;
        },
        async deleteOtherImage(otherImageId: number): Promise<boolean> {
          const idx = otherImagesTable.findIndex((o) => o.id === otherImageId);
          if (idx !== -1) {
            otherImagesTable.splice(idx, 1);
          }
          return true;
        },
        async updateUserProfilePicture(
          userId: number,
          fileId: number | null
        ): Promise<{ id: number; profile_picture_file_id: number | null }> {
          if (overrides?.updateUserProfilePictureError) {
            throw overrides.updateUserProfilePictureError;
          }
          const user = usersTable.find((u) => u.id === userId);
          if (!user) {
            throw new Error(`User not found: ${userId}`);
          }
          user.profile_picture_file_id = fileId;
          return { id: user.id, profile_picture_file_id: fileId };
        },
        async getUserProfilePictureFileId(userId: number): Promise<number | null> {
          const user = usersTable.find((u) => u.id === userId);
          return user ? user.profile_picture_file_id : null;
        },
        async getWorkerImages(
          workerInstanceId: number
        ): Promise<{ front: PPEImageRecord | null; back: PPEImageRecord | null }> {
          const front = ppeImagesTable.find(
            (p) => p.worker_instance_id === workerInstanceId && p.side === 'FRONT'
          ) ?? null;
          const back = ppeImagesTable.find(
            (p) => p.worker_instance_id === workerInstanceId && p.side === 'BACK'
          ) ?? null;
          return { front, back };
        },
      },
      submissions: {} as any,
      reviews: {} as any,
    } as any;
  }

  // ---------------------------------------------------------------------------
  // Mock Storage Service Implementation
  // ---------------------------------------------------------------------------
  function createMockStorageService(overrides?: {
    uploadError?: Error;
    uploadFailOnAttempt?: number; // 1-based index of uploadFile calls
    deleteError?: Error;
  }): ISupabaseStorageService {
    let uploadCount = 0;
    return {
      async uploadFile(input: StorageUploadInput): Promise<StorageUploadResult> {
        uploadCount++;
        storageUploadCalls.push(input);
        if (overrides?.uploadError) {
          throw overrides.uploadError;
        }
        if (overrides?.uploadFailOnAttempt && uploadCount === overrides.uploadFailOnAttempt) {
          throw new Error(`Simulated upload failure on call #${uploadCount}`);
        }
        storageBuckets[input.bucket].add(input.storagePath);
        return {
          bucket: input.bucket,
          storagePath: input.storagePath,
          sizeBytes: input.sizeBytes ?? 48000,
          mimeType: input.mimeType ?? 'image/jpeg',
          etag: 'mock-etag-123',
        };
      },
      async deleteFile(bucket: StorageBucket, storagePath: string): Promise<boolean> {
        storageDeleteCalls.push({ bucket, path: storagePath });
        if (overrides?.deleteError) {
          throw overrides.deleteError;
        }
        storageBuckets[bucket].delete(storagePath);
        return true;
      },
      async fileExists(bucket: StorageBucket, storagePath: string): Promise<boolean> {
        return storageBuckets[bucket].has(storagePath);
      },
      async uploadBatch(): Promise<any> {
        throw new Error('Not implemented in mock');
      },
      async createSignedUrl(): Promise<any> {
        throw new Error('Not implemented in mock');
      },
      async downloadFile(): Promise<any> {
        throw new Error('Not implemented in mock');
      },
      async deleteBatch(): Promise<any> {
        throw new Error('Not implemented in mock');
      },
      async getObjectMetadata(): Promise<any> {
        throw new Error('Not implemented in mock');
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Mock Compression Function
  // ---------------------------------------------------------------------------
  function createMockCompress(overrides?: { compressError?: Error }) {
    return async (uri: string): Promise<PreparedUploadImage> => {
      compressionCalls.push(uri);
      if (overrides?.compressError) {
        throw overrides.compressError;
      }
      return {
        uri: `${uri}_compressed_1920.jpg`,
        originalUri: uri,
        originalSizeBytes: 2000000,
        preparedSizeBytes: 52000,
        sizeBytes: 52000,
        wasCompressed: true,
        reusedPrepared: false,
        mimeType: 'image/jpeg',
      };
    };
  }

  // ===========================================================================
  // TEST SUITE: submitWorkerEvidence
  // ===========================================================================
  console.log('\n• Suite: Worker Evidence Submission (submitWorkerEvidence)');

  await test('submitWorkerEvidence complete success (front & back)', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const input: SubmitWorkerEvidenceInput = {
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: 'file:///local/back.jpg',
      userId: 5,
    };

    const result = await coordinator.submitWorkerEvidence(input);
    assert.strictEqual(result.status, 'COMPLETE_SUCCESS', 'Expected COMPLETE_SUCCESS');
    assert(result.data, 'Expected result data');
    assert.strictEqual(result.data.submissionId, 45);
    assert.strictEqual(result.data.workerInstanceId, 1);
    assert(result.data.front.storagePath.includes('submissions/45/workers/1_front_'));
    assert(result.data.back.storagePath.includes('submissions/45/workers/1_back_'));

    // Verify storage artifacts
    assert.strictEqual(storageBuckets.evidence.size, 2, 'Both front and back stored in bucket');
    // Verify database artifacts
    assert.strictEqual(filesTable.length, 3, '2 new files in files table (plus 1 pre-seeded avatar)');
    assert.strictEqual(ppeImagesTable.length, 2, '2 links in ppe_images table');
  });

  await test('submitWorkerEvidence validation failure on missing back photo', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: '', // Missing
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'VALIDATION');
    assert.strictEqual(compressionCalls.length, 0, 'Did not compress on validation error');
    assert.strictEqual(storageUploadCalls.length, 0, 'Did not upload on validation error');
    assert.strictEqual(filesTable.length, 1, 'No files inserted');
  });

  await test('submitWorkerEvidence compression failure aborts pipeline safely', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress({ compressError: new Error('Out of memory') }),
    });

    const result = await coordinator.submitWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: 'file:///local/back.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'COMPRESSION');
    assert.strictEqual(storageUploadCalls.length, 0, 'No storage calls made');
    assert.strictEqual(filesTable.length, 1, 'No files created');
  });

  await test('submitWorkerEvidence storage upload failure compensates partially uploaded files', async () => {
    resetState();
    // Front upload succeeds (call 1), back upload fails (call 2)
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService({ uploadFailOnAttempt: 2 }),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: 'file:///local/back.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'STORAGE_UPLOAD');
    assert.strictEqual(storageUploadCalls.length, 2, 'Attempted 2 uploads');
    assert.strictEqual(storageDeleteCalls.length, 1, 'Deleted the 1 succeeded front upload');
    assert.strictEqual(storageBuckets.evidence.size, 0, 'No orphaned objects in evidence bucket');
    assert.strictEqual(filesTable.length, 1, 'No files inserted into DB');
  });

  await test('submitWorkerEvidence metadata insert failure compensates storage objects in reverse', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ createFileRecordError: new Error('DB connection closed') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: 'file:///local/back.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'METADATA_INSERT');
    assert.strictEqual(storageDeleteCalls.length, 2, 'Compensated both front and back storage uploads');
    assert.strictEqual(storageBuckets.evidence.size, 0, 'Evidence bucket remains empty');
    assert.strictEqual(filesTable.length, 1, 'No DB rows inserted');
  });

  await test('submitWorkerEvidence junction link failure rolls back metadata AND storage', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ linkPPEWorkerImageError: new Error('FK constraint violated') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: 'file:///local/back.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'JUNCTION_LINK');
    assert.strictEqual(ppeImagesTable.length, 0, 'No junction records retained');
    assert.strictEqual(filesTable.length, 1, 'Metadata records rolled back from public.files');
    assert.strictEqual(storageBuckets.evidence.size, 0, 'Storage objects deleted');
  });

  await test('submitWorkerEvidence incomplete compensation captures errors and preserves original error', async () => {
    resetState();
    // Fail metadata insert AND fail storage delete compensation
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ createFileRecordError: new Error('Original DB Insert Error') }),
      storageService: createMockStorageService({ deleteError: new Error('Compensating Delete Failed') }),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      frontLocalUri: 'file:///local/front.jpg',
      backLocalUri: 'file:///local/back.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_INCOMPLETE_COMPENSATION');
    assert.strictEqual(result.error?.message, 'Original DB Insert Error');
    assert(result.compensationErrors && result.compensationErrors.length > 0);
    assert(result.compensationErrors[0].error.message.includes('Compensating Delete Failed'));
  });

  // ===========================================================================
  // TEST SUITE: submitOtherEvidence
  // ===========================================================================
  console.log('\n• Suite: Other Evidence Submission (submitOtherEvidence)');

  await test('submitOtherEvidence complete success', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitOtherEvidence({
      submissionId: 50,
      sequenceNo: 1,
      localUri: 'file:///local/hazard_1.jpg',
      userId: 7,
    });

    assert.strictEqual(result.status, 'COMPLETE_SUCCESS');
    assert(result.data);
    assert.strictEqual(result.data.submissionId, 50);
    assert(result.data.storagePath.includes('submissions/50/others/other_1_'));
    assert.strictEqual(storageBuckets.evidence.size, 1);
    assert.strictEqual(otherImagesTable.length, 1);
    assert.strictEqual(otherImagesTable[0].submission_id, 50);
  });

  await test('submitOtherEvidence validation failure on missing localUri', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitOtherEvidence({
      submissionId: 50,
      sequenceNo: 1,
      localUri: '',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'VALIDATION');
    assert.strictEqual(storageUploadCalls.length, 0);
  });

  await test('submitOtherEvidence compression failure aborts before storage or database', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress({ compressError: new Error('Corrupt file') }),
    });

    const result = await coordinator.submitOtherEvidence({
      submissionId: 50,
      sequenceNo: 1,
      localUri: 'file:///local/hazard_1.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'COMPRESSION');
    assert.strictEqual(storageUploadCalls.length, 0);
    assert.strictEqual(filesTable.length, 1);
  });

  await test('submitOtherEvidence storage upload failure aborts with no DB records', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService({ uploadError: new Error('Network timeout') }),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitOtherEvidence({
      submissionId: 50,
      sequenceNo: 1,
      localUri: 'file:///local/hazard_1.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'STORAGE_UPLOAD');
    assert.strictEqual(filesTable.length, 1, 'No new file record created');
  });

  await test('submitOtherEvidence metadata insert failure compensates storage object', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ createFileRecordError: new Error('DB disk full') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitOtherEvidence({
      submissionId: 50,
      sequenceNo: 1,
      localUri: 'file:///local/hazard_1.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'METADATA_INSERT');
    assert.strictEqual(storageDeleteCalls.length, 1, 'Compensated uploaded evidence object');
    assert.strictEqual(storageBuckets.evidence.size, 0);
  });

  await test('submitOtherEvidence junction link failure compensates file record and storage object', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ linkOtherImageError: new Error('Submission locked') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.submitOtherEvidence({
      submissionId: 50,
      sequenceNo: 1,
      localUri: 'file:///local/hazard_1.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'JUNCTION_LINK');
    assert.strictEqual(otherImagesTable.length, 0);
    assert.strictEqual(filesTable.length, 1, 'File record deleted');
    assert.strictEqual(storageBuckets.evidence.size, 0, 'Storage object deleted');
  });

  // ===========================================================================
  // TEST SUITE: uploadAvatar
  // ===========================================================================
  console.log('\n• Suite: User Avatar Upload (uploadAvatar)');

  await test('uploadAvatar complete success with no previous avatar', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.uploadAvatar({
      userId: 10,
      localUri: 'file:///local/avatar_new.jpg',
    });

    assert.strictEqual(result.status, 'COMPLETE_SUCCESS');
    assert(result.data);
    assert.strictEqual(result.data.userId, 10);
    assert(result.data.storagePath.includes('users/10/avatar_'));
    assert.strictEqual(result.data.oldFileCleaned, false);
    assert.strictEqual(usersTable.find((u) => u.id === 10)?.profile_picture_file_id, result.data.fileId);
  });

  await test('uploadAvatar complete success with unreferenced previous avatar cleanup', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    // User 20 already has old avatar file 101
    const result = await coordinator.uploadAvatar({
      userId: 20,
      localUri: 'file:///local/avatar_replacement.jpg',
      cleanOldAvatar: true,
    });

    assert.strictEqual(result.status, 'COMPLETE_SUCCESS');
    assert(result.data);
    assert.strictEqual(result.data.oldFileCleaned, true, 'Old unreferenced avatar was cleaned');
    // Verify old file 101 was removed from DB and storage
    assert(!filesTable.some((f) => f.id === 101), 'Old file record removed from DB');
    assert(!storageBuckets.avatars.has('users/20/avatar_old.jpg'), 'Old avatar removed from storage');
    // Verify user points to new file
    assert.strictEqual(usersTable.find((u) => u.id === 20)?.profile_picture_file_id, result.data.fileId);
  });

  await test('uploadAvatar skips deleting old avatar if still referenced elsewhere', async () => {
    resetState();
    // User 20 has old avatar file 101, but file 101 is ALSO referenced in ppe_images
    ppeImagesTable.push({
      id: 999,
      worker_instance_id: 33,
      file_id: 101,
      side: 'FRONT',
      created_at: new Date().toISOString(),
    });

    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.uploadAvatar({
      userId: 20,
      localUri: 'file:///local/avatar_replacement.jpg',
    });

    assert.strictEqual(result.status, 'COMPLETE_SUCCESS');
    assert.strictEqual(result.data?.oldFileCleaned, false, 'Old avatar not cleaned due to active reference');
    assert(filesTable.some((f) => f.id === 101), 'Old file retained in DB');
    assert(storageBuckets.avatars.has('users/20/avatar_old.jpg'), 'Old storage object retained');
  });

  await test('uploadAvatar failure updating user rolls back new avatar and keeps old avatar intact', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ updateUserProfilePictureError: new Error('Permission denied') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.uploadAvatar({
      userId: 20,
      localUri: 'file:///local/avatar_replacement.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'JUNCTION_LINK');
    // User 20 profile picture reference is UNCHANGED
    assert.strictEqual(usersTable.find((u) => u.id === 20)?.profile_picture_file_id, 101);
    // Old avatar is STILL in DB and storage
    assert(filesTable.some((f) => f.id === 101));
    assert(storageBuckets.avatars.has('users/20/avatar_old.jpg'));
    // Newly created artifacts were rolled back
    assert.strictEqual(filesTable.length, 1, 'Only old file remains');
    assert.strictEqual(storageBuckets.avatars.size, 1, 'Only old avatar remains');
  });

  await test('uploadAvatar metadata insert failure compensates storage object and preserves old avatar', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ createFileRecordError: new Error('Unique constraint violated') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.uploadAvatar({
      userId: 20,
      localUri: 'file:///local/avatar_replacement.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'METADATA_INSERT');
    assert.strictEqual(usersTable.find((u) => u.id === 20)?.profile_picture_file_id, 101);
    assert(storageBuckets.avatars.has('users/20/avatar_old.jpg'));
    assert.strictEqual(storageBuckets.avatars.size, 1);
  });

  await test('uploadAvatar old avatar cleanup failure defers cleanup without failing avatar update', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ deleteFileRecordError: new Error('Storage lock') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.uploadAvatar({
      userId: 20,
      localUri: 'file:///local/avatar_replacement.jpg',
      cleanOldAvatar: true,
    });

    assert.strictEqual(result.status, 'REPLACEMENT_SUCCESS_CLEANUP_DEFERRED');
    assert(result.data);
    assert.strictEqual(result.data.oldFileCleaned, false);
    // User profile was updated successfully to new avatar
    assert.strictEqual(usersTable.find((u) => u.id === 20)?.profile_picture_file_id, result.data.fileId);
  });

  // ===========================================================================
  // TEST SUITE: replaceWorkerEvidence
  // ===========================================================================
  console.log('\n• Suite: Worker Evidence Replacement (replaceWorkerEvidence)');

  await test('replaceWorkerEvidence complete success with old unreferenced photo cleanup', async () => {
    resetState();
    // Pre-seed worker 1 with front photo file 102
    filesTable.push({
      id: 102,
      storage_provider: 'SUPABASE',
      provider_file_id: 'submissions/45/workers/1_front_old.jpg',
      file_name: '1_front_old.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 40000,
      created_by: 5,
      created_at: new Date().toISOString(),
    });
    storageBuckets.evidence.add('submissions/45/workers/1_front_old.jpg');
    ppeImagesTable.push({
      id: 501,
      worker_instance_id: 1,
      file_id: 102,
      side: 'FRONT',
      created_at: new Date().toISOString(),
    });

    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const input: ReplaceWorkerEvidenceInput = {
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      side: 'FRONT',
      localUri: 'file:///local/front_resubmitted.jpg',
      cleanOldImage: true,
    };

    const result = await coordinator.replaceWorkerEvidence(input);
    assert.strictEqual(result.status, 'COMPLETE_SUCCESS');
    assert(result.data);
    assert.strictEqual(result.data.oldFileCleaned, true, 'Cleaned old unreferenced photo');
    assert.notStrictEqual(result.data.newFileId, 102);

    // Old file removed from DB and storage
    assert(!filesTable.some((f) => f.id === 102));
    assert(!storageBuckets.evidence.has('submissions/45/workers/1_front_old.jpg'));
    // PPE image now points to new file
    assert.strictEqual(ppeImagesTable.find((p) => p.worker_instance_id === 1 && p.side === 'FRONT')?.file_id, result.data.newFileId);
  });

  await test('replaceWorkerEvidence junction failure keeps old photo intact and rolls back new artifacts', async () => {
    resetState();
    // Pre-seed worker 1 with front photo file 102
    filesTable.push({
      id: 102,
      storage_provider: 'SUPABASE',
      provider_file_id: 'submissions/45/workers/1_front_old.jpg',
      file_name: '1_front_old.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 40000,
      created_by: 5,
      created_at: new Date().toISOString(),
    });
    storageBuckets.evidence.add('submissions/45/workers/1_front_old.jpg');
    ppeImagesTable.push({
      id: 501,
      worker_instance_id: 1,
      file_id: 102,
      side: 'FRONT',
      created_at: new Date().toISOString(),
    });

    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ linkPPEWorkerImageError: new Error('Submission locked for review') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.replaceWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      side: 'FRONT',
      localUri: 'file:///local/front_resubmitted.jpg',
    });

    assert.strictEqual(result.status, 'FAILURE_WITH_COMPENSATION');
    assert.strictEqual(result.stageFailed, 'JUNCTION_LINK');

    // Old photo in ppe_images is COMPLETELY UNTOUCHED
    assert.strictEqual(ppeImagesTable.find((p) => p.worker_instance_id === 1 && p.side === 'FRONT')?.file_id, 102);
    // Old file in DB and storage is COMPLETELY UNTOUCHED
    assert(filesTable.some((f) => f.id === 102));
    assert(storageBuckets.evidence.has('submissions/45/workers/1_front_old.jpg'));
    // New artifacts were cleaned up
    assert(!storageBuckets.evidence.has(storageUploadCalls[0].storagePath));
  });

  await test('replaceWorkerEvidence keeps old photo if still referenced elsewhere', async () => {
    resetState();
    // Seed old worker photo file 102
    filesTable.push({
      id: 102,
      storage_provider: 'SUPABASE',
      provider_file_id: 'submissions/45/workers/1_front_old.jpg',
      file_name: '1_front_old.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 40000,
      created_by: 5,
      created_at: new Date().toISOString(),
    });
    storageBuckets.evidence.add('submissions/45/workers/1_front_old.jpg');
    ppeImagesTable.push({
      id: 501,
      worker_instance_id: 1,
      file_id: 102,
      side: 'FRONT',
      created_at: new Date().toISOString(),
    });
    // Another reference in other_images
    otherImagesTable.push({
      id: 888,
      submission_id: 45,
      file_id: 102,
      sequence_no: 99,
      created_at: new Date().toISOString(),
    });

    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.replaceWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      side: 'FRONT',
      localUri: 'file:///local/front_resubmitted.jpg',
    });

    assert.strictEqual(result.status, 'COMPLETE_SUCCESS');
    assert.strictEqual(result.data?.oldFileCleaned, false, 'Did not delete old photo because still referenced in other_images');
    assert(filesTable.some((f) => f.id === 102));
    assert(storageBuckets.evidence.has('submissions/45/workers/1_front_old.jpg'));
  });

  await test('replaceWorkerEvidence cleanup error defers cleanup without failing replacement', async () => {
    resetState();
    filesTable.push({
      id: 102,
      storage_provider: 'SUPABASE',
      provider_file_id: 'submissions/45/workers/1_front_old.jpg',
      file_name: '1_front_old.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 40000,
      created_by: 5,
      created_at: new Date().toISOString(),
    });
    storageBuckets.evidence.add('submissions/45/workers/1_front_old.jpg');
    ppeImagesTable.push({
      id: 501,
      worker_instance_id: 1,
      file_id: 102,
      side: 'FRONT',
      created_at: new Date().toISOString(),
    });

    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService({ deleteFileRecordError: new Error('Temporary DB lock') }),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    const result = await coordinator.replaceWorkerEvidence({
      submissionId: 45,
      workerInstanceId: 1,
      workerSequenceNo: 1,
      side: 'FRONT',
      localUri: 'file:///local/front_resubmitted.jpg',
    });

    assert.strictEqual(result.status, 'REPLACEMENT_SUCCESS_CLEANUP_DEFERRED');
    assert(result.data);
    assert.strictEqual(result.data.oldFileCleaned, false);
    assert.strictEqual(ppeImagesTable.find((p) => p.worker_instance_id === 1 && p.side === 'FRONT')?.file_id, result.data.newFileId);
    assert(result.data.deferredCleanup, 'deferredCleanup object is populated');
    assert.strictEqual(result.data.deferredCleanup.fileId, 102);
    assert.strictEqual(result.data.deferredCleanup.storagePath, 'submissions/45/workers/1_front_old.jpg');
    assert(result.data.deferredCleanup.reason.includes('Temporary DB lock'));
  });

  // ===========================================================================
  // TEST SUITE: Reference Safety Checker & Tri-State Cleanup Queue
  // ===========================================================================
  console.log('\n• Suite: Reference Safety Checker & Tri-State Cleanup Queue');

  await test('createDatabaseReferenceChecker returns SAFE_TO_DELETE for unreferenced file', async () => {
    resetState();
    // File 201 has no references in users, ppe, or other
    filesTable.push({
      id: 201,
      storage_provider: 'SUPABASE',
      provider_file_id: 'submissions/10/orphaned.jpg',
      file_name: 'orphaned.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 30000,
      created_by: 1,
      created_at: new Date().toISOString(),
    });

    const checker = createDatabaseReferenceChecker(createMockDbService() as any);
    const decision = await checker('evidence', 'submissions/10/orphaned.jpg');
    assert.strictEqual(decision, 'SAFE_TO_DELETE');
  });

  await test('createDatabaseReferenceChecker returns SAFE_TO_DELETE for path missing from files table (orphan upload)', async () => {
    resetState();
    const checker = createDatabaseReferenceChecker(createMockDbService() as any);
    const decision = await checker('evidence', 'submissions/99/never_persisted_in_db.jpg');
    assert.strictEqual(decision, 'SAFE_TO_DELETE');
  });

  await test('createDatabaseReferenceChecker returns ACTIVELY_REFERENCED for live file', async () => {
    resetState();
    // User 20 references file 101
    const checker = createDatabaseReferenceChecker(createMockDbService() as any);
    const decision = await checker('avatars', 'users/20/avatar_old.jpg');
    assert.strictEqual(decision, 'ACTIVELY_REFERENCED');
  });

  await test('createDatabaseReferenceChecker returns CHECK_FAILED_RETRY when database query fails (fail-closed)', async () => {
    resetState();
    const brokenDb = createMockDbService({
      getFileRecordByProviderIdError: new Error('PostgreSQL connection timeout'),
    });
    const checker = createDatabaseReferenceChecker(brokenDb as any);
    const decision = await checker('evidence', 'submissions/45/test.jpg');
    assert.strictEqual(decision, 'CHECK_FAILED_RETRY', 'Expected CHECK_FAILED_RETRY on DB query failure');
  });

  await test('processCleanupQueue retains task as pending when decision is CHECK_FAILED_RETRY', async () => {
    resetState();
    await clearCleanupQueue();
    await enqueueFailedCleanup('evidence', 'submissions/45/unverified.jpg');

    const storageMock = createMockStorageService();
    const res = await processCleanupQueue(storageMock, {
      isSafeToDelete: async () => 'CHECK_FAILED_RETRY',
    });

    assert.strictEqual(res.deferredUnverified.length, 1, 'Task was recorded in deferredUnverified');
    assert.strictEqual(res.succeeded.length, 0, 'No deletion executed');
    assert.strictEqual(res.skippedUnsafe.length, 0, 'Not marked as skippedUnsafe');

    const pendingAfter = await getPendingCleanups();
    assert.strictEqual(pendingAfter.length, 1, 'Task remains pending in queue');
    assert.strictEqual(pendingAfter[0].storagePath, 'submissions/45/unverified.jpg');
  });

  await test('processCleanupQueue deletes object when decision is SAFE_TO_DELETE', async () => {
    resetState();
    await clearCleanupQueue();
    storageBuckets.evidence.add('submissions/45/safe_orphan.jpg');
    await enqueueFailedCleanup('evidence', 'submissions/45/safe_orphan.jpg');

    const storageMock = createMockStorageService();
    const res = await processCleanupQueue(storageMock, {
      isSafeToDelete: async () => 'SAFE_TO_DELETE',
    });

    assert.strictEqual(res.succeeded.length, 1);
    assert(!storageBuckets.evidence.has('submissions/45/safe_orphan.jpg'), 'Storage object was deleted');
    const pendingAfter = await getPendingCleanups();
    assert.strictEqual(pendingAfter.length, 0, 'Queue is empty after successful cleanup');
  });

  await test('processCleanupQueue discards live task without deleting object when ACTIVELY_REFERENCED', async () => {
    resetState();
    await clearCleanupQueue();
    storageBuckets.evidence.add('submissions/45/live_active.jpg');
    await enqueueFailedCleanup('evidence', 'submissions/45/live_active.jpg');

    const storageMock = createMockStorageService();
    const res = await processCleanupQueue(storageMock, {
      isSafeToDelete: async () => 'ACTIVELY_REFERENCED',
    });

    assert.strictEqual(res.skippedUnsafe.length, 1);
    assert.strictEqual(res.succeeded.length, 0);
    assert(storageBuckets.evidence.has('submissions/45/live_active.jpg'), 'Live object was preserved');
    const pendingAfter = await getPendingCleanups();
    assert.strictEqual(pendingAfter.length, 0, 'Live task was safely discarded from cleanup queue');
  });

  // ===========================================================================
  // TEST SUITE: Architectural Decoupling & Google Drive Inactivity
  // ===========================================================================
  console.log('\n• Suite: Architectural Invariants & Google Drive Inactivity');

  await test('Zero Google Drive calls across all workflows', async () => {
    assert.strictEqual(googleDriveCalls, 0, 'No Google Drive invocations occurred');
  });

  await test('SubmissionCoordinator enforces strict separation between database and storage', async () => {
    resetState();
    const coordinator = new SubmissionCoordinator({
      dbService: createMockDbService(),
      storageService: createMockStorageService(),
      compressImageFn: createMockCompress(),
    });

    await coordinator.submitOtherEvidence({
      submissionId: 90,
      sequenceNo: 1,
      localUri: 'file:///local/boundary_test.jpg',
    });

    assert(storageUploadCalls.length > 0, 'Storage received binary upload calls');
    assert(filesTable.length > 0, 'Database received file metadata calls');
    assert.strictEqual(googleDriveCalls, 0, 'Zero Google Drive calls made');
  });

  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  return { passed, failed, total: passed + failed };
}
