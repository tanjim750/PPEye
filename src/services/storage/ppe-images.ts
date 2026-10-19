import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ImageSide, StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';
import {
  createFileRecord,
  deleteFileRecord,
  getFileRecord,
  setFilesRepoClientOverride,
  type FileRecord,
} from '../supabase/files.repository';
import {
  generatePPEFileName,
  getFileExtension,
} from '../../utils/image';
import type {
  GetWorkerImagesResult,
  PPEImageFileInfo,
  ReplacePPEImageInput,
  StoredPPEImage,
  UploadPPEImageInput,
  UploadWorkerImagePairInput,
  WorkerImagePairResult,
} from './ppe-images.types';
import { PartialUploadError } from './ppe-images.types';

export * from './ppe-images.types';

export type PPEWorkerInstanceRow = Database['public']['Tables']['ppe_worker_instances']['Row'];
export type PPEImageRow = Database['public']['Tables']['ppe_images']['Row'];

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

export function setPpeImagesSupabaseOverride(client: SupabaseClient<Database> | null): void {
  supabaseOverride = client;
  setFilesRepoClientOverride(client);
}

export function setPpeImagesDriveUploaderMock(
  uploader: ((params: { localUri: string; fileName: string; folderId?: string }) => Promise<{
    fileId: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
  }>) | null
): void {
  injectedDriveUploader = uploader;
}

export function setPpeImagesDriveDeleterMock(
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
// Worker Instance Query & Creation
// ---------------------------------------------------------------------------

/**
 * Retrieves a worker instance by primary key.
 */
export async function getWorkerInstance(
  workerInstanceId: number,
  client?: SupabaseClient<Database>
): Promise<PPEWorkerInstanceRow | null> {
  if (!workerInstanceId || workerInstanceId <= 0 || !Number.isInteger(workerInstanceId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid workerInstanceId: ${workerInstanceId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);
  const { data, error } = await db
    .from('ppe_worker_instances')
    .select('*')
    .eq('id', workerInstanceId)
    .maybeSingle();

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Error fetching worker instance #${workerInstanceId}: ${error.message}`,
      { details: error }
    );
  }

  return data ?? null;
}

/**
 * Retrieves or creates a worker instance using (submission_id, sequence_no).
 */
export async function getOrCreateWorkerInstance(
  submissionId: number,
  sequenceNo: number,
  client?: SupabaseClient<Database>
): Promise<PPEWorkerInstanceRow> {
  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  if (!sequenceNo || sequenceNo <= 0 || !Number.isInteger(sequenceNo)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid sequenceNo: ${sequenceNo}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  // 1. Check if already exists
  const { data: existing, error: selectErr } = await db
    .from('ppe_worker_instances')
    .select('*')
    .eq('submission_id', submissionId)
    .eq('sequence_no', sequenceNo)
    .maybeSingle();

  if (selectErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error checking worker instance: ${selectErr.message}`,
      { details: selectErr }
    );
  }

  if (existing) {
    return existing;
  }

  // 2. Insert new instance
  const { data: created, error: insertErr } = await db
    .from('ppe_worker_instances')
    .insert({
      submission_id: submissionId,
      sequence_no: sequenceNo,
    })
    .select()
    .single();

  if (insertErr || !created) {
    // If concurrent insert occurred, attempt re-fetch
    if ((insertErr as any)?.code === '23505') {
      const { data: refetched } = await db
        .from('ppe_worker_instances')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('sequence_no', sequenceNo)
        .maybeSingle();

      if (refetched) {
        return refetched;
      }
    }

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to create worker instance for submission #${submissionId}, seq #${sequenceNo}: ${insertErr?.message ?? 'Unknown error'}`,
      { details: insertErr }
    );
  }

  return created;
}

// ---------------------------------------------------------------------------
// 1. getWorkerImages
// ---------------------------------------------------------------------------

/**
 * Retrieves the FRONT and BACK images linked to a workerInstanceId.
 * Maintains FRONT/BACK relationship strictly via workerInstanceId.
 */
export async function getWorkerImages(
  workerInstanceId: number,
  client?: SupabaseClient<Database>
): Promise<GetWorkerImagesResult> {
  if (!workerInstanceId || workerInstanceId <= 0 || !Number.isInteger(workerInstanceId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid workerInstanceId: ${workerInstanceId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  const { data, error } = await db
    .from('ppe_images')
    .select(`
      id,
      worker_instance_id,
      file_id,
      side,
      created_at,
      files (*)
    `)
    .eq('worker_instance_id', workerInstanceId);

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Error querying worker images for workerInstanceId #${workerInstanceId}: ${error.message}`,
      { details: error }
    );
  }

  const rows: any[] = (data as any[]) || [];
  const allImages: StoredPPEImage[] = [];

  for (const row of rows) {
    const rawFile = Array.isArray(row.files) ? row.files[0] : row.files;
    let fileInfo: PPEImageFileInfo;

    if (rawFile) {
      fileInfo = {
        id: rawFile.id,
        storageProvider: rawFile.storage_provider as StorageProvider,
        providerFileId: rawFile.drive_id || rawFile.provider_file_id || String(rawFile.id),
        fileName: rawFile.file_name,
        mimeType: rawFile.mime_type ?? null,
        sizeBytes: rawFile.size_bytes ?? null,
        createdBy: rawFile.created_by ?? null,
        createdAt: rawFile.created_at,
      };
    } else {
      // Fallback: load file directly by ID
      const fileRec = await getFileRecord(row.file_id);
      if (!fileRec) {
        continue;
      }
      fileInfo = {
        id: fileRec.id,
        storageProvider: fileRec.storage_provider as StorageProvider,
        providerFileId: (fileRec as any).drive_id || fileRec.provider_file_id || String(fileRec.id),
        fileName: fileRec.file_name,
        mimeType: fileRec.mime_type ?? null,
        sizeBytes: fileRec.size_bytes ?? null,
        createdBy: fileRec.created_by ?? null,
        createdAt: fileRec.created_at,
      };
    }

    allImages.push({
      id: row.id,
      workerInstanceId: row.worker_instance_id,
      fileId: row.file_id,
      side: row.side as ImageSide,
      createdAt: row.created_at,
      file: fileInfo,
    });
  }

  const front = allImages.find((img) => img.side === 'FRONT') ?? null;
  const back = allImages.find((img) => img.side === 'BACK') ?? null;

  return {
    workerInstanceId,
    front,
    back,
    all: allImages,
  };
}

// ---------------------------------------------------------------------------
// 2. uploadPPEImage
// ---------------------------------------------------------------------------

/**
 * Uploads a single PPE inspection image (FRONT or BACK) for a specific workerInstanceId.
 *
 * Rules:
 * - Uses workerInstanceId (never worker sequence) as identity.
 * - Prevents duplicate active images for a worker side.
 * - If an image already exists and overwrite is true, delegates to replacePPEImage.
 * - If an image already exists and overwrite is false, returns existing active image.
 */
export async function uploadPPEImage(
  input: UploadPPEImageInput,
  client?: SupabaseClient<Database>
): Promise<StoredPPEImage> {
  const { workerInstanceId, side, localUri, overwrite = false } = input;

  if (!workerInstanceId || workerInstanceId <= 0 || !Number.isInteger(workerInstanceId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid workerInstanceId: ${workerInstanceId}. Must be a positive integer.`
    );
  }

  if (side !== 'FRONT' && side !== 'BACK') {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid side: "${side}". Must be "FRONT" or "BACK".`
    );
  }

  if (!localUri || !localUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'localUri must not be empty.'
    );
  }

  const db = getDb(client);

  // 1. Verify worker instance exists
  const worker = await getWorkerInstance(workerInstanceId, db);
  if (!worker) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Worker instance #${workerInstanceId} does not exist.`
    );
  }

  // 2. Check for existing active image on this side (prevent duplicates)
  const existingImages = await getWorkerImages(workerInstanceId, db);
  const existing = side === 'FRONT' ? existingImages.front : existingImages.back;

  if (existing) {
    if (overwrite) {
      return replacePPEImage(
        {
          workerInstanceId,
          side,
          newLocalUri: localUri,
          siteName: input.siteName,
          workerSequenceNo: input.workerSequenceNo,
          userId: input.userId,
          folderId: input.folderId,
        },
        db
      );
    }
    // Idempotent duplicate prevention: return existing active image
    return existing;
  }

  // 3. Resolve file naming
  let siteName = input.siteName;
  if (!siteName) {
    try {
      const { data: sub } = await db
        .from('ppe_submissions')
        .select('site_name')
        .eq('id', worker.submission_id)
        .maybeSingle();
      siteName = sub?.site_name ?? 'site';
    } catch {
      siteName = 'site';
    }
  }

  const sequenceNo = input.workerSequenceNo ?? worker.sequence_no;
  const ext = getFileExtension(localUri);
  const fileName = generatePPEFileName(siteName, sequenceNo, side, ext);

  // 4. Upload binary to storage provider (Google Drive)
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
      `Failed to upload ${side} photo to storage: ${err?.message ?? err}`,
      { cause: err }
    );
  }

  // 5. Create record in files table
  let fileRecord: FileRecord;
  try {
    fileRecord = await createFileRecord(
      {
        storage_provider: 'GOOGLE_DRIVE',
        provider_file_id: driveResult.fileId,
        file_name: fileName,
        mime_type: driveResult.mimeType ?? 'image/jpeg',
        size_bytes: driveResult.sizeBytes ?? null,
        created_by: input.userId ?? null,
      },
      { onConflict: 'return_existing' }
    );
  } catch (err: any) {
    // Clean up uploaded drive file if file record creation failed
    try {
      const deleter = getDriveDeleter();
      await deleter(driveResult.fileId);
    } catch {}
    throw err;
  }

  // 6. Persist in ppe_images table
  const { data: ppeImg, error: insertError } = await db
    .from('ppe_images')
    .insert({
      worker_instance_id: workerInstanceId,
      file_id: fileRecord.id,
      side,
    })
    .select()
    .single();

  if (insertError || !ppeImg) {
    // Rollback: delete from files table and remote drive
    try {
      await deleteFileRecord(fileRecord.id, { force: true });
      const deleter = getDriveDeleter();
      await deleter(driveResult.fileId);
    } catch {}

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to insert ppe_images record: ${insertError?.message ?? 'Unknown error'}`,
      { details: insertError }
    );
  }

  return {
    id: ppeImg.id,
    workerInstanceId,
    fileId: fileRecord.id,
    side,
    createdAt: ppeImg.created_at,
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
// 3. uploadWorkerImagePair
// ---------------------------------------------------------------------------

/**
 * Uploads paired FRONT and BACK images for a worker instance.
 *
 * Resilience features:
 * - Maintains FRONT/BACK relationship using workerInstanceId.
 * - Prevents duplicate active images.
 * - Handles partial failure: if front succeeds and back fails, front remains safely stored.
 * - Retries: subsequent invocation with same workerInstanceId detects existing sides and only uploads missing sides.
 * - Optional throwOnPartialFailure to control caller error propagation.
 */
export async function uploadWorkerImagePair(
  input: UploadWorkerImagePairInput,
  client?: SupabaseClient<Database>
): Promise<WorkerImagePairResult> {
  const { workerInstanceId, frontLocalUri, backLocalUri, throwOnPartialFailure = false } = input;

  if (!workerInstanceId || workerInstanceId <= 0 || !Number.isInteger(workerInstanceId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid workerInstanceId: ${workerInstanceId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  // 1. Inspect existing active images for retries and duplicate prevention
  const existing = await getWorkerImages(workerInstanceId, db);

  let frontResult: StoredPPEImage | null = existing.front;
  let backResult: StoredPPEImage | null = existing.back;
  let frontError: StorageError | undefined;
  let backError: StorageError | undefined;

  // 2. Upload Front image if provided and not already present
  if (frontLocalUri && frontLocalUri.trim()) {
    if (!frontResult) {
      try {
        frontResult = await uploadPPEImage(
          {
            workerInstanceId,
            side: 'FRONT',
            localUri: frontLocalUri,
            siteName: input.siteName,
            workerSequenceNo: input.workerSequenceNo,
            userId: input.userId,
            folderId: input.folderId,
          },
          db
        );
      } catch (err: any) {
        frontError =
          err instanceof StorageError
            ? err
            : new StorageError(StorageErrorCode.UPLOAD_FAILED, `Front upload failed: ${err?.message ?? err}`, {
                cause: err,
              });
      }
    }
  }

  // 3. Upload Back image if provided and not already present
  if (backLocalUri && backLocalUri.trim()) {
    if (!backResult) {
      try {
        backResult = await uploadPPEImage(
          {
            workerInstanceId,
            side: 'BACK',
            localUri: backLocalUri,
            siteName: input.siteName,
            workerSequenceNo: input.workerSequenceNo,
            userId: input.userId,
            folderId: input.folderId,
          },
          db
        );
      } catch (err: any) {
        backError =
          err instanceof StorageError
            ? err
            : new StorageError(StorageErrorCode.UPLOAD_FAILED, `Back upload failed: ${err?.message ?? err}`, {
                cause: err,
              });
      }
    }
  }

  const hasErrors = Boolean(frontError || backError);
  const success = !hasErrors;
  const errors = hasErrors ? { front: frontError, back: backError } : undefined;

  const result: WorkerImagePairResult = {
    workerInstanceId,
    front: frontResult,
    back: backResult,
    success,
    errors,
  };

  if (!success && throwOnPartialFailure) {
    const errorDetails = [
      frontError ? `front: ${frontError.message}` : null,
      backError ? `back: ${backError.message}` : null,
    ]
      .filter(Boolean)
      .join('; ');

    throw new PartialUploadError(
      `Partial failure uploading images for workerInstance #${workerInstanceId}: ${errorDetails}`,
      result,
      frontError || backError
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. replacePPEImage
// ---------------------------------------------------------------------------

/**
 * Replaces an existing PPE image for a worker's side (FRONT or BACK).
 *
 * Safety & Evidence Protocol:
 * 1. Upload and persist replacement in storage and files table BEFORE switching the relationship.
 * 2. If upload or database file creation fails, the old image is preserved untouched.
 * 3. Switch the relationship in ppe_images.
 * 4. If switching in ppe_images fails, rollback the new file and preserve the old image.
 * 5. If replacement succeeds:
 *    - Retain historical evidence if a review exists in ppe_reviews or retainHistoricalEvidence is true.
 *    - Only delete old unreferenced file if explicitly allowed and unreviewed.
 */
export async function replacePPEImage(
  input: ReplacePPEImageInput,
  client?: SupabaseClient<Database>
): Promise<StoredPPEImage> {
  const { workerInstanceId, side, newLocalUri } = input;

  if (!workerInstanceId || workerInstanceId <= 0 || !Number.isInteger(workerInstanceId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid workerInstanceId: ${workerInstanceId}. Must be a positive integer.`
    );
  }

  if (side !== 'FRONT' && side !== 'BACK') {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid side: "${side}". Must be "FRONT" or "BACK".`
    );
  }

  if (!newLocalUri || !newLocalUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'newLocalUri must not be empty.'
    );
  }

  const db = getDb(client);

  // 1. Verify worker instance exists
  const worker = await getWorkerInstance(workerInstanceId, db);
  if (!worker) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Worker instance #${workerInstanceId} does not exist.`
    );
  }

  // 2. Find current active image for this side
  const existingImages = await getWorkerImages(workerInstanceId, db);
  const oldImage = side === 'FRONT' ? existingImages.front : existingImages.back;

  // If no existing image, perform initial upload directly
  if (!oldImage) {
    return uploadPPEImage(
      {
        workerInstanceId,
        side,
        localUri: newLocalUri,
        siteName: input.siteName,
        workerSequenceNo: input.workerSequenceNo,
        userId: input.userId,
        folderId: input.folderId,
      },
      db
    );
  }

  // 3. Resolve replacement file naming
  let siteName = input.siteName;
  if (!siteName) {
    try {
      const { data: sub } = await db
        .from('ppe_submissions')
        .select('site_name')
        .eq('id', worker.submission_id)
        .maybeSingle();
      siteName = sub?.site_name ?? 'site';
    } catch {
      siteName = 'site';
    }
  }

  const sequenceNo = input.workerSequenceNo ?? worker.sequence_no;
  const ext = getFileExtension(newLocalUri);
  const fileName = generatePPEFileName(siteName, sequenceNo, side, ext);

  // 4. STEP 1: Upload and persist replacement BEFORE touching the active relationship
  const uploader = getDriveUploader();
  let newDriveResult: { fileId: string; fileName: string; mimeType?: string; sizeBytes?: number };

  try {
    newDriveResult = await uploader({
      localUri: newLocalUri,
      fileName,
      folderId: input.folderId,
    });
  } catch (err: any) {
    // Old image is 100% preserved
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      `Failed to upload replacement ${side} image to storage: ${err?.message ?? err}. Old image preserved.`,
      { cause: err }
    );
  }

  let newFileRecord: FileRecord;
  try {
    newFileRecord = await createFileRecord(
      {
        storage_provider: 'GOOGLE_DRIVE',
        provider_file_id: newDriveResult.fileId,
        file_name: fileName,
        mime_type: newDriveResult.mimeType ?? 'image/jpeg',
        size_bytes: newDriveResult.sizeBytes ?? null,
        created_by: input.userId ?? null,
      },
      { onConflict: 'return_existing' }
    );
  } catch (err: any) {
    // Clean up uploaded new drive file; old image remains preserved
    try {
      const deleter = getDriveDeleter();
      await deleter(newDriveResult.fileId);
    } catch {}
    throw err;
  }

  // 5. STEP 2: Switch the active relationship in ppe_images
  const { data: updatedPpeImg, error: updateError } = await db
    .from('ppe_images')
    .update({
      file_id: newFileRecord.id,
      created_at: new Date().toISOString(),
    })
    .eq('id', oldImage.id)
    .select()
    .single();

  if (updateError || !updatedPpeImg) {
    // REPLACEMENT ROLLBACK:
    // Database switch failed -> delete newly uploaded file and preserve the old image active
    try {
      await deleteFileRecord(newFileRecord.id, { force: true });
      const deleter = getDriveDeleter();
      await deleter(newDriveResult.fileId);
    } catch {}

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to switch active PPE image relationship in database: ${updateError?.message ?? 'Unknown error'}. Old image preserved.`,
      { details: updateError }
    );
  }

  // 6. STEP 3: Handle old image historical evidence vs cleanup
  // Check if a review already exists for this worker instance
  let hasReview = false;
  try {
    const { data: reviews } = await db
      .from('ppe_reviews')
      .select('id')
      .eq('worker_instance_id', workerInstanceId);
    hasReview = Boolean(reviews && reviews.length > 0);
  } catch {
    hasReview = false;
  }

  // Retain historical evidence if requested, or if a review exists, or by default (audit trail)
  const shouldRetain = input.retainHistoricalEvidence !== undefined
    ? input.retainHistoricalEvidence
    : (hasReview || true);

  if (!shouldRetain && !hasReview) {
    // Safe to delete old file if caller explicitly requested no retention AND no review exists
    try {
      await deleteFileRecord(oldImage.file.id, { force: true });
      const deleter = getDriveDeleter();
      await deleter(oldImage.file.providerFileId);
    } catch (cleanupErr) {
      console.warn('[PPE Images] Warning during old file cleanup:', cleanupErr);
    }
  }

  return {
    id: updatedPpeImg.id,
    workerInstanceId,
    fileId: newFileRecord.id,
    side,
    createdAt: updatedPpeImg.created_at,
    file: {
      id: newFileRecord.id,
      storageProvider: newFileRecord.storage_provider as StorageProvider,
      providerFileId: newFileRecord.provider_file_id,
      fileName: newFileRecord.file_name,
      mimeType: newFileRecord.mime_type,
      sizeBytes: newFileRecord.size_bytes,
      createdBy: newFileRecord.created_by,
      createdAt: newFileRecord.created_at,
    },
  };
}
