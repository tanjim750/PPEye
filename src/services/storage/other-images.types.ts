import type { StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';

export interface OtherImageFileInfo {
  id: number;
  storageProvider: StorageProvider;
  providerFileId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdBy: number | null;
  createdAt: string;
}

export interface StoredOtherImage {
  id: number;
  submissionId: number;
  fileId: number;
  sequenceNo: number | null;
  createdAt: string;
  file: OtherImageFileInfo;
}

export interface UploadOtherImageInput {
  submissionId: number;
  localUri: string;
  sequenceNo?: number;
  siteName?: string;
  userId?: number;
  folderId?: string;
}

export interface UploadOtherImagesItem {
  localUri: string;
  sequenceNo?: number;
}

export interface UploadOtherImagesInput {
  submissionId: number;
  images: Array<UploadOtherImagesItem | string>;
  siteName?: string;
  userId?: number;
  folderId?: string;
  /**
   * If true, throws PartialOtherUploadError when any image fails to upload.
   * If false (default), returns BatchOtherImagesResult containing succeeded images and error array.
   */
  throwOnPartialFailure?: boolean;
}

export interface OtherImageUploadErrorDetail {
  index: number;
  localUri: string;
  error: StorageError;
}

export interface BatchOtherImagesResult {
  submissionId: number;
  images: StoredOtherImage[];
  newlyUploaded: StoredOtherImage[];
  errors?: OtherImageUploadErrorDetail[];
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
}

export interface RemoveOtherImageOptions {
  userId?: number;
  /**
   * If true, bypasses the audit check for reviewed submissions.
   */
  force?: boolean;
}

export class PartialOtherUploadError extends StorageError {
  public readonly partialResult: BatchOtherImagesResult;

  constructor(message: string, partialResult: BatchOtherImagesResult, cause?: unknown) {
    super(StorageErrorCode.UPLOAD_FAILED, message, { cause });
    this.name = 'PartialOtherUploadError';
    this.partialResult = partialResult;
    Object.setPrototypeOf(this, PartialOtherUploadError.prototype);
  }
}

export function isPartialOtherUploadError(error: unknown): error is PartialOtherUploadError {
  return (
    error instanceof PartialOtherUploadError ||
    (error instanceof Error && error.name === 'PartialOtherUploadError')
  );
}
