import type { StorageProvider } from './storage.types';

export const StorageErrorCode = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type StorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode];

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly provider: StorageProvider;
  readonly details?: unknown;

  constructor(
    code: StorageErrorCode,
    message: string,
    options?: {
      provider?: StorageProvider;
      cause?: unknown;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.provider = options?.provider ?? 'GOOGLE_DRIVE';
    this.details = options?.details ?? options?.cause;

    // Maintain proper prototype chain for instanceof
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
