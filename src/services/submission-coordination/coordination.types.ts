/**
 * PPEye Submission Coordination Layer — Types & Interfaces
 *
 * Defines domain types, input payloads, structured results, and error models for
 * coordinating image compression, Supabase Storage uploads, database metadata persistence,
 * relational entity-file linking, and compensating cleanup.
 */

import type { ImageSide } from '../database/database.types';

export type CoordinationStatus =
  | 'COMPLETE_SUCCESS'
  | 'FAILURE_WITH_COMPENSATION'
  | 'FAILURE_INCOMPLETE_COMPENSATION'
  | 'PARTIAL_SUCCESS'
  | 'AMBIGUOUS_OUTCOME'
  | 'REPLACEMENT_SUCCESS_CLEANUP_DEFERRED';

export interface CompensationError {
  stage: string;
  error: Error;
}

export interface CoordinationResult<T> {
  status: CoordinationStatus;
  data?: T;
  error?: Error;
  compensationErrors?: CompensationError[];
  stageFailed?: string;
  warnings?: string[];
}

export interface SubmitWorkerEvidenceInput {
  submissionId: number;
  workerInstanceId: number;
  workerSequenceNo: number;
  frontLocalUri: string;
  backLocalUri: string;
  userId?: number;
}

export interface WorkerPhotoResult {
  fileId: number;
  storagePath: string;
  ppeImageId: number;
}

export interface WorkerEvidenceResult {
  submissionId: number;
  workerInstanceId: number;
  front: WorkerPhotoResult;
  back: WorkerPhotoResult;
}

export interface SubmitOtherEvidenceInput {
  submissionId: number;
  sequenceNo: number;
  localUri: string;
  userId?: number;
}

export interface OtherEvidenceResult {
  submissionId: number;
  fileId: number;
  storagePath: string;
  otherImageId: number;
}

export interface UploadAvatarInput {
  userId: number;
  localUri: string;
  cleanOldAvatar?: boolean;
}

export interface DeferredCleanupInfo {
  fileId: number;
  storagePath?: string;
  reason: string;
}

export interface AvatarUploadResult {
  userId: number;
  fileId: number;
  storagePath: string;
  oldFileCleaned?: boolean;
  deferredCleanup?: DeferredCleanupInfo;
}

export interface ReplaceWorkerEvidenceInput {
  submissionId: number;
  workerInstanceId: number;
  workerSequenceNo: number;
  side: ImageSide;
  localUri: string;
  userId?: number;
  cleanOldImage?: boolean;
}

export interface ReplaceWorkerEvidenceResult {
  submissionId: number;
  workerInstanceId: number;
  side: ImageSide;
  newFileId: number;
  newStoragePath: string;
  ppeImageId: number;
  oldFileCleaned?: boolean;
  deferredCleanup?: DeferredCleanupInfo;
}
