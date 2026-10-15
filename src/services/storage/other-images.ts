import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';
import {
  createFileRecord,
  deleteFileRecord,
  getFileRecord,
  isFileReferenced,
  setFilesRepoClientOverride,
  type FileRecord,
} from '../supabase/files.repository';
import {
  generateOtherFileName,
  getFileExtension,
} from '../../utils/image';
import type {
  BatchOtherImagesResult,
  OtherImageFileInfo,
  OtherImageUploadErrorDetail,
  RemoveOtherImageOptions,
  StoredOtherImage,
  UploadOtherImageInput,
  UploadOtherImagesInput,
} from './other-images.types';
import { PartialOtherUploadError } from './other-images.types';

export * from './other-images.types';

export type OtherImageRow = Database['public']['Tables']['other_images']['Row'];
export type PPESubmissionRow = Database['public']['Tables']['ppe_submissions']['Row'];

// ---------------------------------------------------------------------------
// Pluggable test injectors
// ---------------------------------------------------------------------------

let supabaseOverride: SupabaseClient<Database> | null = null;
let injectedDriveUploader: ((params: { localUri: string; fileName: string; folderId?: string }) => Promise<{
  fileId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}>) | null = null;
let injectedDriveDeleter: ((fileId: string) => Promise<boolean>) | null = null;

export function setOtherImagesSupabaseOverride(client: SupabaseClient<Database> | null): void {
  supabaseOverride = client;
  setFilesRepoClientOverride(client);
}

export function setOtherImagesDriveUploaderMock(
  uploader: ((params: { localUri: string; fileName: string; folderId?: string }) => Promise<{
    fileId: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
  }>) | null
): void {
  injectedDriveUploader = uploader;
}

export function setOtherImagesDriveDeleterMock(
  deleter: ((fileId: string) => Promise<boolean>) | null
): void {
  injectedDriveDeleter = deleter;
}

function getDb(client?: SupabaseClient<Database>): SupabaseClient<Database> {
  if (client) {
    return client;
  }
  if (supabaseOverride) {
    return supabaseOverride;
  }
  return require('../supabase/client').supabase;
}

function getDriveUploader() {
  if (injectedDriveUploader) {
    return injectedDriveUploader;
  }
  return async (params: { localUri: string; fileName: string; folderId?: string }) => {
    const { uploadFileToDrive } = require('../google-drive/upload');
    const result = await uploadFileToDrive({
      localUri: params.localUri,
      fileName: params.fileName,
      folderId: params.folderId,
    });
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
    };
  };
}

function getDriveDeleter() {
  if (injectedDriveDeleter) {
    return injectedDriveDeleter;
  }
  return async (fileId: string) => {
    const { deleteFile } = require('../google-drive/files');
    return deleteFile(fileId);
  };
}

// ---------------------------------------------------------------------------
// Authorization & Submission Helpers
// ---------------------------------------------------------------------------

/**
 * Validates submission existence and ensures the given user is authorized
 * (either the creator or a vendor member).
 */
async function verifySubmissionAndAuth(
  submissionId: number,
  userId?: number,
  db?: SupabaseClient<Database>
): Promise<PPESubmissionRow> {
  const client = getDb(db);

  const { data: sub, error } = await client
    .from('ppe_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error verifying submission #${submissionId}: ${error.message}`,
      { details: error }
    );
  }

  if (!sub) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Submission #${submissionId} not found.`
    );
  }

  if (userId) {
    if (sub.submitted_by !== userId) {
      const { data: member } = await client
        .from('vendor_members')
        .select('id')
        .eq('vendor_profile_id', sub.vendor_profile_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!member) {
        throw new StorageError(
          StorageErrorCode.PERMISSION_DENIED,
          `User #${userId} is not authorized to modify evidence for submission #${submissionId}.`
        );
      }
    }
  }

  return sub;
}

// ---------------------------------------------------------------------------
// 1. getOtherImages
// ---------------------------------------------------------------------------

/**
 * Retrieves all "Others" evidence photos for a submission with stable sequence ordering.
 */
export async function getOtherImages(
  submissionId: number,
  client?: SupabaseClient<Database>
): Promise<StoredOtherImage[]> {
  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  const { data, error } = await db
    .from('other_images')
    .select(`
      id,
      submission_id,
      file_id,
      sequence_no,
      created_at,
      files (
        id,
        storage_provider,
        provider_file_id,
        file_name,
        mime_type,
        size_bytes,
        created_by,
        created_at
      )
    `)
    .eq('submission_id', submissionId)
    .order('sequence_no', { ascending: true, nullsFirst: false });

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to query other_images for submission #${submissionId}: ${error.message}`,
      { details: error }
    );
  }

  const rows: any[] = (data as any[]) || [];
  const results: StoredOtherImage[] = [];

  for (const row of rows) {
    const rawFile = Array.isArray(row.files) ? row.files[0] : row.files;
    let fileInfo: OtherImageFileInfo;

    if (rawFile) {
      fileInfo = {
        id: rawFile.id,
        storageProvider: rawFile.storage_provider as StorageProvider,
        providerFileId: rawFile.provider_file_id,
        fileName: rawFile.file_name,
        mimeType: rawFile.mime_type ?? null,
        sizeBytes: rawFile.size_bytes ?? null,
        createdBy: rawFile.created_by ?? null,
        createdAt: rawFile.created_at,
      };
    } else {
      const fileRec = await getFileRecord(row.file_id);
      if (!fileRec) {
        continue;
      }
      fileInfo = {
        id: fileRec.id,
        storageProvider: fileRec.storage_provider as StorageProvider,
        providerFileId: fileRec.provider_file_id,
        fileName: fileRec.file_name,
        mimeType: fileRec.mime_type ?? null,
        sizeBytes: fileRec.size_bytes ?? null,
        createdBy: fileRec.created_by ?? null,
        createdAt: fileRec.created_at,
      };
    }

    results.push({
      id: row.id,
      submissionId: row.submission_id,
      fileId: row.file_id,
      sequenceNo: row.sequence_no,
      createdAt: row.created_at,
      file: fileInfo,
    });
  }

  // Stable sequence ordering: secondary sort by id if sequence_no is equal or null
  return results.sort((a, b) => {
    const seqA = a.sequenceNo ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.sequenceNo ?? Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    return a.id - b.id;
  });
}

// ---------------------------------------------------------------------------
// 2. uploadOtherImage
// ---------------------------------------------------------------------------

/**
 * Uploads a single "Others" evidence photo and links it to a submission.
 */
export async function uploadOtherImage(
  input: UploadOtherImageInput,
  client?: SupabaseClient<Database>
): Promise<StoredOtherImage> {
  const { submissionId, localUri, userId } = input;

  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  if (!localUri || !localUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'localUri must not be empty.'
    );
  }

  const db = getDb(client);

  // 1. Authorization & submission existence check
  const sub = await verifySubmissionAndAuth(submissionId, userId, db);

  // 2. Determine sequence number for stable ordering
  let sequenceNo = input.sequenceNo;
  if (sequenceNo === undefined || sequenceNo === null) {
    const existing = await getOtherImages(submissionId, db);
    const maxSeq = existing.reduce((max, img) => Math.max(max, img.sequenceNo ?? 0), 0);
    sequenceNo = maxSeq + 1;
  }

  // 3. Resolve standardized filename
  const siteName = input.siteName ?? sub.site_name ?? 'site';
  const ext = getFileExtension(localUri);
  const fileName = generateOtherFileName(siteName, sequenceNo, ext);

  // 4. Upload binary to Google Drive
  const uploader = getDriveUploader();
  let driveResult: { fileId: string; fileName: string; mimeType?: string; sizeBytes?: number };

  try {
    driveResult = await uploader({
      localUri,
      fileName,
      folderId: input.folderId,
    });
  } catch (err: any) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      `Failed to upload other image to storage: ${err?.message ?? err}`,
      { cause: err }
    );
  }

  // 5. Persist record in files table
  let fileRecord: FileRecord;
  try {
    fileRecord = await createFileRecord(
      {
        storage_provider: 'GOOGLE_DRIVE',
        provider_file_id: driveResult.fileId,
        file_name: fileName,
        mime_type: driveResult.mimeType ?? 'image/jpeg',
        size_bytes: driveResult.sizeBytes ?? null,
        created_by: userId ?? null,
      },
      { onConflict: 'return_existing' }
    );
  } catch (err: any) {
    try {
      const deleter = getDriveDeleter();
      await deleter(driveResult.fileId);
    } catch {}
    throw err;
  }

  // 6. Insert into other_images table
  const { data: otherImg, error: insertError } = await db
    .from('other_images')
    .insert({
      submission_id: submissionId,
      file_id: fileRecord.id,
      sequence_no: sequenceNo,
    })
    .select()
    .single();

  if (insertError || !otherImg) {
    // Database relationship failure -> rollback files record and remote drive file
    try {
      await deleteFileRecord(fileRecord.id, { force: true });
      const deleter = getDriveDeleter();
      await deleter(driveResult.fileId);
    } catch {}

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to insert other_images record: ${insertError?.message ?? 'Unknown error'}`,
      { details: insertError }
    );
  }

  return {
    id: otherImg.id,
    submissionId,
    fileId: fileRecord.id,
    sequenceNo: otherImg.sequence_no,
    createdAt: otherImg.created_at,
    file: {
      id: fileRecord.id,
      storageProvider: fileRecord.storage_provider as StorageProvider,
      providerFileId: fileRecord.provider_file_id,
      fileName: fileRecord.file_name,
      mimeType: fileRecord.mime_type,
      sizeBytes: fileRecord.size_bytes,
      createdBy: fileRecord.created_by,
      createdAt: fileRecord.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. uploadOtherImages (Batch with partial success & individual retries)
// ---------------------------------------------------------------------------

/**
 * Uploads zero or more "Others" evidence photos.
 *
 * Resilience features:
 * - Supports zero or more images (empty list returns immediately without side-effects).
 * - Preserves stable sequence ordering.
 * - Partial success: records succeeded images and reports individual failures.
 * - Individual retries: callers can re-submit failed items without duplicating succeeded ones.
 */
export async function uploadOtherImages(
  input: UploadOtherImagesInput,
  client?: SupabaseClient<Database>
): Promise<BatchOtherImagesResult> {
  const { submissionId, images, userId, throwOnPartialFailure = false } = input;

  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  // 1. Fast-path: zero images
  if (!images || images.length === 0) {
    const existing = await getOtherImages(submissionId, db);
    return {
      submissionId,
      images: existing,
      newlyUploaded: [],
      success: true,
      total: 0,
      succeeded: 0,
      failed: 0,
    };
  }

  // 2. Perform submission existence & authorization check once upfront
  const sub = await verifySubmissionAndAuth(submissionId, userId, db);

  // 3. Determine starting sequence number for stable ordering
  const existingImages = await getOtherImages(submissionId, db);
  let currentMaxSeq = existingImages.reduce((max, img) => Math.max(max, img.sequenceNo ?? 0), 0);

  const newlyUploaded: StoredOtherImage[] = [];
  const errors: OtherImageUploadErrorDetail[] = [];

  // 4. Process each image sequentially to maintain stable sequence ordering
  for (let idx = 0; idx < images.length; idx++) {
    const item = images[idx];
    const localUri = typeof item === 'string' ? item : item.localUri;
    const explicitSeq = typeof item === 'object' ? item.sequenceNo : undefined;

    const assignedSeq = explicitSeq !== undefined ? explicitSeq : ++currentMaxSeq;

    try {
      const stored = await uploadOtherImage(
        {
          submissionId,
          localUri,
          sequenceNo: assignedSeq,
          siteName: input.siteName ?? sub.site_name,
          userId,
          folderId: input.folderId,
        },
        db
      );
      newlyUploaded.push(stored);
    } catch (err: any) {
      const storageError =
        err instanceof StorageError
          ? err
          : new StorageError(StorageErrorCode.UPLOAD_FAILED, `Upload failed: ${err?.message ?? err}`, {
              cause: err,
            });
      errors.push({
        index: idx,
        localUri,
        error: storageError,
      });
    }
  }

  const allCurrent = await getOtherImages(submissionId, db);
  const success = errors.length === 0;

  const result: BatchOtherImagesResult = {
    submissionId,
    images: allCurrent,
    newlyUploaded,
    errors: errors.length > 0 ? errors : undefined,
    success,
    total: images.length,
    succeeded: newlyUploaded.length,
    failed: errors.length,
  };

  if (!success && throwOnPartialFailure) {
    throw new PartialOtherUploadError(
      `Failed to upload ${errors.length} of ${images.length} other images for submission #${submissionId}.`,
      result,
      errors[0]?.error
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. removeOtherImage
// ---------------------------------------------------------------------------

/**
 * Removes an "Others" evidence photo safely.
 *
 * Safety rules:
 * - Authorization check: only the submission author or vendor members can delete evidence.
 * - Audited evidence protection: deletion is rejected if the submission has already been reviewed in other_reviews or submission_reviews, unless options.force is true.
 * - Shared evidence protection: only deletes the underlying files record and remote storage file if it is NOT referenced by other records (e.g. users or ppe_images).
 */
export async function removeOtherImage(
  otherImageId: number,
  options?: RemoveOtherImageOptions,
  client?: SupabaseClient<Database>
): Promise<boolean> {
  if (!otherImageId || otherImageId <= 0 || !Number.isInteger(otherImageId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid otherImageId: ${otherImageId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  // 1. Fetch other_images record
  const { data: record, error: fetchErr } = await db
    .from('other_images')
    .select('id, submission_id, file_id')
    .eq('id', otherImageId)
    .maybeSingle();

  if (fetchErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error querying other_image #${otherImageId}: ${fetchErr.message}`,
      { details: fetchErr }
    );
  }

  // Idempotent: already gone
  if (!record) {
    return true;
  }

  // 2. Authorization check
  const sub = await verifySubmissionAndAuth(record.submission_id, options?.userId, db);

  // 3. Audited evidence protection: check other_reviews and submission_reviews
  if (!options?.force) {
    const { data: otherRevs } = await db
      .from('other_reviews')
      .select('id')
      .eq('submission_id', record.submission_id);

    const { data: subRevs } = await db
      .from('submission_reviews')
      .select('id')
      .eq('submission_id', record.submission_id);

    const isAudited = (otherRevs && otherRevs.length > 0) || (subRevs && subRevs.length > 0);
    if (isAudited) {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        `Cannot delete evidence #${otherImageId}: submission #${record.submission_id} has already been reviewed/audited.`
      );
    }
  }

  // 4. Remove other_images row
  const { error: deleteErr } = await db
    .from('other_images')
    .delete()
    .eq('id', otherImageId);

  if (deleteErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to delete other_images row #${otherImageId}: ${deleteErr.message}`,
      { details: deleteErr }
    );
  }

  // 5. Shared evidence check before deleting underlying files record & storage binary
  try {
    const isShared = await isFileReferenced(record.file_id);
    if (!isShared) {
      const fileRec = await getFileRecord(record.file_id);
      await deleteFileRecord(record.file_id, { force: true });
      if (fileRec?.provider_file_id) {
        const deleter = getDriveDeleter();
        await deleter(fileRec.provider_file_id);
      }
    }
  } catch (cleanupErr) {
    console.warn(`[Others Evidence] Warning cleaning up file record for other_image #${otherImageId}:`, cleanupErr);
  }

  return true;
}
