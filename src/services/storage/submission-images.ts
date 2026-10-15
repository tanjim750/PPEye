import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, SubmissionStatus } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';
import {
  getOrCreateWorkerInstance,
  getWorkerImages,
  setPpeImagesDriveDeleterMock,
  setPpeImagesDriveUploaderMock,
  setPpeImagesSupabaseOverride,
  uploadWorkerImagePair,
} from './ppe-images';
import {
  getOtherImages,
  setOtherImagesDriveDeleterMock,
  setOtherImagesDriveUploaderMock,
  setOtherImagesSupabaseOverride,
  uploadOtherImages,
} from './other-images';
import type {
  GetSubmissionImagesResult,
  OtherPhotoInput,
  RetryFailedUploadsInput,
  SubmissionImageValidationIssue,
  SubmissionUploadProgress,
  SubmissionWorkerImages,
  SubmissionWorkerProgress,
  UploadSubmissionImagesInput,
  UploadSubmissionImagesResult,
  ValidateSubmissionImagesInput,
  ValidateSubmissionImagesResult,
  WorkerImageUploadSummary,
  WorkerPhotoInput,
} from './submission-images.types';

export * from './submission-images.types';

type PPESubmissionRow = Database['public']['Tables']['ppe_submissions']['Row'];

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

export function setSubmissionImagesSupabaseOverride(client: SupabaseClient<Database> | null): void {
  supabaseOverride = client;
  setPpeImagesSupabaseOverride(client);
  setOtherImagesSupabaseOverride(client);
}

export function setSubmissionImagesDriveUploaderMock(
  uploader: ((params: { localUri: string; fileName: string; folderId?: string }) => Promise<{
    fileId: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
  }>) | null
): void {
  injectedDriveUploader = uploader;
  setPpeImagesDriveUploaderMock(uploader);
  setOtherImagesDriveUploaderMock(uploader);
}

export function setSubmissionImagesDriveDeleterMock(
  deleter: ((fileId: string) => Promise<boolean>) | null
): void {
  injectedDriveDeleter = deleter;
  setPpeImagesDriveDeleterMock(deleter);
  setOtherImagesDriveDeleterMock(deleter);
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

// In-memory active progress map for live tracking
const activeProgressMap = new Map<number, SubmissionUploadProgress>();

// ---------------------------------------------------------------------------
// 1. validateSubmissionImages
// ---------------------------------------------------------------------------

/**
 * Validates submission images against schema and domain rules.
 *
 * Domain Rules:
 * 1. Exactly one active FRONT and BACK image per applicable worker instance.
 * 2. Others images remain optional at the storage layer (0 or more allowed).
 * 3. Can validate in-memory pending worker pairs (for preview warnings) or persisted submission rows.
 * 4. Returns structured validation issues with severity ('ERROR' | 'WARNING' | 'INFO').
 */
export async function validateSubmissionImages(
  input: ValidateSubmissionImagesInput,
  client?: SupabaseClient<Database>
): Promise<ValidateSubmissionImagesResult> {
  const errors: SubmissionImageValidationIssue[] = [];
  const warnings: SubmissionImageValidationIssue[] = [];

  let totalWorkers = 0;
  let validWorkers = 0;
  let incompleteWorkers = 0;
  let otherPhotosCount = 0;

  // Mode A: In-memory validation (provided workers array)
  if (input.workers) {
    totalWorkers = input.workers.length;

    if (totalWorkers === 0) {
      errors.push({
        severity: 'ERROR',
        code: 'NO_WORKERS_PROVIDED',
        message: 'At least one worker must be inspected in the submission.',
      });
    }

    for (const worker of input.workers) {
      const hasFront = Boolean(worker.frontLocalUri && worker.frontLocalUri.trim());
      const hasBack = Boolean(worker.backLocalUri && worker.backLocalUri.trim());

      if (!hasFront && !hasBack) {
        incompleteWorkers++;
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_EMPTY_PAIR',
          message: `Worker #${worker.sequenceNo} is missing both FRONT and BACK photos.`,
          sequenceNo: worker.sequenceNo,
          workerInstanceId: worker.workerInstanceId,
        });
      } else if (!hasFront) {
        incompleteWorkers++;
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_FRONT',
          message: `Worker #${worker.sequenceNo} is missing a FRONT inspection photo.`,
          sequenceNo: worker.sequenceNo,
          side: 'FRONT',
          workerInstanceId: worker.workerInstanceId,
        });
      } else if (!hasBack) {
        incompleteWorkers++;
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_BACK',
          message: `Worker #${worker.sequenceNo} is missing a BACK inspection photo.`,
          sequenceNo: worker.sequenceNo,
          side: 'BACK',
          workerInstanceId: worker.workerInstanceId,
        });
      } else {
        validWorkers++;
      }
    }

    // Others images are optional at storage layer
    if (input.otherImages) {
      otherPhotosCount = input.otherImages.length;
      input.otherImages.forEach((img, idx) => {
        const uri = typeof img === 'string' ? img : img.localUri;
        if (!uri || !uri.trim()) {
          warnings.push({
            severity: 'WARNING',
            code: 'INVALID_FILE_URI',
            message: `Optional other photo at index #${idx} has an empty or invalid local URI.`,
            index: idx,
          });
        }
      });
    }

    if (otherPhotosCount === 0) {
      warnings.push({
        severity: 'INFO',
        code: 'OPTIONAL_OTHERS_EMPTY',
        message: 'No optional other evidence photos were provided (optional at storage layer).',
      });
    }

    return {
      isValid: errors.length === 0,
      hasWarnings: warnings.length > 0,
      errors,
      warnings,
      issues: [...errors, ...warnings],
      summary: {
        totalWorkers,
        validWorkers,
        incompleteWorkers,
        otherPhotosCount,
      },
    };
  }

  // Mode B: Persisted submission validation (submissionId provided)
  if (input.submissionId) {
    const images = await getSubmissionImages(input.submissionId, client);
    totalWorkers = images.workers.length;
    otherPhotosCount = images.otherImages.length;

    if (totalWorkers === 0) {
      errors.push({
        severity: 'ERROR',
        code: 'NO_WORKERS_PROVIDED',
        message: `Submission #${input.submissionId} has no worker instances registered.`,
      });
    }

    for (const worker of images.workers) {
      if (!worker.front && !worker.back) {
        incompleteWorkers++;
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_EMPTY_PAIR',
          message: `Worker instance #${worker.workerInstanceId} (Seq #${worker.sequenceNo}) has neither FRONT nor BACK photo.`,
          sequenceNo: worker.sequenceNo,
          workerInstanceId: worker.workerInstanceId,
        });
      } else if (!worker.front) {
        incompleteWorkers++;
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_FRONT',
          message: `Worker instance #${worker.workerInstanceId} (Seq #${worker.sequenceNo}) is missing a FRONT photo.`,
          sequenceNo: worker.sequenceNo,
          side: 'FRONT',
          workerInstanceId: worker.workerInstanceId,
        });
      } else if (!worker.back) {
        incompleteWorkers++;
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_BACK',
          message: `Worker instance #${worker.workerInstanceId} (Seq #${worker.sequenceNo}) is missing a BACK photo.`,
          sequenceNo: worker.sequenceNo,
          side: 'BACK',
          workerInstanceId: worker.workerInstanceId,
        });
      } else {
        validWorkers++;
      }
    }

    if (otherPhotosCount === 0) {
      warnings.push({
        severity: 'INFO',
        code: 'OPTIONAL_OTHERS_EMPTY',
        message: 'No optional other evidence photos stored (optional at storage layer).',
      });
    }

    return {
      isValid: errors.length === 0,
      hasWarnings: warnings.length > 0,
      errors,
      warnings,
      issues: [...errors, ...warnings],
      summary: {
        totalWorkers,
        validWorkers,
        incompleteWorkers,
        otherPhotosCount,
      },
    };
  }

  throw new StorageError(
    StorageErrorCode.INVALID_INPUT,
    'validateSubmissionImages requires either workers array or submissionId.'
  );
}

// ---------------------------------------------------------------------------
// 2. getSubmissionImages
// ---------------------------------------------------------------------------

/**
 * Retrieves all photos for a submission: all worker instances with FRONT and BACK images,
 * and all Others evidence photos with file metadata.
 */
export async function getSubmissionImages(
  submissionId: number,
  client?: SupabaseClient<Database>
): Promise<GetSubmissionImagesResult> {
  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  // 1. Fetch submission record
  const { data: sub, error: subErr } = await db
    .from('ppe_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();

  if (subErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error fetching submission #${submissionId}: ${subErr.message}`,
      { details: subErr }
    );
  }

  if (!sub) {
    throw new StorageError(
      StorageErrorCode.FILE_NOT_FOUND,
      `Submission #${submissionId} not found.`
    );
  }

  // 2. Fetch all worker instances for this submission
  const { data: workerInstances, error: workersErr } = await db
    .from('ppe_worker_instances')
    .select('*')
    .eq('submission_id', submissionId)
    .order('sequence_no', { ascending: true });

  if (workersErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Error fetching worker instances for submission #${submissionId}: ${workersErr.message}`,
      { details: workersErr }
    );
  }

  const workersList = workerInstances || [];
  const workerResults: SubmissionWorkerImages[] = [];
  let completeWorkers = 0;
  let incompleteWorkers = 0;
  let totalPPEPhotos = 0;

  for (const worker of workersList) {
    const images = await getWorkerImages(worker.id, db);
    const isComplete = Boolean(images.front && images.back);

    if (isComplete) {
      completeWorkers++;
    } else {
      incompleteWorkers++;
    }

    if (images.front) totalPPEPhotos++;
    if (images.back) totalPPEPhotos++;

    workerResults.push({
      workerInstanceId: worker.id,
      sequenceNo: worker.sequence_no,
      front: images.front,
      back: images.back,
      isComplete,
    });
  }

  // 3. Fetch all Others images for this submission
  const otherImages = await getOtherImages(submissionId, db);

  const isFullyPersisted = workersList.length > 0 && incompleteWorkers === 0;

  return {
    submissionId,
    siteName: sub.site_name,
    status: sub.status as SubmissionStatus,
    workers: workerResults,
    otherImages,
    summary: {
      totalWorkers: workersList.length,
      completeWorkers,
      incompleteWorkers,
      totalPPEPhotos,
      totalOtherPhotos: otherImages.length,
      isFullyPersisted,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. uploadSubmissionImages
// ---------------------------------------------------------------------------

/**
 * High-level coordinator for uploading and persisting all photos in a submission:
 * - Worker FRONT/BACK inspection photos.
 * - Optional Others evidence photos.
 * - Google Drive uploads and Supabase metadata persistence.
 * - Enforces exactly one active FRONT and BACK image per worker.
 * - Handles partial failure gracefully without data loss.
 * - DOES NOT mark submission complete if any required worker photo or relation is missing/failed.
 */
export async function uploadSubmissionImages(
  input: UploadSubmissionImagesInput,
  client?: SupabaseClient<Database>
): Promise<UploadSubmissionImagesResult> {
  const {
    submissionId,
    workers = [],
    otherImages = [],
    userId,
    siteName,
    folderId,
    markCompleteOnSuccess = false,
    targetSubmissionStatus = 'SUBMITTED',
    onProgress,
  } = input;

  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  const db = getDb(client);

  // 1. Verify submission existence and retrieve site name
  const { data: sub, error: subErr } = await db
    .from('ppe_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();

  if (subErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error verifying submission #${submissionId}: ${subErr.message}`,
      { details: subErr }
    );
  }

  if (!sub) {
    throw new StorageError(
      StorageErrorCode.FILE_NOT_FOUND,
      `Submission #${submissionId} not found.`
    );
  }

  const effectiveSiteName = siteName || sub.site_name || 'PPEye_Site';

  // 2. Initialize progress tracking
  const totalPhotos = workers.length * 2 + otherImages.length;
  let completedPhotos = 0;
  const workerProgressList: SubmissionWorkerProgress[] = workers.map((w) => ({
    sequenceNo: w.sequenceNo,
    frontStatus: w.frontLocalUri ? 'pending' : 'skipped',
    backStatus: w.backLocalUri ? 'pending' : 'skipped',
  }));

  const updateProgress = (
    stage: SubmissionUploadProgress['stage'],
    state: SubmissionUploadProgress['state']
  ) => {
    const percent = totalPhotos > 0 ? Math.round((completedPhotos / totalPhotos) * 100) : 100;
    const progress: SubmissionUploadProgress = {
      submissionId,
      state,
      stage,
      percent,
      completedPhotos,
      totalPhotos,
      workers: workerProgressList,
    };
    activeProgressMap.set(submissionId, progress);
    if (onProgress) {
      try {
        onProgress(progress);
      } catch {}
    }
  };

  updateProgress('validating', 'UPLOADING');

  const errors: SubmissionImageValidationIssue[] = [];
  const workerSummaries: WorkerImageUploadSummary[] = [];

  // Check empty worker list
  if (workers.length === 0) {
    errors.push({
      severity: 'ERROR',
      code: 'NO_WORKERS_PROVIDED',
      message: 'No workers provided for submission upload.',
    });
  }

  // 3. Upload Worker Photo Pairs
  updateProgress('uploading_workers', 'UPLOADING');

  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];
    const wp = workerProgressList[i];

    try {
      // Ensure worker instance exists
      let workerInstanceId = worker.workerInstanceId;
      if (!workerInstanceId) {
        const instance = await getOrCreateWorkerInstance(submissionId, worker.sequenceNo, db);
        workerInstanceId = instance.id;
      }

      if (worker.frontLocalUri) wp.frontStatus = 'uploading';
      if (worker.backLocalUri) wp.backStatus = 'uploading';
      updateProgress('uploading_workers', 'UPLOADING');

      // Upload paired FRONT and BACK
      const pairResult = await uploadWorkerImagePair(
        {
          workerInstanceId,
          frontLocalUri: worker.frontLocalUri ?? undefined,
          backLocalUri: worker.backLocalUri ?? undefined,
          siteName: effectiveSiteName,
          workerSequenceNo: worker.sequenceNo,
          userId,
          folderId,
          throwOnPartialFailure: false,
        },
        db
      );

      if (pairResult.front) {
        wp.frontStatus = 'success';
        completedPhotos++;
      } else if (worker.frontLocalUri) {
        wp.frontStatus = 'failed';
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_FRONT',
          message: `Worker #${worker.sequenceNo} FRONT photo failed to upload: ${pairResult.errors?.front?.message ?? 'Unknown error'}`,
          sequenceNo: worker.sequenceNo,
          side: 'FRONT',
          workerInstanceId,
        });
      } else {
        wp.frontStatus = 'skipped';
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_FRONT',
          message: `Worker #${worker.sequenceNo} is missing a FRONT photo.`,
          sequenceNo: worker.sequenceNo,
          side: 'FRONT',
          workerInstanceId,
        });
      }

      if (pairResult.back) {
        wp.backStatus = 'success';
        completedPhotos++;
      } else if (worker.backLocalUri) {
        wp.backStatus = 'failed';
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_BACK',
          message: `Worker #${worker.sequenceNo} BACK photo failed to upload: ${pairResult.errors?.back?.message ?? 'Unknown error'}`,
          sequenceNo: worker.sequenceNo,
          side: 'BACK',
          workerInstanceId,
        });
      } else {
        wp.backStatus = 'skipped';
        errors.push({
          severity: 'ERROR',
          code: 'WORKER_MISSING_BACK',
          message: `Worker #${worker.sequenceNo} is missing a BACK photo.`,
          sequenceNo: worker.sequenceNo,
          side: 'BACK',
          workerInstanceId,
        });
      }

      const isWorkerComplete = Boolean(pairResult.front && pairResult.back);
      workerSummaries.push({
        workerInstanceId,
        sequenceNo: worker.sequenceNo,
        front: pairResult.front,
        back: pairResult.back,
        isComplete: isWorkerComplete,
        error: pairResult.errors?.front?.message || pairResult.errors?.back?.message,
      });
    } catch (err: any) {
      wp.frontStatus = 'failed';
      wp.backStatus = 'failed';
      errors.push({
        severity: 'ERROR',
        code: 'UPLOAD_PARTIAL_FAILURE',
        message: `Worker #${worker.sequenceNo} pair upload encountered an unexpected error: ${err?.message ?? err}`,
        sequenceNo: worker.sequenceNo,
        workerInstanceId: worker.workerInstanceId,
      });
      workerSummaries.push({
        workerInstanceId: worker.workerInstanceId ?? 0,
        sequenceNo: worker.sequenceNo,
        front: null,
        back: null,
        isComplete: false,
        error: err?.message ?? 'Unexpected error',
      });
    }

    updateProgress('uploading_workers', 'UPLOADING');
  }

  // 4. Upload Others Evidence Photos (Optional at storage layer)
  updateProgress('uploading_others', 'UPLOADING');
  let storedOthers: any[] = [];

  if (otherImages.length > 0) {
    const formattedOthers: OtherPhotoInput[] = otherImages.map((img, idx) => {
      if (typeof img === 'string') {
        return { localUri: img, sequenceNo: idx + 1 };
      }
      return { localUri: img.localUri, sequenceNo: img.sequenceNo ?? idx + 1 };
    });

    try {
      const batchResult = await uploadOtherImages(
        {
          submissionId,
          images: formattedOthers,
          userId,
          folderId,
          throwOnPartialFailure: false,
        },
        db
      );

      storedOthers = batchResult.images;
      completedPhotos += storedOthers.length;

      if (batchResult.errors) {
        for (const err of batchResult.errors) {
          errors.push({
            severity: 'WARNING',
            code: 'UPLOAD_PARTIAL_FAILURE',
            message: `Other image #${err.index} failed to upload: ${err.error.message}`,
            index: err.index,
          });
        }
      }
    } catch (err: any) {
      errors.push({
        severity: 'WARNING',
        code: 'UPLOAD_PARTIAL_FAILURE',
        message: `Others evidence batch upload encountered an error: ${err?.message ?? err}`,
      });
    }
  }

  updateProgress('persisting_relations', 'PERSISTING');

  // 5. Completion Check: Exactly one active FRONT and BACK per worker
  const allWorkersComplete =
    workerSummaries.length > 0 && workerSummaries.every((w) => w.isComplete);
  const noFatalErrors = errors.filter((e) => e.severity === 'ERROR').length === 0;
  const isComplete = allWorkersComplete && noFatalErrors;

  let submissionStatusUpdated = false;
  let newStatus: SubmissionStatus | undefined;

  // IMPORTANT: Do NOT mark submission complete until all required files and relationships are persisted!
  if (isComplete && markCompleteOnSuccess) {
    try {
      const now = new Date().toISOString();
      const { data: updatedSub, error: updateErr } = await db
        .from('ppe_submissions')
        .update({
          status: targetSubmissionStatus,
          submitted_at: now,
          completed_at: now,
          updated_at: now,
        })
        .eq('id', submissionId)
        .select()
        .single();

      if (!updateErr && updatedSub) {
        submissionStatusUpdated = true;
        newStatus = updatedSub.status as SubmissionStatus;
      }
    } catch (err) {
      console.warn(`[SubmissionImages] Error marking submission #${submissionId} complete:`, err);
    }
  }

  const finalState = isComplete ? 'COMPLETED' : 'PARTIAL_SUCCESS';
  const finalStage = isComplete ? 'completed' : 'failed';
  updateProgress(finalStage, finalState);

  const totalPhotosUploaded =
    workerSummaries.reduce(
      (sum, w) => sum + (w.front ? 1 : 0) + (w.back ? 1 : 0),
      0
    ) + storedOthers.length;

  const failedPhotosCount = totalPhotos - totalPhotosUploaded;

  return {
    submissionId,
    isComplete,
    submissionStatusUpdated,
    newStatus,
    workers: workerSummaries,
    otherImages: storedOthers,
    errors,
    totalPhotosUploaded,
    failedPhotosCount: Math.max(0, failedPhotosCount),
  };
}

// ---------------------------------------------------------------------------
// 4. retryFailedUploads
// ---------------------------------------------------------------------------

/**
 * Retries missing or failed uploads for a submission.
 * - Inspects existing stored images in Supabase and Google Drive.
 * - Only uploads the missing sides or failed items, avoiding duplicate uploads of already persisted files.
 * - Marks submission complete if all required files and relationships are successfully persisted.
 */
export async function retryFailedUploads(
  input: RetryFailedUploadsInput,
  client?: SupabaseClient<Database>
): Promise<UploadSubmissionImagesResult> {
  const {
    submissionId,
    workers = [],
    otherImages = [],
    userId,
    siteName,
    folderId,
    markCompleteOnSuccess = false,
    targetSubmissionStatus = 'SUBMITTED',
    onProgress,
  } = input;

  const db = getDb(client);

  // 1. Fetch current persisted images for this submission
  const currentImages = await getSubmissionImages(submissionId, db);

  // 2. Identify missing worker photos
  const workersToUpload: WorkerPhotoInput[] = [];

  for (const w of workers) {
    const existing = currentImages.workers.find(
      (cw) => cw.sequenceNo === w.sequenceNo || cw.workerInstanceId === w.workerInstanceId
    );

    const needsFront = !existing?.front && Boolean(w.frontLocalUri);
    const needsBack = !existing?.back && Boolean(w.backLocalUri);

    if (needsFront || needsBack) {
      workersToUpload.push({
        workerInstanceId: existing?.workerInstanceId ?? w.workerInstanceId,
        sequenceNo: w.sequenceNo,
        frontLocalUri: needsFront ? w.frontLocalUri : null,
        backLocalUri: needsBack ? w.backLocalUri : null,
      });
    } else {
      // Already complete in DB, preserve in upload list so summary includes it
      workersToUpload.push({
        workerInstanceId: existing?.workerInstanceId ?? w.workerInstanceId,
        sequenceNo: w.sequenceNo,
        frontLocalUri: null,
        backLocalUri: null,
      });
    }
  }

  // 3. Identify missing Others images (compare by sequence number or count)
  const existingOtherCount = currentImages.otherImages.length;
  const othersToUpload = otherImages.slice(existingOtherCount);

  // 4. Execute upload for the delta
  return uploadSubmissionImages(
    {
      submissionId,
      workers: workersToUpload,
      otherImages: othersToUpload,
      userId,
      siteName: siteName || currentImages.siteName,
      folderId,
      markCompleteOnSuccess,
      targetSubmissionStatus,
      onProgress,
    },
    db
  );
}

// ---------------------------------------------------------------------------
// 5. getUploadProgress
// ---------------------------------------------------------------------------

/**
 * Retrieves the current upload progress of a submission.
 * If currently in-flight, returns live memory state; otherwise computes status from persisted database records.
 */
export async function getUploadProgress(
  submissionId: number,
  client?: SupabaseClient<Database>
): Promise<SubmissionUploadProgress> {
  if (!submissionId || submissionId <= 0 || !Number.isInteger(submissionId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid submissionId: ${submissionId}. Must be a positive integer.`
    );
  }

  const active = activeProgressMap.get(submissionId);
  if (active) {
    return active;
  }

  const current = await getSubmissionImages(submissionId, client);
  const totalPhotos = current.workers.length * 2 + current.otherImages.length;
  const completedPhotos = current.summary.totalPPEPhotos + current.summary.totalOtherPhotos;
  const percent = totalPhotos > 0 ? Math.round((completedPhotos / totalPhotos) * 100) : 100;
  const state = current.summary.isFullyPersisted ? 'COMPLETED' : 'PARTIAL_SUCCESS';
  const stage = current.summary.isFullyPersisted ? 'completed' : 'idle';

  return {
    submissionId,
    state,
    stage,
    percent,
    completedPhotos,
    totalPhotos,
    workers: current.workers.map((w) => ({
      sequenceNo: w.sequenceNo,
      frontStatus: w.front ? 'success' : 'failed',
      backStatus: w.back ? 'success' : 'failed',
    })),
  };
}
