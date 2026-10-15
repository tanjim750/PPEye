import type { ImageSide, StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';

export interface PPEImageFileInfo {
  id: number;
  storageProvider: StorageProvider;
  providerFileId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdBy: number | null;
  createdAt: string;
}

export interface StoredPPEImage {
  id: number;
  workerInstanceId: number;
  fileId: number;
  side: ImageSide;
  createdAt: string;
  file: PPEImageFileInfo;
}

export interface UploadPPEImageInput {
  workerInstanceId: number;
  side: ImageSide;
  localUri: string;
  siteName?: string;
  workerSequenceNo?: number;
  userId?: number;
  folderId?: string;
  /**
   * If an active image already exists for this (workerInstanceId, side):
   * - If true: delegates to replacePPEImage.
   * - If false (default): prevents duplicate and returns existing active image or throws if different URI.
   */
  overwrite?: boolean;
}

export interface UploadWorkerImagePairInput {
  workerInstanceId: number;
  frontLocalUri?: string | null;
  backLocalUri?: string | null;
  siteName?: string;
  workerSequenceNo?: number;
  userId?: number;
  folderId?: string;
  /**
   * If true, throws PartialUploadError when either front or back upload fails.
   * If false, returns WorkerImagePairResult with errors populated and success: false.
   * Default: false.
   */
  throwOnPartialFailure?: boolean;
}

export interface WorkerImagePairResult {
  workerInstanceId: number;
  front: StoredPPEImage | null;
  back: StoredPPEImage | null;
  success: boolean;
  errors?: {
    front?: StorageError;
    back?: StorageError;
  };
}

export interface GetWorkerImagesResult {
  workerInstanceId: number;
  front: StoredPPEImage | null;
  back: StoredPPEImage | null;
  all: StoredPPEImage[];
}

export interface ReplacePPEImageInput {
  workerInstanceId: number;
  side: ImageSide;
  newLocalUri: string;
  siteName?: string;
  workerSequenceNo?: number;
  userId?: number;
  folderId?: string;
  /**
   * Whether to retain the replaced file record and remote storage file as historical evidence.
   * If not specified, defaults to true if a review exists for this worker, or true by default
   * to ensure an audit trail.
   */
  retainHistoricalEvidence?: boolean;
}

export class PartialUploadError extends StorageError {
  public readonly partialResult: WorkerImagePairResult;

  constructor(message: string, partialResult: WorkerImagePairResult, cause?: unknown) {
    super(StorageErrorCode.UPLOAD_FAILED, message, { cause });
    this.name = 'PartialUploadError';
    this.partialResult = partialResult;
    Object.setPrototypeOf(this, PartialUploadError.prototype);
  }
}

export function isPartialUploadError(error: unknown): error is PartialUploadError {
  return error instanceof PartialUploadError || (error instanceof Error && error.name === 'PartialUploadError');
}

