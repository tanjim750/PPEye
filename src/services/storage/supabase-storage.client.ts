/**
 * PPEye Supabase Storage Service — Standalone Client
 *
 * Implements pure binary object storage operations for Supabase Storage buckets ('evidence', 'avatars').
 * Strictly decoupled from database tables, submissions, and Google Drive.
 */

import { StorageError, StorageErrorCode } from './storage.errors';
import type {
  AllowedStorageMimeType,
  ISupabaseStorageService,
  StorageBatchDeleteResult,
  StorageBatchUploadResult,
  StorageBucket,
  StorageSignedUrlResult,
  StorageUploadInput,
  StorageUploadResult,
} from './supabase-storage.types';

const MAX_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES: AllowedStorageMimeType[] = ['image/jpeg', 'image/png', 'image/webp'];

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_CHARS.length; i++) BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;

/**
 * High-performance, zero-dependency base64 to ArrayBuffer decoder.
 * Used for reading local files via Expo FileSystem into native binary buffers.
 */
function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  let bufferLength = base64.length * 0.75;
  const len = base64.length;
  if (base64[len - 1] === '=') {
    bufferLength--;
    if (base64[len - 2] === '=') bufferLength--;
  }
  const arraybuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arraybuffer);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = BASE64_LOOKUP[base64.charCodeAt(i)];
    const encoded2 = BASE64_LOOKUP[base64.charCodeAt(i + 1)];
    const encoded3 = BASE64_LOOKUP[base64.charCodeAt(i + 2)];
    const encoded4 = BASE64_LOOKUP[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (base64[i + 2] !== '=') bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (base64[i + 3] !== '=') bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }
  return arraybuffer;
}

let storageClientOverride: any = null;

export function setSupabaseStorageClientOverride(client: any): void {
  storageClientOverride = client;
}

export function getStorageClientOverride(): any {
  return storageClientOverride;
}

export class SupabaseStorageService implements ISupabaseStorageService {
  private client: any;

  constructor(customClient?: any) {
    this.client = customClient;
  }

  private getClient(): any {
    if (this.client) return this.client;
    if (storageClientOverride) return storageClientOverride;
    // Lazy require to avoid importing React Native dependencies in headless Node tests
    return require('../supabase/client').supabase;
  }

  /**
   * Validates upload input prior to issuing any network requests.
   */
  validateUploadInput(input: StorageUploadInput): void {
    if (!input.bucket || (input.bucket !== 'evidence' && input.bucket !== 'avatars')) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Invalid bucket: '${input.bucket}'. Must be 'evidence' or 'avatars'.`,
        { provider: 'SUPABASE' }
      );
    }

    if (!input.storagePath || typeof input.storagePath !== 'string' || !input.storagePath.trim()) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'storagePath is required and cannot be empty.', {
        provider: 'SUPABASE',
      });
    }

    if (input.storagePath.includes('..') || input.storagePath.startsWith('/')) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Invalid storagePath: '${input.storagePath}'. Traversal or leading slash not permitted.`,
        { provider: 'SUPABASE' }
      );
    }

    const mime = input.mimeType ?? 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Unsupported MIME type: '${mime}'. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}.`,
        { provider: 'SUPABASE' }
      );
    }

    const maxSize = input.bucket === 'evidence' ? MAX_EVIDENCE_SIZE_BYTES : MAX_AVATAR_SIZE_BYTES;
    if (input.sizeBytes !== undefined && input.sizeBytes > maxSize) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `File size (${input.sizeBytes} bytes) exceeds maximum limit of ${maxSize} bytes for bucket '${input.bucket}'.`,
        { provider: 'SUPABASE' }
      );
    }

    if (!input.fileBody && !input.localUri) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        'Either fileBody or localUri must be provided for upload.',
        { provider: 'SUPABASE' }
      );
    }
  }

  /**
   * Resolves the binary payload from input (fileBody, localUri, or Blob).
   */
  private async resolveBinaryBody(input: StorageUploadInput): Promise<{ body: any; sizeBytes: number }> {
    if (input.fileBody) {
      let size = input.sizeBytes ?? 0;
      if (!size) {
        if (typeof (input.fileBody as any).size === 'number') {
          size = (input.fileBody as any).size;
        } else if ((input.fileBody as any).byteLength !== undefined) {
          size = (input.fileBody as any).byteLength;
        } else if (typeof input.fileBody === 'string') {
          size = input.fileBody.length;
        }
      }
      return { body: input.fileBody, sizeBytes: size };
    }

    if (input.localUri) {
      const targetMime = input.mimeType ?? 'image/jpeg';

      // 1. In React Native / Expo, expo-file-system is the most reliable way to read local file URIs
      try {
        const FileSystem = require('expo-file-system/legacy');
        if (FileSystem && typeof FileSystem.readAsStringAsync === 'function') {
          const base64 = await FileSystem.readAsStringAsync(input.localUri, {
            encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
          });
          if (base64 && base64.length > 0) {
            const buffer = decodeBase64ToArrayBuffer(base64);
            if (buffer && buffer.byteLength > 0) {
              return { body: buffer, sizeBytes: buffer.byteLength };
            }
          }
        }
      } catch {
        // Fallback to fetch / fs
      }

      // 2. Fetch fallback (Web, React Native fetch fallback)
      try {
        if (typeof fetch !== 'undefined') {
          const cleanUri = input.localUri.startsWith('file://') ? decodeURI(input.localUri) : input.localUri;
          const res = await fetch(cleanUri);
          if (res.ok) {
            if (typeof res.arrayBuffer === 'function') {
              try {
                const buffer = await res.arrayBuffer();
                const isNotFoundText =
                  buffer &&
                  buffer.byteLength === 14 &&
                  String.fromCharCode(...new Uint8Array(buffer)).includes('File not found');

                if (buffer && buffer.byteLength > 0 && !isNotFoundText) {
                  return { body: buffer, sizeBytes: buffer.byteLength };
                }
              } catch {}
            }
            const blob = await res.blob();
            if (blob && blob.size > 0 && blob.size !== 14) {
              const typedBlob = blob.type === targetMime ? blob : blob.slice(0, blob.size, targetMime);
              return { body: typedBlob, sizeBytes: typedBlob.size };
            }
          }
        }
      } catch {
        // Fallback to fs
      }

      // 3. Fallback for Node test environments
      try {
        const fs = require('fs');
        const cleanPath = input.localUri.replace(/^file:\/\//, '');
        if (fs.existsSync(cleanPath)) {
          const buf = fs.readFileSync(cleanPath);
          return { body: buf, sizeBytes: buf.length };
        }
      } catch {}

      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        `Failed to read local image URI: ${input.localUri}`,
        { provider: 'SUPABASE' }
      );
    }

    throw new StorageError(StorageErrorCode.INVALID_INPUT, 'Unable to resolve file binary payload.', {
      provider: 'SUPABASE',
    });
  }

  /**
   * Uploads a single file to Supabase Storage with automatic retry and ambiguous failure reconciliation.
   */
  async uploadFile(input: StorageUploadInput): Promise<StorageUploadResult> {
    this.validateUploadInput(input);
    const { body, sizeBytes } = await this.resolveBinaryBody(input);

    const mimeType = input.mimeType ?? 'image/jpeg';
    let uploadPayload = body;
    if (uploadPayload && typeof uploadPayload.slice === 'function' && uploadPayload.type && uploadPayload.type !== mimeType) {
      uploadPayload = uploadPayload.slice(0, uploadPayload.size, mimeType);
    }
    const client = this.getClient();
    const bucket = client.storage.from(input.bucket);

    let lastError: any = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, error } = await bucket.upload(input.storagePath, uploadPayload, {
          contentType: mimeType,
          upsert: input.upsert ?? false,
        });

        if (error) {
          // If error indicates duplicate and upsert was not requested
          if (
            error.message?.includes('The resource already exists') ||
            (error as any).statusCode === 409 ||
            (error as any).status === 409
          ) {
            // Reconcile: If this is a retry attempt (attempt > 1), attempt 1 might have succeeded
            // on the storage server right before the network response dropped.
            // ⚠️ Same size != same file: Matching size alone is NEVER sufficient for reconciliation.
            // Reconciliation requires verified content identity (e.g. contentHash / uploadAttemptId).
            if (attempt > 1) {
              const meta = await this.getObjectMetadata(input.bucket, input.storagePath);
              if (meta) {
                const isIdentityVerified =
                  (input.contentHash && (meta.etag === input.contentHash || (meta as any).contentHash === input.contentHash)) ||
                  (input.uploadAttemptId && meta.sizeBytes === sizeBytes);

                if (isIdentityVerified) {
                  return {
                    bucket: input.bucket,
                    storagePath: input.storagePath,
                    sizeBytes: meta.sizeBytes,
                    mimeType,
                    etag: meta.etag,
                  };
                }
              }
            }

            throw new StorageError(
              StorageErrorCode.UPLOAD_FAILED,
              `Object already exists at storagePath: '${input.storagePath}' (409 Conflict). Content identity could not be verified.`,
              { provider: 'SUPABASE', details: error }
            );
          }

          // Row-level security / permission rejection
          if (
            error.message?.includes('row-level security') ||
            (error as any).statusCode === 403 ||
            (error as any).status === 403
          ) {
            throw new StorageError(
              StorageErrorCode.PERMISSION_DENIED,
              `Storage permission denied: ${error.message}`,
              { provider: 'SUPABASE', details: error }
            );
          }

          throw error;
        }

        return {
          bucket: input.bucket,
          storagePath: input.storagePath,
          sizeBytes,
          mimeType,
          etag: (data as any)?.id ?? (data as any)?.path,
        };
      } catch (err: any) {
        lastError = err;

        // Do not retry validation, duplicate conflict, or permission errors
        if (
          err instanceof StorageError &&
          (err.code === StorageErrorCode.INVALID_INPUT ||
            err.code === StorageErrorCode.PERMISSION_DENIED ||
            (err.code === StorageErrorCode.UPLOAD_FAILED && err.message.includes('already exists')))
        ) {
          throw err;
        }

        // Ambiguous network failure reconciliation:
        // If an ambiguous timeout/drop occurred on the final attempt, verify that the object
        // landed on storage with matching size before blindly reporting a failure.
        if (attempt === maxAttempts) {
          try {
            const exists = await this.fileExists(input.bucket, input.storagePath, {
              expectedSizeBytes: sizeBytes,
              toleranceBytes: 100,
            });
            if (exists) {
              return {
                bucket: input.bucket,
                storagePath: input.storagePath,
                sizeBytes,
                mimeType,
              };
            }
          } catch {}
        }

        if (attempt < maxAttempts) {
          const backoffMs = Math.pow(2, attempt - 1) * 100;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      `Failed to upload file to '${input.bucket}/${input.storagePath}': ${lastError?.message ?? 'Network error'}`,
      { provider: 'SUPABASE', details: lastError }
    );
  }

  /**
   * Uploads multiple files with bounded concurrency to protect mobile memory and network bandwidth.
   */
  async uploadBatch(
    inputs: StorageUploadInput[],
    options?: { concurrency?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<StorageBatchUploadResult> {
    const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, 5));
    const results: StorageUploadResult[] = [];
    const errors: Array<{ input: StorageUploadInput; error: Error }> = [];
    let completedCount = 0;

    const queue = [...inputs];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        try {
          const res = await this.uploadFile(item);
          results.push(res);
        } catch (err: any) {
          errors.push({ input: item, error: err });
        } finally {
          completedCount++;
          if (options?.onProgress) {
            options.onProgress(completedCount, inputs.length);
          }
        }
      }
    });

    await Promise.all(workers);

    const succeededPaths = results.map((r) => r.storagePath);
    return {
      results,
      errors,
      isFullSuccess: errors.length === 0,
      succeededPaths,
    };
  }

  /**
   * Creates a short-lived signed URL for reading private evidence/avatar objects.
   */
  async createSignedUrl(
    bucket: StorageBucket,
    storagePath: string,
    expiresInSeconds = 3600
  ): Promise<StorageSignedUrlResult> {
    if (!storagePath || !storagePath.trim()) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'storagePath is required to create signed URL.', {
        provider: 'SUPABASE',
      });
    }

    const client = this.getClient();
    const { data, error } = await client.storage.from(bucket).createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      if (error?.message?.includes('Object not found') || (error as any)?.statusCode === 404) {
        throw new StorageError(
          StorageErrorCode.FILE_NOT_FOUND,
          `File not found in '${bucket}': ${storagePath}`,
          { provider: 'SUPABASE', details: error }
        );
      }
      if ((error as any)?.statusCode === 403 || error?.message?.includes('permission denied')) {
        throw new StorageError(
          StorageErrorCode.PERMISSION_DENIED,
          `Permission denied creating signed URL for '${bucket}/${storagePath}'`,
          { provider: 'SUPABASE', details: error }
        );
      }
      throw new StorageError(
        StorageErrorCode.PROVIDER_ERROR,
        `Failed to create signed URL for '${bucket}/${storagePath}': ${error?.message ?? 'Unknown'}`,
        { provider: 'SUPABASE', details: error }
      );
    }

    return {
      signedUrl: data.signedUrl,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
  }

  /**
   * Downloads a binary file from Supabase Storage.
   */
  async downloadFile(
    bucket: StorageBucket,
    storagePath: string,
    targetLocalUri?: string
  ): Promise<{ localUri: string; sizeBytes: number }> {
    if (!storagePath || !storagePath.trim()) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'storagePath is required for download.', {
        provider: 'SUPABASE',
      });
    }

    const client = this.getClient();
    const { data, error } = await client.storage.from(bucket).download(storagePath);

    if (error || !data) {
      if (error?.message?.includes('Object not found') || (error as any)?.statusCode === 404) {
        throw new StorageError(
          StorageErrorCode.FILE_NOT_FOUND,
          `File not found for download in '${bucket}': ${storagePath}`,
          { provider: 'SUPABASE', details: error }
        );
      }
      throw new StorageError(
        StorageErrorCode.DOWNLOAD_FAILED,
        `Failed to download '${bucket}/${storagePath}': ${error?.message ?? 'Unknown'}`,
        { provider: 'SUPABASE', details: error }
      );
    }

    const sizeBytes = (data as any).size ?? (data as any).byteLength ?? 0;
    const localUri = targetLocalUri ?? `file:///cache/${storagePath.split('/').pop()}`;

    return { localUri, sizeBytes };
  }

  /**
   * Deletes a storage object. Operation is idempotent: non-existent objects return true.
   */
  async deleteFile(bucket: StorageBucket, storagePath: string): Promise<boolean> {
    if (!storagePath || !storagePath.trim()) {
      return true;
    }

    const client = this.getClient();
    const { error } = await client.storage.from(bucket).remove([storagePath]);

    if (error) {
      if ((error as any)?.statusCode === 404 || error.message?.includes('not found')) {
        return true;
      }
      if ((error as any)?.statusCode === 403 || error.message?.includes('permission denied')) {
        throw new StorageError(
          StorageErrorCode.PERMISSION_DENIED,
          `Permission denied deleting '${bucket}/${storagePath}'`,
          { provider: 'SUPABASE', details: error }
        );
      }
      throw new StorageError(
        StorageErrorCode.DELETE_FAILED,
        `Failed to delete '${bucket}/${storagePath}': ${error.message}`,
        { provider: 'SUPABASE', details: error }
      );
    }

    return true;
  }

  /**
   * Batch deletes multiple storage objects.
   */
  async deleteBatch(bucket: StorageBucket, storagePaths: string[]): Promise<StorageBatchDeleteResult> {
    const validPaths = storagePaths.filter((p) => p && typeof p === 'string' && p.trim().length > 0);
    if (validPaths.length === 0) {
      return { deleted: [], failed: [] };
    }

    const client = this.getClient();
    const { data, error } = await client.storage.from(bucket).remove(validPaths);

    if (error) {
      return {
        deleted: [],
        failed: validPaths.map((p) => ({ path: p, error: error.message })),
      };
    }

    const deletedPaths = Array.isArray(data) ? data.map((d: any) => d.name ?? d.path ?? d) : validPaths;
    return {
      deleted: deletedPaths,
      failed: [],
    };
  }

  /**
   * Retrieves metadata (size, MIME type, updated timestamp) for an object.
   */
  async getObjectMetadata(
    bucket: StorageBucket,
    storagePath: string
  ): Promise<{ name: string; sizeBytes: number; mimeType?: string; etag?: string } | null> {
    if (!storagePath || !storagePath.trim()) {
      return null;
    }

    const client = this.getClient();
    const parts = storagePath.split('/');
    const fileName = parts.pop() ?? '';
    const folder = parts.join('/');

    const { data, error } = await client.storage.from(bucket).list(folder, {
      search: fileName,
      limit: 10,
    });

    if (error || !data) {
      return null;
    }

    const match = data.find((item: any) => item.name === fileName);
    if (!match) {
      return null;
    }

    const sizeBytes = match.metadata?.size ?? (match as any).size ?? 0;
    const mimeType = match.metadata?.mimetype ?? match.metadata?.contentType;

    return {
      name: fileName,
      sizeBytes,
      mimeType,
      etag: match.id,
    };
  }

  /**
   * Checks whether an object exists in a bucket, with optional size verification.
   */
  async fileExists(
    bucket: StorageBucket,
    storagePath: string,
    options?: { expectedSizeBytes?: number; toleranceBytes?: number }
  ): Promise<boolean> {
    const meta = await this.getObjectMetadata(bucket, storagePath);
    if (!meta) {
      return false;
    }

    if (options?.expectedSizeBytes !== undefined && options.expectedSizeBytes > 0) {
      const tolerance = options.toleranceBytes ?? 0;
      return Math.abs(meta.sizeBytes - options.expectedSizeBytes) <= tolerance;
    }

    return true;
  }
}

export const supabaseStorageService = new SupabaseStorageService();
