/**
 * PPEye Supabase Storage Service — Types & Interfaces
 *
 * Defines pure binary object storage abstractions for Supabase Storage buckets.
 * Independent of database tables, submissions, or Google Drive.
 */

export type StorageBucket = 'evidence' | 'avatars';

export type AllowedStorageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface StorageUploadInput {
  bucket: StorageBucket;
  storagePath: string;
  localUri?: string;
  fileBody?: Blob | ArrayBuffer | Uint8Array | string;
  mimeType?: AllowedStorageMimeType;
  sizeBytes?: number;
  contentHash?: string; // SHA-256 / MD5 content checksum for collision identity verification
  uploadAttemptId?: string; // Unique client upload attempt identifier
  upsert?: boolean;
}

export interface StorageUploadResult {
  bucket: StorageBucket;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  etag?: string;
}

export interface StorageSignedUrlResult {
  signedUrl: string;
  expiresAt: number;
}

export interface StorageBatchUploadResult {
  results: StorageUploadResult[];
  errors: Array<{ input: StorageUploadInput; error: Error }>;
  isFullSuccess: boolean;
  succeededPaths: string[];
}

export interface StorageObjectMetadata {
  name: string;
  sizeBytes: number;
  mimeType?: string;
  updatedAt?: string;
  etag?: string;
}

export interface StorageBatchDeleteResult {
  deleted: string[];
  failed: Array<{ path: string; error: string }>;
}

export interface ISupabaseStorageService {
  uploadFile(input: StorageUploadInput): Promise<StorageUploadResult>;
  uploadBatch(
    inputs: StorageUploadInput[],
    options?: { concurrency?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<StorageBatchUploadResult>;
  createSignedUrl(
    bucket: StorageBucket,
    storagePath: string,
    expiresInSeconds?: number
  ): Promise<StorageSignedUrlResult>;
  downloadFile(
    bucket: StorageBucket,
    storagePath: string,
    targetLocalUri?: string
  ): Promise<{ localUri: string; sizeBytes: number }>;
  deleteFile(bucket: StorageBucket, storagePath: string): Promise<boolean>;
  deleteBatch(bucket: StorageBucket, storagePaths: string[]): Promise<StorageBatchDeleteResult>;
  fileExists(
    bucket: StorageBucket,
    storagePath: string,
    options?: { expectedSizeBytes?: number; toleranceBytes?: number }
  ): Promise<boolean>;
  getObjectMetadata(bucket: StorageBucket, storagePath: string): Promise<StorageObjectMetadata | null>;
}
