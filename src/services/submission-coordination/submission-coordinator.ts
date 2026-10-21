/**
 * PPEye Submission Coordination Layer — Coordinator
 *
 * Coordinates end-to-end multi-step pipelines:
 * 1. Image pre-upload compression (1920px JPEG @ 0.8)
 * 2. Supabase Storage binary uploads to private buckets ('evidence', 'avatars')
 * 3. PostgreSQL metadata persistence in public.files
 * 4. Relational junction linking (ppe_images, other_images, users)
 * 5. Deterministic compensating cleanup on intermediate failure
 * 6. Safe old-image replacement with positive reference verification
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - ZERO Google Drive invocations or fallbacks.
 * - Database service performs metadata and relationship operations only.
 * - Storage service performs binary bucket operations only.
 * - All intermediate rollbacks execute in reverse dependency order.
 */

import { prepareImageForUpload, type PreparedUploadImage } from '../../utils/image';
import { supabaseDatabaseService } from '../database';
import type { FileRecord, PPEImageRecord } from '../database/database.types';
import {
  enqueueFailedCleanup,
  type ReferenceSafetyDecision,
} from '../storage/cleanup-queue';
import {
  generateAvatarPath,
  generateOtherEvidencePath,
  generateWorkerPhotoPath,
} from '../storage/path-generator';
import { SupabaseStorageService } from '../storage/supabase-storage.client';
import type { ISupabaseStorageService, StorageBucket } from '../storage/supabase-storage.types';
import type {
  AvatarUploadResult,
  CompensationError,
  CoordinationResult,
  OtherEvidenceResult,
  ReplaceWorkerEvidenceInput,
  ReplaceWorkerEvidenceResult,
  SubmitOtherEvidenceInput,
  SubmitWorkerEvidenceInput,
  UploadAvatarInput,
  WorkerEvidenceResult,
} from './coordination.types';

export interface CoordinatorDependencies {
  dbService?: typeof supabaseDatabaseService;
  storageService?: ISupabaseStorageService;
  compressImageFn?: (uri: string) => Promise<PreparedUploadImage>;
}

export class SubmissionCoordinator {
  private db: typeof supabaseDatabaseService;
  private storage: ISupabaseStorageService;
  private compress: (uri: string) => Promise<PreparedUploadImage>;

  constructor(deps?: CoordinatorDependencies) {
    this.db = deps?.dbService ?? supabaseDatabaseService;
    this.storage = deps?.storageService ?? new SupabaseStorageService();
    this.compress =
      deps?.compressImageFn ??
      ((uri: string) => prepareImageForUpload(uri, { maxLongEdge: 1920, quality: 0.8 }));
  }

  /**
   * Coordinates worker evidence submission:
   * Requires BOTH FRONT and BACK photos for a complete inspection pair.
   *
   * Execution Flow:
   * 1. Validate inputs (submissionId, workerInstanceId, workerSequenceNo, frontLocalUri, backLocalUri).
   * 2. Compress front and back images to 1920px JPEG.
   * 3. Upload both binaries to the 'evidence' Supabase Storage bucket.
   * 4. Insert file records into public.files.
   * 5. Link both files into public.ppe_images (FRONT and BACK).
   *
   * Failure Compensation:
   * If any step fails, rolls back created artifacts in reverse order (junction -> metadata -> storage).
   */
  async submitWorkerEvidence(
    input: SubmitWorkerEvidenceInput
  ): Promise<CoordinationResult<WorkerEvidenceResult>> {
    // 1. Validation
    if (!input.submissionId || input.submissionId <= 0) {
      return this.fail('VALIDATION', new Error('Valid submissionId (> 0) is required.'));
    }
    if (!input.workerInstanceId || input.workerInstanceId <= 0) {
      return this.fail('VALIDATION', new Error('Valid workerInstanceId (> 0) is required.'));
    }
    if (!input.workerSequenceNo || input.workerSequenceNo <= 0) {
      return this.fail('VALIDATION', new Error('Valid workerSequenceNo (> 0) is required.'));
    }
    if (!input.frontLocalUri || !input.frontLocalUri.trim()) {
      return this.fail('VALIDATION', new Error('frontLocalUri is required for worker evidence.'));
    }
    if (!input.backLocalUri || !input.backLocalUri.trim()) {
      return this.fail('VALIDATION', new Error('backLocalUri is required for worker evidence.'));
    }

    // 2. Image Compression
    let frontPrepared: PreparedUploadImage;
    let backPrepared: PreparedUploadImage;
    try {
      frontPrepared = await this.compress(input.frontLocalUri);
      backPrepared = await this.compress(input.backLocalUri);
    } catch (compErr: any) {
      return this.fail('COMPRESSION', compErr);
    }

    // 3. Storage Upload
    const frontPath = generateWorkerPhotoPath(input.submissionId, input.workerSequenceNo, 'FRONT');
    const backPath = generateWorkerPhotoPath(input.submissionId, input.workerSequenceNo, 'BACK');
    const uploadedPaths: string[] = [];

    let frontUploadSize = frontPrepared.preparedSizeBytes ?? frontPrepared.sizeBytes ?? 0;
    let backUploadSize = backPrepared.preparedSizeBytes ?? backPrepared.sizeBytes ?? 0;

    try {
      const frontUpload = await this.storage.uploadFile({
        bucket: 'evidence',
        storagePath: frontPath,
        localUri: frontPrepared.uri,
        mimeType: 'image/jpeg',
        sizeBytes: frontUploadSize || undefined,
      });
      uploadedPaths.push(frontPath);
      frontUploadSize = frontUpload.sizeBytes;

      const backUpload = await this.storage.uploadFile({
        bucket: 'evidence',
        storagePath: backPath,
        localUri: backPrepared.uri,
        mimeType: 'image/jpeg',
        sizeBytes: backUploadSize || undefined,
      });
      uploadedPaths.push(backPath);
      backUploadSize = backUpload.sizeBytes;
    } catch (uploadErr: any) {
      const compensationErrors = await this.compensateStorage(uploadedPaths, 'evidence');
      return this.failWithComp('STORAGE_UPLOAD', uploadErr, compensationErrors);
    }

    // 4. Metadata Insertion
    const createdFiles: FileRecord[] = [];
    try {
      const frontFile = await this.db.files.createFileRecord({
        storage_provider: 'SUPABASE',
        provider_file_id: frontPath,
        file_name: frontPath.split('/').pop()!,
        mime_type: 'image/jpeg',
        size_bytes: frontUploadSize,
        created_by: input.userId ?? null,
      });
      createdFiles.push(frontFile);

      const backFile = await this.db.files.createFileRecord({
        storage_provider: 'SUPABASE',
        provider_file_id: backPath,
        file_name: backPath.split('/').pop()!,
        mime_type: 'image/jpeg',
        size_bytes: backUploadSize,
        created_by: input.userId ?? null,
      });
      createdFiles.push(backFile);
    } catch (metaErr: any) {
      const compensationErrors: CompensationError[] = [];
      const dbComp = await this.compensateFiles(createdFiles);
      compensationErrors.push(...dbComp);
      const storageComp = await this.compensateStorage(uploadedPaths, 'evidence');
      compensationErrors.push(...storageComp);
      return this.failWithComp('METADATA_INSERT', metaErr, compensationErrors);
    }

    // 5. Relational Junction Linking
    const linkedPpe: PPEImageRecord[] = [];
    const frontFile = createdFiles[0];
    const backFile = createdFiles[1];

    try {
      const frontLink = await this.db.imageLinks.linkPPEWorkerImage(
        input.workerInstanceId,
        frontFile.id,
        'FRONT'
      );
      linkedPpe.push(frontLink);

      const backLink = await this.db.imageLinks.linkPPEWorkerImage(
        input.workerInstanceId,
        backFile.id,
        'BACK'
      );
      linkedPpe.push(backLink);

      return {
        status: 'COMPLETE_SUCCESS',
        data: {
          submissionId: input.submissionId,
          workerInstanceId: input.workerInstanceId,
          front: {
            fileId: frontFile.id,
            storagePath: frontPath,
            ppeImageId: frontLink.id,
          },
          back: {
            fileId: backFile.id,
            storagePath: backPath,
            ppeImageId: backLink.id,
          },
        },
      };
    } catch (linkErr: any) {
      const compensationErrors: CompensationError[] = [];
      // 5a. Roll back any created junction link
      for (const link of linkedPpe) {
        try {
          await this.db.imageLinks.deletePPEWorkerImage(input.workerInstanceId, link.side);
        } catch (delLinkErr: any) {
          compensationErrors.push({
            stage: 'JUNCTION_LINK_ROLLBACK',
            error: delLinkErr instanceof Error ? delLinkErr : new Error(String(delLinkErr)),
          });
        }
      }
      // 5b. Roll back file metadata records
      const dbComp = await this.compensateFiles(createdFiles);
      compensationErrors.push(...dbComp);
      // 5c. Roll back binary storage objects
      const storageComp = await this.compensateStorage(uploadedPaths, 'evidence');
      compensationErrors.push(...storageComp);

      return this.failWithComp('JUNCTION_LINK', linkErr, compensationErrors);
    }
  }

  /**
   * Coordinates general site hazard / other evidence photo submission.
   */
  async submitOtherEvidence(
    input: SubmitOtherEvidenceInput
  ): Promise<CoordinationResult<OtherEvidenceResult>> {
    // 1. Validation
    if (!input.submissionId || input.submissionId <= 0) {
      return this.fail('VALIDATION', new Error('Valid submissionId (> 0) is required.'));
    }
    if (!input.sequenceNo || input.sequenceNo <= 0) {
      return this.fail('VALIDATION', new Error('Valid sequenceNo (> 0) is required.'));
    }
    if (!input.localUri || !input.localUri.trim()) {
      return this.fail('VALIDATION', new Error('localUri is required for other evidence.'));
    }

    // 2. Image Compression
    let prepared: PreparedUploadImage;
    try {
      prepared = await this.compress(input.localUri);
    } catch (compErr: any) {
      return this.fail('COMPRESSION', compErr);
    }

    // 3. Storage Upload
    const storagePath = generateOtherEvidencePath(input.submissionId, input.sequenceNo);
    let uploadSize = prepared.preparedSizeBytes ?? prepared.sizeBytes ?? 0;

    try {
      const uploadRes = await this.storage.uploadFile({
        bucket: 'evidence',
        storagePath,
        localUri: prepared.uri,
        mimeType: 'image/jpeg',
        sizeBytes: uploadSize || undefined,
      });
      uploadSize = uploadRes.sizeBytes;
    } catch (uploadErr: any) {
      return this.fail('STORAGE_UPLOAD', uploadErr);
    }

    // 4. Metadata Insertion
    let fileRecord: FileRecord;
    try {
      fileRecord = await this.db.files.createFileRecord({
        storage_provider: 'SUPABASE',
        provider_file_id: storagePath,
        file_name: storagePath.split('/').pop()!,
        mime_type: 'image/jpeg',
        size_bytes: uploadSize,
        created_by: input.userId ?? null,
      });
    } catch (metaErr: any) {
      const compStorage = await this.compensateStorage([storagePath], 'evidence');
      return this.failWithComp('METADATA_INSERT', metaErr, compStorage);
    }

    // 5. Relational Junction Linking
    try {
      const otherLink = await this.db.imageLinks.linkOtherImage(
        input.submissionId,
        fileRecord.id,
        input.sequenceNo
      );

      return {
        status: 'COMPLETE_SUCCESS',
        data: {
          submissionId: input.submissionId,
          fileId: fileRecord.id,
          storagePath,
          otherImageId: otherLink.id,
        },
      };
    } catch (linkErr: any) {
      const compensationErrors: CompensationError[] = [];
      const dbComp = await this.compensateFiles([fileRecord]);
      compensationErrors.push(...dbComp);
      const storageComp = await this.compensateStorage([storagePath], 'evidence');
      compensationErrors.push(...storageComp);

      return this.failWithComp('JUNCTION_LINK', linkErr, compensationErrors);
    }
  }

  /**
   * Coordinates user avatar upload and replacement.
   *
   * SAFE REPLACEMENT GUARANTEE:
   * - Old avatar is NEVER deleted until the new avatar is successfully uploaded, persisted, and linked.
   * - Old file is ONLY deleted if verified unreferenced across all database entities.
   * - If updating users table fails, newly uploaded avatar is compensated and old avatar remains intact.
   */
  async uploadAvatar(input: UploadAvatarInput): Promise<CoordinationResult<AvatarUploadResult>> {
    // 1. Validation
    if (!input.userId || input.userId <= 0) {
      return this.fail('VALIDATION', new Error('Valid userId (> 0) is required.'));
    }
    if (!input.localUri || !input.localUri.trim()) {
      return this.fail('VALIDATION', new Error('localUri is required for avatar upload.'));
    }

    // 2. Fetch existing avatar file ID (if any)
    let oldFileId: number | null = null;
    try {
      oldFileId = await this.db.imageLinks.getUserProfilePictureFileId(input.userId);
    } catch (fetchErr: any) {
      return this.fail('PRE_CHECK', fetchErr);
    }

    // 3. Image Compression
    let prepared: PreparedUploadImage;
    try {
      prepared = await this.compress(input.localUri);
    } catch (compErr: any) {
      return this.fail('COMPRESSION', compErr);
    }

    // 4. Storage Upload
    const storagePath = generateAvatarPath(input.userId);
    let uploadSize = prepared.preparedSizeBytes ?? prepared.sizeBytes ?? 0;

    try {
      const uploadRes = await this.storage.uploadFile({
        bucket: 'avatars',
        storagePath,
        localUri: prepared.uri,
        mimeType: 'image/jpeg',
        sizeBytes: uploadSize || undefined,
      });
      uploadSize = uploadRes.sizeBytes;
    } catch (uploadErr: any) {
      return this.fail('STORAGE_UPLOAD', uploadErr);
    }

    // 5. Metadata Insertion
    let fileRecord: FileRecord;
    try {
      fileRecord = await this.db.files.createFileRecord({
        storage_provider: 'SUPABASE',
        provider_file_id: storagePath,
        file_name: storagePath.split('/').pop()!,
        mime_type: 'image/jpeg',
        size_bytes: uploadSize,
        created_by: input.userId,
      });
    } catch (metaErr: any) {
      const compStorage = await this.compensateStorage([storagePath], 'avatars');
      return this.failWithComp('METADATA_INSERT', metaErr, compStorage);
    }

    // 6. User Profile Picture Link Update
    try {
      await this.db.imageLinks.updateUserProfilePicture(input.userId, fileRecord.id);
    } catch (linkErr: any) {
      // Compensate newly created avatar artifacts; old avatar was not touched
      const compensationErrors: CompensationError[] = [];
      const dbComp = await this.compensateFiles([fileRecord]);
      compensationErrors.push(...dbComp);
      const storageComp = await this.compensateStorage([storagePath], 'avatars');
      compensationErrors.push(...storageComp);

      return this.failWithComp('JUNCTION_LINK', linkErr, compensationErrors);
    }

    // 7. Cleanup Old Avatar (if requested and present)
    let oldFileCleaned = false;
    let cleanupDeferred = false;
    let oldStoragePath: string | undefined;
    let deferredReason: string | undefined;

    if (input.cleanOldAvatar !== false && oldFileId) {
      try {
        // POSITIVE REFERENCE CHECK: Only delete if confirmed completely unreferenced
        const stillReferenced = await this.db.files.isFileReferenced(oldFileId);
        if (!stillReferenced) {
          const oldFileRec = await this.db.files.getFileRecordById(oldFileId);
          if (oldFileRec) {
            oldStoragePath = oldFileRec.provider_file_id;
            await this.db.files.deleteFileRecord(oldFileId);
            try {
              await this.storage.deleteFile('avatars', oldFileRec.provider_file_id);
              oldFileCleaned = true;
            } catch (storageDelErr: any) {
              await enqueueFailedCleanup('avatars', oldFileRec.provider_file_id, storageDelErr);
              cleanupDeferred = true;
              deferredReason = `Storage delete failed: ${storageDelErr?.message ?? storageDelErr}`;
            }
          }
        }
      } catch (cleanErr: any) {
        cleanupDeferred = true;
        deferredReason = `Cleanup check or DB delete failed: ${cleanErr?.message ?? cleanErr}`;
        console.warn(`[Coordinator] Old avatar cleanup deferred for file ${oldFileId}:`, cleanErr.message);
      }
    }

    return {
      status: cleanupDeferred ? 'REPLACEMENT_SUCCESS_CLEANUP_DEFERRED' : 'COMPLETE_SUCCESS',
      data: {
        userId: input.userId,
        fileId: fileRecord.id,
        storagePath,
        oldFileCleaned,
        deferredCleanup:
          cleanupDeferred && oldFileId
            ? {
                fileId: oldFileId,
                storagePath: oldStoragePath,
                reason: deferredReason ?? 'Cleanup deferred',
              }
            : undefined,
      },
      warnings: cleanupDeferred ? [`Old avatar cleanup deferred: ${deferredReason}`] : undefined,
    };
  }

  /**
   * Coordinates replacement of an existing worker inspection photo (e.g. resubmission).
   *
   * SAFE REPLACEMENT GUARANTEE:
   * - Uploads new photo to fresh, collision-resistant path.
   * - Inserts new file metadata.
   * - Updates junction link in public.ppe_images to new file ID.
   * - Only AFTER junction update succeeds, checks if old file is unreferenced.
   * - If junction linking fails, rolls back new file and storage object; old photo is NEVER touched.
   */
  async replaceWorkerEvidence(
    input: ReplaceWorkerEvidenceInput
  ): Promise<CoordinationResult<ReplaceWorkerEvidenceResult>> {
    // 1. Validation
    if (!input.submissionId || input.submissionId <= 0) {
      return this.fail('VALIDATION', new Error('Valid submissionId (> 0) is required.'));
    }
    if (!input.workerInstanceId || input.workerInstanceId <= 0) {
      return this.fail('VALIDATION', new Error('Valid workerInstanceId (> 0) is required.'));
    }
    if (!input.workerSequenceNo || input.workerSequenceNo <= 0) {
      return this.fail('VALIDATION', new Error('Valid workerSequenceNo (> 0) is required.'));
    }
    if (input.side !== 'FRONT' && input.side !== 'BACK') {
      return this.fail('VALIDATION', new Error("side must be 'FRONT' or 'BACK'."));
    }
    if (!input.localUri || !input.localUri.trim()) {
      return this.fail('VALIDATION', new Error('localUri is required for replacement.'));
    }

    // 2. Fetch existing worker image pointer (to identify old file)
    let oldFileId: number | null = null;
    try {
      const currentImages = await this.db.imageLinks.getWorkerImages(input.workerInstanceId);
      oldFileId = (input.side === 'FRONT' ? currentImages.front?.file_id : currentImages.back?.file_id) ?? null;
    } catch (fetchErr: any) {
      return this.fail('PRE_CHECK', fetchErr);
    }

    // 3. Image Compression
    let prepared: PreparedUploadImage;
    try {
      prepared = await this.compress(input.localUri);
    } catch (compErr: any) {
      return this.fail('COMPRESSION', compErr);
    }

    // 4. Storage Upload to fresh path
    const newStoragePath = generateWorkerPhotoPath(input.submissionId, input.workerSequenceNo, input.side);
    let uploadSize = prepared.preparedSizeBytes ?? prepared.sizeBytes ?? 0;

    try {
      const uploadRes = await this.storage.uploadFile({
        bucket: 'evidence',
        storagePath: newStoragePath,
        localUri: prepared.uri,
        mimeType: 'image/jpeg',
        sizeBytes: uploadSize || undefined,
      });
      uploadSize = uploadRes.sizeBytes;
    } catch (uploadErr: any) {
      return this.fail('STORAGE_UPLOAD', uploadErr);
    }

    // 5. Metadata Insertion
    let newFileRecord: FileRecord;
    try {
      newFileRecord = await this.db.files.createFileRecord({
        storage_provider: 'SUPABASE',
        provider_file_id: newStoragePath,
        file_name: newStoragePath.split('/').pop()!,
        mime_type: 'image/jpeg',
        size_bytes: uploadSize,
        created_by: input.userId ?? null,
      });
    } catch (metaErr: any) {
      const compStorage = await this.compensateStorage([newStoragePath], 'evidence');
      return this.failWithComp('METADATA_INSERT', metaErr, compStorage);
    }

    // 6. Relational Junction Link Update (replacePPEWorkerImage)
    let updatedLink: PPEImageRecord;
    try {
      updatedLink = await this.db.imageLinks.replacePPEWorkerImage(
        input.workerInstanceId,
        input.side,
        newFileRecord.id
      );
    } catch (linkErr: any) {
      // Compensate new artifacts; old photo pointer was preserved
      const compensationErrors: CompensationError[] = [];
      const dbComp = await this.compensateFiles([newFileRecord]);
      compensationErrors.push(...dbComp);
      const storageComp = await this.compensateStorage([newStoragePath], 'evidence');
      compensationErrors.push(...storageComp);

      return this.failWithComp('JUNCTION_LINK', linkErr, compensationErrors);
    }

    // 7. Safe Cleanup of Old Worker Image (if requested and present)
    let oldFileCleaned = false;
    let cleanupDeferred = false;
    let oldStoragePath: string | undefined;
    let deferredReason: string | undefined;

    if (input.cleanOldImage !== false && oldFileId) {
      try {
        const stillReferenced = await this.db.files.isFileReferenced(oldFileId);
        if (!stillReferenced) {
          const oldFileRec = await this.db.files.getFileRecordById(oldFileId);
          if (oldFileRec) {
            oldStoragePath = oldFileRec.provider_file_id;
            await this.db.files.deleteFileRecord(oldFileId);
            try {
              await this.storage.deleteFile('evidence', oldFileRec.provider_file_id);
              oldFileCleaned = true;
            } catch (storageDelErr: any) {
              await enqueueFailedCleanup('evidence', oldFileRec.provider_file_id, storageDelErr);
              cleanupDeferred = true;
              deferredReason = `Storage delete failed: ${storageDelErr?.message ?? storageDelErr}`;
            }
          }
        }
      } catch (cleanErr: any) {
        cleanupDeferred = true;
        deferredReason = `Cleanup check or DB delete failed: ${cleanErr?.message ?? cleanErr}`;
        console.warn(`[Coordinator] Old worker photo cleanup deferred for file ${oldFileId}:`, cleanErr.message);
      }
    }

    return {
      status: cleanupDeferred ? 'REPLACEMENT_SUCCESS_CLEANUP_DEFERRED' : 'COMPLETE_SUCCESS',
      data: {
        submissionId: input.submissionId,
        workerInstanceId: input.workerInstanceId,
        side: input.side,
        newFileId: newFileRecord.id,
        newStoragePath,
        ppeImageId: updatedLink.id,
        oldFileCleaned,
        deferredCleanup:
          cleanupDeferred && oldFileId
            ? {
                fileId: oldFileId,
                storagePath: oldStoragePath,
                reason: deferredReason ?? 'Cleanup deferred',
              }
            : undefined,
      },
      warnings: cleanupDeferred ? [`Old photo cleanup deferred: ${deferredReason}`] : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal Compensation Helpers
  // ---------------------------------------------------------------------------

  private async compensateFiles(files: FileRecord[]): Promise<CompensationError[]> {
    const errors: CompensationError[] = [];
    for (const file of files) {
      try {
        await this.db.files.deleteFileRecord(file.id);
      } catch (err: any) {
        errors.push({
          stage: 'DATABASE_METADATA_COMPENSATION',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
    return errors;
  }

  private async compensateStorage(
    paths: string[],
    bucket: 'evidence' | 'avatars'
  ): Promise<CompensationError[]> {
    const errors: CompensationError[] = [];
    for (const path of paths) {
      try {
        await this.storage.deleteFile(bucket, path);
      } catch (err: any) {
        const wrappedErr = err instanceof Error ? err : new Error(String(err));
        errors.push({
          stage: 'STORAGE_BINARY_COMPENSATION',
          error: wrappedErr,
        });
        // Enqueue to persistent cleanup queue for background retry
        try {
          await enqueueFailedCleanup(bucket, path, wrappedErr);
        } catch {}
      }
    }
    return errors;
  }

  private fail(stage: string, err: any): CoordinationResult<any> {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      status: 'FAILURE_WITH_COMPENSATION',
      error,
      stageFailed: stage,
      compensationErrors: [],
    };
  }

  private failWithComp(
    stage: string,
    originalErr: any,
    compErrors: CompensationError[]
  ): CoordinationResult<any> {
    const error = originalErr instanceof Error ? originalErr : new Error(String(originalErr));
    const status = compErrors.length > 0 ? 'FAILURE_INCOMPLETE_COMPENSATION' : 'FAILURE_WITH_COMPENSATION';

    return {
      status,
      error,
      stageFailed: stage,
      compensationErrors: compErrors,
    };
  }
}

export const submissionCoordinator = new SubmissionCoordinator();

/**
 * Factory creating an unambiguous reference safety checker hook for processCleanupQueue.
 * Safely distinguishes between:
 * - 'SAFE_TO_DELETE': Positively confirmed completely unreferenced in public.files, users, ppe_images, other_images.
 * - 'ACTIVELY_REFERENCED': Positively confirmed referenced by a live row.
 * - 'CHECK_FAILED_RETRY': Database error, timeout, or unable to determine status.
 */
export function createDatabaseReferenceChecker(
  dbService: typeof supabaseDatabaseService = supabaseDatabaseService
): (bucket: StorageBucket, path: string) => Promise<ReferenceSafetyDecision> {
  return async (_bucket: StorageBucket, path: string): Promise<ReferenceSafetyDecision> => {
    try {
      const fileRecord = await dbService.files.getFileRecordByProviderId(path, 'SUPABASE');
      if (!fileRecord) {
        // Not in public.files: cannot be referenced by users, ppe_images, or other_images
        return 'SAFE_TO_DELETE';
      }

      const isReferenced = await dbService.files.isFileReferenced(fileRecord.id);
      if (isReferenced) {
        return 'ACTIVELY_REFERENCED';
      }

      return 'SAFE_TO_DELETE';
    } catch (err: any) {
      console.warn(
        `[ReferenceChecker] Reference check query failed for path '${path}'; marking as CHECK_FAILED_RETRY:`,
        err?.message ?? err
      );
      return 'CHECK_FAILED_RETRY';
    }
  };
}

export default submissionCoordinator;
