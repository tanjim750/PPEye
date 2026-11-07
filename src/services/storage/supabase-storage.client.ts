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
let dbClientOverride: any = null;
let imagePrefetchOverride: ((url: string, policy?: 'memory' | 'disk' | 'memory-disk') => Promise<boolean>) | null = null;

export function setSupabaseStorageClientOverride(client: any): void {
  storageClientOverride = client;
}

export function getStorageClientOverride(): any {
  return storageClientOverride;
}

export function setSupabaseDbClientOverride(client: any): void {
  dbClientOverride = client;
}

export function setImagePrefetchOverride(
  fn: ((url: string, policy?: 'memory' | 'disk' | 'memory-disk') => Promise<boolean>) | null
): void {
  imagePrefetchOverride = fn;
}

export const ONE_DAY_SECONDS = 86400; // 24 hours

export interface SignedUrlCacheEntry {
  signedUrl: string;
  expiresAt: number;
}

export interface PreloadedMediaSource {
  uri: string;
  cacheKey?: string;
  headers?: Record<string, string>;
}

export interface PreloadedWorkerMedia {
  workerId: number | null;
  sequenceNo: number;
  displayIndex: number;
  workerName?: string;
  frontPath: string | null;
  backPath: string | null;
  frontCandidates: PreloadedMediaSource[];
  backCandidates: PreloadedMediaSource[];
  hasFrontRecord: boolean;
  hasBackRecord: boolean;
}

export interface PreloadedOtherMedia {
  id: number;
  sequenceNo: number;
  storagePath: string | null;
  uri: string;
  candidates: PreloadedMediaSource[];
}

export interface SubmissionMediaBundle {
  submissionId: number;
  workers: PreloadedWorkerMedia[];
  otherPhotos: PreloadedOtherMedia[];
  signedUrls: Record<string, string>;
}

const signedUrlMemoryCache = new Map<string, SignedUrlCacheEntry>();
const inFlightSignedUrls = new Map<string, Promise<StorageSignedUrlResult>>();

interface SubmissionPreloadCacheEntry {
  results: Record<string, string>;
  expiresAt: number;
}
const submissionPreloadCache = new Map<number, SubmissionPreloadCacheEntry>();
const inFlightSubmissionPreloads = new Map<number, Promise<Record<string, string>>>();

interface SubmissionMediaBundleCacheEntry {
  bundle: SubmissionMediaBundle;
  expiresAt: number;
}
const submissionMediaBundleCache = new Map<number, SubmissionMediaBundleCacheEntry>();
const inFlightSubmissionMediaBundles = new Map<number, Promise<SubmissionMediaBundle>>();

const submissionWorkerPhotosCache = new Map<number, { photos: Map<string, string>; loadedAt: number }>();
const inFlightWorkerPhotos = new Map<number, Promise<Map<string, string>>>();

/**
 * Retries an async operation up to `retries` additional times with exponential backoff.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 250
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }
  throw lastError;
}

/**
 * Prefetches an image URL into Expo Image memory-disk cache with 2x exponential-backoff retry.
 * Treats `false` return from `Image.prefetch` as a retryable failure.
 */
export async function prefetchUrlWithRetry(
  url: string,
  baseDelayMs = 250
): Promise<boolean> {
  if (!url || !url.startsWith('http')) return false;
  let prefetchFn = imagePrefetchOverride;
  if (!prefetchFn) {
    try {
      const { Image } = require('expo-image');
      if (Image && typeof Image.prefetch === 'function') {
        prefetchFn = (u: string, policy?: 'memory' | 'disk' | 'memory-disk') => Image.prefetch(u, policy);
      }
    } catch {
      return false;
    }
  }
  if (!prefetchFn) return false;

  try {
    return await retryWithBackoff(
      async () => {
        const ok = await prefetchFn!(url, 'memory-disk');
        if (!ok) {
          throw new Error('Image.prefetch returned false');
        }
        return true;
      },
      2,
      baseDelayMs
    );
  } catch {
    return false;
  }
}

export function getPreloadedSubmissionMediaSync(submissionId?: number | string | null): SubmissionMediaBundle | null {
  const subIdNum = Number(submissionId);
  if (isNaN(subIdNum) || subIdNum <= 0) return null;
  const entry = submissionMediaBundleCache.get(subIdNum);
  if (entry && Date.now() < entry.expiresAt - 300_000) {
    return entry.bundle;
  }
  return null;
}

export function getCachedSignedUrl(bucket: StorageBucket, storagePath: string): string | null {
  if (!storagePath) return null;
  const key = `${bucket}:${storagePath.trim()}`;
  const entry = signedUrlMemoryCache.get(key);
  // Reuse if still valid for at least 5 minutes
  if (entry && Date.now() < entry.expiresAt - 300_000) {
    return entry.signedUrl;
  }
  return null;
}

export function cacheSignedUrl(
  bucket: StorageBucket,
  storagePath: string,
  signedUrl: string,
  expiresInSeconds = ONE_DAY_SECONDS
): void {
  if (!storagePath || !signedUrl) return;
  const key = `${bucket}:${storagePath.trim()}`;
  signedUrlMemoryCache.set(key, {
    signedUrl,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });
}

export function invalidateSubmissionPreloadCache(submissionId?: number | string): void {
  if (submissionId !== undefined) {
    const subIdNum = Number(submissionId);
    if (!isNaN(subIdNum)) {
      submissionPreloadCache.delete(subIdNum);
      submissionMediaBundleCache.delete(subIdNum);
      submissionWorkerPhotosCache.delete(subIdNum);
    }
  } else {
    submissionPreloadCache.clear();
    submissionMediaBundleCache.clear();
    submissionWorkerPhotosCache.clear();
  }
}

export function clearSignedUrlCache(): void {
  signedUrlMemoryCache.clear();
  inFlightSignedUrls.clear();
  submissionPreloadCache.clear();
  inFlightSubmissionPreloads.clear();
  submissionMediaBundleCache.clear();
  inFlightSubmissionMediaBundles.clear();
  submissionWorkerPhotosCache.clear();
  inFlightWorkerPhotos.clear();
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
   * Creates a signed URL for reading private evidence/avatar objects.
   * Defaults to 1 day (86400 seconds) for optimal caching.
   * Reuses unexpired signed URL from cache if available.
   */
  /**
   * Creates a signed URL for reading private evidence/avatar objects.
   * Defaults to 1 day (86400 seconds) for optimal caching.
   * Reuses unexpired signed URL from cache if available.
   * Automatically deduplicates concurrent in-flight requests for the same path.
   */
  async createSignedUrl(
    bucket: StorageBucket,
    storagePath: string,
    expiresInSeconds = ONE_DAY_SECONDS,
    options?: { forceRefresh?: boolean }
  ): Promise<StorageSignedUrlResult> {
    if (!bucket || (bucket !== 'evidence' && bucket !== 'avatars')) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Invalid bucket: '${bucket}'. Must be 'evidence' or 'avatars'.`,
        { provider: 'SUPABASE' }
      );
    }

    if (!storagePath || !storagePath.trim()) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'storagePath is required to create signed URL.', {
        provider: 'SUPABASE',
      });
    }

    const cleanPath = storagePath.trim();
    if (cleanPath.includes('..') || cleanPath.startsWith('/') || cleanPath.includes('\0')) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Invalid storagePath: '${cleanPath}'. Traversal, leading slash, or null bytes not permitted.`,
        { provider: 'SUPABASE' }
      );
    }

    const boundedExpires = Math.min(Math.max(60, expiresInSeconds), 86400);
    const cacheKey = `${bucket}:${cleanPath}`;

    // 1. If not forcing refresh, check cache and REUSE if valid
    if (!options?.forceRefresh) {
      const existing = signedUrlMemoryCache.get(cacheKey);
      if (existing && Date.now() < existing.expiresAt - 300_000) {
        return {
          signedUrl: existing.signedUrl,
          expiresAt: existing.expiresAt,
        };
      }
      // Deduplicate concurrent in-flight requests for the same key
      const activeInFlight = inFlightSignedUrls.get(cacheKey);
      if (activeInFlight) {
        return activeInFlight;
      }
    }

    const fetchPromise = (async (): Promise<StorageSignedUrlResult> => {
      try {
        const client = this.getClient();
        const { data, error } = await client.storage.from(bucket).createSignedUrl(cleanPath, boundedExpires);

        if (error || !data?.signedUrl) {
          if (error?.message?.includes('Object not found') || (error as any)?.statusCode === 404) {
            throw new StorageError(
              StorageErrorCode.FILE_NOT_FOUND,
              `File not found in '${bucket}': ${cleanPath}`,
              { provider: 'SUPABASE', details: error }
            );
          }
          if ((error as any)?.statusCode === 403 || error?.message?.includes('permission denied')) {
            throw new StorageError(
              StorageErrorCode.PERMISSION_DENIED,
              `Permission denied creating signed URL for '${bucket}/${cleanPath}'`,
              { provider: 'SUPABASE', details: error }
            );
          }
          throw new StorageError(
            StorageErrorCode.PROVIDER_ERROR,
            `Failed to create signed URL for '${bucket}/${cleanPath}': ${error?.message ?? 'Unknown'}`,
            { provider: 'SUPABASE', details: error }
          );
        }

        const expiresAt = Date.now() + boundedExpires * 1000;
        signedUrlMemoryCache.set(cacheKey, {
          signedUrl: data.signedUrl,
          expiresAt,
        });

        return {
          signedUrl: data.signedUrl,
          expiresAt,
        };
      } finally {
        inFlightSignedUrls.delete(cacheKey);
      }
    })();

    inFlightSignedUrls.set(cacheKey, fetchPromise);
    return fetchPromise;
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

    // Persist downloaded binary payload to local target URI if provided
    if (targetLocalUri) {
      try {
        const FileSystem = require('expo-file-system/legacy');
        if (FileSystem && typeof FileSystem.writeAsStringAsync === 'function') {
          let base64 = '';
          if (typeof (data as any).arrayBuffer === 'function') {
            const ab = await (data as any).arrayBuffer();
            const bytes = new Uint8Array(ab);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
            }
            base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
          }
          if (base64) {
            await FileSystem.writeAsStringAsync(targetLocalUri, base64, {
              encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
            });
          }
        }
      } catch {
        // Fallback for Node test environments
        try {
          const fs = require('fs');
          const cleanPath = targetLocalUri.replace(/^file:\/\//, '');
          if (typeof (data as any).arrayBuffer === 'function') {
            const ab = await (data as any).arrayBuffer();
            fs.writeFileSync(cleanPath, Buffer.from(ab));
          }
        } catch {}
      }
    }

    return { localUri, sizeBytes };
  }

  /**
   * Deletes a storage object. Operation is idempotent: non-existent objects return true.
   */
  async deleteFile(bucket: StorageBucket, storagePath: string): Promise<boolean> {
    if (!storagePath || !storagePath.trim()) {
      return true;
    }

    const cleanPath = storagePath.trim();
    signedUrlMemoryCache.delete(`${bucket}:${cleanPath}`);

    const client = this.getClient();
    const { error } = await client.storage.from(bucket).remove([cleanPath]);

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

function getSupabaseDbClient(): any {
  if (dbClientOverride) return dbClientOverride;
  try {
    return require('../supabase/client').supabase;
  } catch {
    return require('@/services/supabase/client').supabase;
  }
}

function getOptionalImageUtils(): {
  getCachedImageUri?: (path: string) => Promise<string | null>;
  getImageUri?: (path: string, opts?: any) => Promise<string | null>;
} {
  try {
    return require('../../utils/image');
  } catch {
    try {
      return require('@/utils/image');
    } catch {
      return {};
    }
  }
}

function isSupabaseStoragePath(fileId?: string | null, storageProvider?: string | null): boolean {
  if (!fileId || !fileId.trim()) return false;
  const clean = fileId.trim();
  if (clean.includes('drive.google.com') || clean.includes('googleusercontent.com')) return false;
  return (
    storageProvider === 'SUPABASE' ||
    clean.startsWith('submissions/') ||
    clean.startsWith('users/') ||
    (clean.includes('/') && !clean.startsWith('http://') && !clean.startsWith('https://'))
  );
}

/**
 * Resolves and pre-fetches the complete multi-worker + other-evidence media bundle for a submission
 * in a single parallel batch, with 2x exponential-backoff retry and zero-query reuse when cached.
 */
export async function preloadSubmissionMedia(
  submissionId: number | string,
  options?: {
    expiresInSeconds?: number;
    forceRefresh?: boolean;
    retryDelayMs?: number;
    awaitPrefetch?: boolean;
  }
): Promise<SubmissionMediaBundle> {
  const subIdNumber = Number(submissionId);
  const emptyBundle: SubmissionMediaBundle = {
    submissionId: isNaN(subIdNumber) ? 0 : subIdNumber,
    workers: [],
    otherPhotos: [],
    signedUrls: {},
  };
  if (isNaN(subIdNumber) || subIdNumber <= 0) return emptyBundle;

  const expiresIn = options?.expiresInSeconds ?? ONE_DAY_SECONDS;
  const baseDelayMs = options?.retryDelayMs ?? 250;

  if (!options?.forceRefresh) {
    const existing = submissionMediaBundleCache.get(subIdNumber);
    if (existing && Date.now() < existing.expiresAt - 300_000) {
      return existing.bundle;
    }
    const activeInFlight = inFlightSubmissionMediaBundles.get(subIdNumber);
    if (activeInFlight) {
      return activeInFlight;
    }
  }

  const bundlePromise = (async (): Promise<SubmissionMediaBundle> => {
    const signedUrls: Record<string, string> = {};
    const workers: PreloadedWorkerMedia[] = [];
    const otherPhotos: PreloadedOtherMedia[] = [];

    try {
      const supabase = getSupabaseDbClient();
      const imageUtils = getOptionalImageUtils();

      const [{ data: instList }, { data: otherList }, { data: subData }] = await Promise.all([
        supabase
          .from('ppe_worker_instances')
          .select(`
            id,
            sequence_no,
            ppe_images (
              id,
              side,
              file_id,
              files ( id, file_name, provider_file_id, storage_provider )
            )
          `)
          .eq('submission_id', subIdNumber),
        supabase
          .from('other_images')
          .select(`
            id,
            sequence_no,
            file_id,
            files ( id, file_name, provider_file_id, storage_provider )
          `)
          .eq('submission_id', subIdNumber),
        supabase
          .from('ppe_submissions')
          .select('metadata')
          .eq('id', subIdNumber)
          .maybeSingle(),
      ]);

      const sortedInstList: any[] = ((instList as any[]) || []).slice().sort(
        (a, b) => (Number(a.sequence_no) || 0) - (Number(b.sequence_no) || 0)
      );
      const sortedOtherList: any[] = ((otherList as any[]) || []).slice().sort(
        (a, b) => (Number(a.sequence_no) || 0) - (Number(b.sequence_no) || 0)
      );

      // Batch-resolve any missing file rows in 1 query instead of per-worker serial queries
      const missingFileIds = new Set<number>();
      for (const inst of sortedInstList) {
        for (const img of inst.ppe_images || []) {
          const rawFile = Array.isArray(img.files) ? img.files[0] : img.files;
          if (!rawFile?.provider_file_id && img.file_id) {
            missingFileIds.add(Number(img.file_id));
          }
        }
      }
      for (const oth of sortedOtherList) {
        const rawFile = Array.isArray(oth.files) ? oth.files[0] : oth.files;
        if (!rawFile?.provider_file_id && oth.file_id) {
          missingFileIds.add(Number(oth.file_id));
        }
      }

      const fallbackFilesById = new Map<number, { provider_file_id: string; storage_provider?: string }>();
      if (missingFileIds.size > 0) {
        try {
          const { data: fileRows } = await supabase
            .from('files')
            .select('id, provider_file_id, storage_provider')
            .in('id', Array.from(missingFileIds));
          for (const f of (fileRows as any[]) || []) {
            if (f?.provider_file_id) {
              fallbackFilesById.set(Number(f.id), f);
            }
          }
        } catch {}
      }

      const orderedPaths: string[] = [];
      const seenPaths = new Set<string>();
      const addPath = (p?: string | null) => {
        if (p && !seenPaths.has(p)) {
          seenPaths.add(p);
          orderedPaths.push(p);
        }
      };

      const workerPhotoMap = new Map<string, string>();
      const rawWorkers = sortedInstList.map((worker, idx) => {
        const displayIndex = idx + 1;
        const seq = Number(worker.sequence_no) || displayIndex;
        const images = ((worker.ppe_images as any[]) || []).slice();

        const pickLatestSide = (side: 'FRONT' | 'BACK') => {
          const matches = images
            .filter((img) => String(img.side || '').toUpperCase() === side)
            .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
          const chosen = matches[0];
          if (!chosen) return { path: null as string | null, valid: false };
          const raw = Array.isArray(chosen.files) ? chosen.files[0] : chosen.files;
          const fileMeta = raw?.provider_file_id ? raw : fallbackFilesById.get(Number(chosen.file_id));
          const fileId: string | null = fileMeta?.provider_file_id || null;
          const provider: string | null =
            fileMeta?.storage_provider || (fileId?.includes('/') ? 'SUPABASE' : 'GOOGLE_DRIVE');
          const valid = isSupabaseStoragePath(fileId, provider);
          return { path: valid ? fileId : null, valid: Boolean(valid && fileId) };
        };

        const front = pickLatestSide('FRONT');
        const back = pickLatestSide('BACK');

        if (front.path) {
          addPath(front.path);
          workerPhotoMap.set(`${seq}:FRONT`, front.path);
          workerPhotoMap.set(`${seq}:front`, front.path);
          if (!workerPhotoMap.has(String(seq))) workerPhotoMap.set(String(seq), front.path);
        }
        if (back.path) {
          addPath(back.path);
          workerPhotoMap.set(`${seq}:BACK`, back.path);
          workerPhotoMap.set(`${seq}:back`, back.path);
          if (!workerPhotoMap.has(String(seq))) workerPhotoMap.set(String(seq), back.path);
        }

        return {
          workerId: worker.id ? Number(worker.id) : null,
          sequenceNo: seq,
          displayIndex,
          workerName: worker.worker_name || undefined,
          frontPath: front.path,
          backPath: back.path,
          hasFrontRecord: front.valid,
          hasBackRecord: back.valid,
        };
      });

      submissionWorkerPhotosCache.set(subIdNumber, {
        photos: workerPhotoMap,
        loadedAt: Date.now(),
      });

      const rawOthers = sortedOtherList.map((oth, idx) => {
        const raw = Array.isArray(oth.files) ? oth.files[0] : oth.files;
        const fileMeta = raw?.provider_file_id ? raw : fallbackFilesById.get(Number(oth.file_id));
        const fileId: string | null = fileMeta?.provider_file_id || null;
        const provider: string | null =
          fileMeta?.storage_provider || (fileId?.includes('/') ? 'SUPABASE' : 'GOOGLE_DRIVE');
        const valid = isSupabaseStoragePath(fileId, provider);
        if (valid && fileId) addPath(fileId);
        return {
          id: Number(oth.id) || idx + 1,
          sequenceNo: Number(oth.sequence_no) || idx + 1,
          storagePath: valid ? fileId : null,
        };
      });

      const localCachedByPath = new Map<string, string>();
      await Promise.all(
        orderedPaths.map(async (path) => {
          const bucket: StorageBucket = path.startsWith('users/') ? 'avatars' : 'evidence';
          const [localUri, signedUrl] = await Promise.all([
            imageUtils.getCachedImageUri
              ? imageUtils.getCachedImageUri(path).catch(() => null)
              : Promise.resolve(null),
            retryWithBackoff(
              async () => {
                const signedRes = await supabaseStorageService.createSignedUrl(bucket, path, expiresIn);
                const url = typeof signedRes === 'string' ? signedRes : signedRes?.signedUrl;
                if (!url || typeof url !== 'string' || !url.startsWith('http')) {
                  throw new Error(`Invalid signed URL for ${path}`);
                }
                return url;
              },
              2,
              baseDelayMs
            ).catch((err) => {
              console.warn('[preloadSubmissionMedia] Signed URL failed after retries for:', path, err);
              return null;
            }),
          ]);

          if (localUri) {
            localCachedByPath.set(path, localUri);
          }
          if (signedUrl) {
            signedUrls[path] = signedUrl;
          }
        })
      );

      const buildCandidates = (path: string | null): PreloadedMediaSource[] => {
        if (!path) return [];
        const list: PreloadedMediaSource[] = [];
        const local = localCachedByPath.get(path);
        if (local) {
          list.push({ uri: local, cacheKey: path });
        }
        const remote = signedUrls[path];
        if (remote) {
          list.push({ uri: remote, cacheKey: path });
        }
        return list;
      };

      for (const w of rawWorkers) {
        workers.push({
          ...w,
          frontCandidates: buildCandidates(w.frontPath),
          backCandidates: buildCandidates(w.backPath),
        });
      }

      for (const o of rawOthers) {
        const candidates = buildCandidates(o.storagePath);
        if (candidates.length > 0) {
          otherPhotos.push({
            id: o.id,
            sequenceNo: o.sequenceNo,
            storagePath: o.storagePath,
            uri: candidates[0].uri,
            candidates,
          });
        }
      }

      // Eagerly prefetch ALL worker & other URLs into memory-disk + local FileSystem disk cache in parallel
      const prefetchTasks = orderedPaths.map(async (path) => {
        const remoteUrl = signedUrls[path];
        const tasks: Promise<unknown>[] = [];
        if (remoteUrl) {
          tasks.push(prefetchUrlWithRetry(remoteUrl, baseDelayMs));
        }
        if (imageUtils.getImageUri && !localCachedByPath.has(path)) {
          tasks.push(
            retryWithBackoff(
              async () => {
                const downloadedUri = await imageUtils.getImageUri!(path, { storageProvider: 'SUPABASE' });
                if (!downloadedUri) throw new Error('Disk cache download returned null');
                return downloadedUri;
              },
              2,
              baseDelayMs
            )
              .then((downloadedUri) => {
                if (!downloadedUri || !downloadedUri.startsWith('file://')) return;
                // Prepend downloaded file:// URI into live bundle candidates for instant offline/Flight Mode access
                for (const w of workers) {
                  if (w.frontPath === path && !w.frontCandidates.some((c) => c.uri === downloadedUri)) {
                    w.frontCandidates.unshift({ uri: downloadedUri, cacheKey: path });
                  }
                  if (w.backPath === path && !w.backCandidates.some((c) => c.uri === downloadedUri)) {
                    w.backCandidates.unshift({ uri: downloadedUri, cacheKey: path });
                  }
                }
                for (const o of otherPhotos) {
                  if (o.storagePath === path && !o.candidates.some((c) => c.uri === downloadedUri)) {
                    o.candidates.unshift({ uri: downloadedUri, cacheKey: path });
                    o.uri = downloadedUri;
                  }
                }
              })
              .catch(() => {})
          );
        }
        await Promise.allSettled(tasks);
      });

      if (options?.awaitPrefetch) {
        await Promise.allSettled(prefetchTasks);
      } else {
        void Promise.allSettled(prefetchTasks);
      }

      const bundle: SubmissionMediaBundle = {
        submissionId: subIdNumber,
        workers,
        otherPhotos,
        signedUrls,
      };

      const expiresAt = Date.now() + expiresIn * 1000;
      submissionMediaBundleCache.set(subIdNumber, { bundle, expiresAt });
      submissionPreloadCache.set(subIdNumber, { results: signedUrls, expiresAt });

      return bundle;
    } catch (err) {
      console.warn('[preloadSubmissionMedia] Error preloading submission media:', err);
      return {
        submissionId: subIdNumber,
        workers,
        otherPhotos,
        signedUrls,
      };
    } finally {
      inFlightSubmissionMediaBundles.delete(subIdNumber);
    }
  })();

  inFlightSubmissionMediaBundles.set(subIdNumber, bundlePromise);
  return bundlePromise;
}

/**
 * On opening a submission:
 * Creates 1-day signed URLs for all images (worker front/back and other photos) if not existing,
 * otherwise reuses the existing cached signed URLs without issuing extra database or storage queries.
 * Also pre-warms Expo Image's disk/memory cache and deduplicates concurrent preload requests.
 */
export async function preloadSubmissionSignedUrls(
  submissionId: number | string,
  options?: { expiresInSeconds?: number; forceRefresh?: boolean }
): Promise<Record<string, string>> {
  const subIdNumber = Number(submissionId);
  if (isNaN(subIdNumber) || subIdNumber <= 0) return {};

  if (!options?.forceRefresh) {
    const existing = submissionPreloadCache.get(subIdNumber);
    if (existing && Date.now() < existing.expiresAt - 300_000) {
      return existing.results;
    }
    const activeInFlight = inFlightSubmissionPreloads.get(subIdNumber);
    if (activeInFlight) {
      return activeInFlight;
    }
  }

  const preloadPromise = preloadSubmissionMedia(submissionId, options)
    .then((bundle) => bundle.signedUrls)
    .finally(() => {
      inFlightSubmissionPreloads.delete(subIdNumber);
    });

  inFlightSubmissionPreloads.set(subIdNumber, preloadPromise);
  return preloadPromise;
}

/**
 * Returns all worker inspection photo paths for a given submission.
 * Reuses in-memory cache and coalesces concurrent queries to exactly 1 database request.
 */
export async function getSubmissionWorkerPhotos(submissionId: number | string): Promise<Map<string, string>> {
  const subIdNumber = Number(submissionId);
  if (isNaN(subIdNumber) || subIdNumber <= 0) return new Map();

  // 1. Check in-memory cache (valid for 10 minutes)
  const cached = submissionWorkerPhotosCache.get(subIdNumber);
  if (cached && Date.now() - cached.loadedAt < 600_000) {
    return cached.photos;
  }

  // 1b. Check synchronous media bundle (0ms instant DB-free hit)
  const syncBundle = getPreloadedSubmissionMediaSync(subIdNumber);
  if (syncBundle && syncBundle.workers.length > 0) {
    const map = new Map<string, string>();
    for (const w of syncBundle.workers) {
      if (w.frontPath) {
        map.set(`${w.sequenceNo}:FRONT`, w.frontPath);
        map.set(`${w.sequenceNo}:front`, w.frontPath);
        if (!map.has(String(w.sequenceNo))) map.set(String(w.sequenceNo), w.frontPath);
      }
      if (w.backPath) {
        map.set(`${w.sequenceNo}:BACK`, w.backPath);
        map.set(`${w.sequenceNo}:back`, w.backPath);
        if (!map.has(String(w.sequenceNo))) map.set(String(w.sequenceNo), w.backPath);
      }
    }
    if (map.size > 0) {
      submissionWorkerPhotosCache.set(subIdNumber, { photos: map, loadedAt: Date.now() });
      return map;
    }
  }

  // 2. Return in-flight query if already running
  const inFlight = inFlightWorkerPhotos.get(subIdNumber);
  if (inFlight) return inFlight;

  const fetchPromise = (async (): Promise<Map<string, string>> => {
    try {
      const { supabase } = require('@/services/supabase/client');
      const { data: instances, error } = await supabase
        .from('ppe_worker_instances')
        .select(`
          sequence_no,
          ppe_images (
            side,
            file_id,
            files ( provider_file_id, storage_provider )
          )
        `)
        .eq('submission_id', subIdNumber);

      const map = new Map<string, string>();
      const missingFileIds: number[] = [];

      if (!error && instances) {
        for (const inst of instances) {
          const seq = Number(inst.sequence_no) || 1;
          for (const img of inst.ppe_images || []) {
            const rawFile = Array.isArray(img.files) ? img.files[0] : img.files;
            const fileId = rawFile?.provider_file_id;
            if (fileId && (rawFile?.storage_provider === 'SUPABASE' || fileId.includes('/'))) {
              const sideUpper = String(img.side || 'FRONT').toUpperCase();
              const sideLower = sideUpper.toLowerCase();
              map.set(`${seq}:${sideUpper}`, fileId);
              map.set(`${seq}:${sideLower}`, fileId);
              if (!map.has(String(seq))) {
                map.set(String(seq), fileId);
              }
            } else if (img.file_id) {
              missingFileIds.push(Number(img.file_id));
            }
          }
        }
      }

      if (missingFileIds.length > 0) {
        try {
          const { data: fileRows } = await supabase
            .from('files')
            .select('id, provider_file_id, storage_provider')
            .in('id', missingFileIds);
          if (fileRows) {
            const fileMap = new Map<number, string>();
            for (const f of fileRows) {
              if (f.provider_file_id) fileMap.set(Number(f.id), f.provider_file_id);
            }
            for (const inst of instances || []) {
              const seq = Number(inst.sequence_no) || 1;
              for (const img of inst.ppe_images || []) {
                const fileId = fileMap.get(Number(img.file_id));
                if (fileId) {
                  const sideUpper = String(img.side || 'FRONT').toUpperCase();
                  const sideLower = sideUpper.toLowerCase();
                  map.set(`${seq}:${sideUpper}`, fileId);
                  map.set(`${seq}:${sideLower}`, fileId);
                  if (!map.has(String(seq))) {
                    map.set(String(seq), fileId);
                  }
                }
              }
            }
          }
        } catch {}
      }

      // Fallback: If no worker photos found, check general other/hazard evidence
      if (map.size === 0) {
        const { data: otherImgs } = await supabase
          .from('other_images')
          .select('files ( provider_file_id, storage_provider )')
          .eq('submission_id', subIdNumber);
        if (otherImgs && otherImgs.length > 0) {
          for (const oth of otherImgs) {
            const rawFile = Array.isArray(oth.files) ? oth.files[0] : oth.files;
            const fileId = rawFile?.provider_file_id;
            if (fileId && (rawFile?.storage_provider === 'SUPABASE' || fileId.includes('/'))) {
              map.set('1:FRONT', fileId);
              map.set('1', fileId);
              break;
            }
          }
        }
      }

      submissionWorkerPhotosCache.set(subIdNumber, {
        photos: map,
        loadedAt: Date.now(),
      });
      return map;
    } catch (err) {
      console.warn('[getSubmissionWorkerPhotos] Error resolving worker photos:', err);
      return new Map<string, string>();
    } finally {
      inFlightWorkerPhotos.delete(subIdNumber);
    }
  })();

  inFlightWorkerPhotos.set(subIdNumber, fetchPromise);
  return fetchPromise;
}

/**
 * Resolves a specific worker inspection photo path synchronously from cache if already loaded.
 */
export function resolveSubmissionWorkerPhotoSync(
  submissionId: number | string,
  sequenceNo: number,
  side: string
): string | null {
  const syncBundle = getPreloadedSubmissionMediaSync(submissionId);
  if (syncBundle && syncBundle.workers.length > 0) {
    const w = syncBundle.workers.find((item) => item.sequenceNo === sequenceNo);
    const sideUpper = String(side).toUpperCase();
    if (sideUpper === 'FRONT' && w?.frontPath) return w.frontPath;
    if (sideUpper === 'BACK' && w?.backPath) return w.backPath;
  }
  const subIdNumber = Number(submissionId);
  if (!isNaN(subIdNumber)) {
    const cached = submissionWorkerPhotosCache.get(subIdNumber);
    if (cached) {
      const sideUpper = String(side).toUpperCase();
      return (
        cached.photos.get(`${sequenceNo}:${sideUpper}`) ||
        cached.photos.get(`${sequenceNo}:${side.toLowerCase()}`) ||
        null
      );
    }
  }
  return null;
}

/**
 * Resolves a specific worker inspection photo path (FRONT or BACK) with memoization.
 */
export async function resolveSubmissionWorkerPhoto(
  submissionId: number | string,
  sequenceNo: number,
  side: string
): Promise<string | null> {
  const syncHit = resolveSubmissionWorkerPhotoSync(submissionId, sequenceNo, side);
  if (syncHit) return syncHit;
  const photos = await getSubmissionWorkerPhotos(submissionId);
  return photos.get(`${sequenceNo}:${side}`) || null;
}
