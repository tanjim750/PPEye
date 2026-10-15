import { StorageError, StorageErrorCode } from '../services/storage/storage.errors';

export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CachedImageMetadata {
  fileId: string;
  localUri: string;
  fileName: string;
  cachedAt: number;
  expiresAt: number;
  sizeBytes: number;
  isSensitive: boolean;
  mimeType?: string;
}

export interface GetImageUriOptions {
  /**
   * Cache time-to-live in milliseconds. Defaults to 7 days.
   */
  ttlMs?: number;
  /**
   * Mark as sensitive (e.g. PPE inspection or user profile picture).
   * Sensitive files can be specifically purged on logout or account switch.
   */
  isSensitive?: boolean;
  /**
   * Force fresh download even if present in cache.
   */
  forceRefresh?: boolean;
}

export interface CacheImageOptions {
  ttlMs?: number;
  isSensitive?: boolean;
  customFileName?: string;
}

// In-memory cache index
const cacheIndex: Map<string, CachedImageMetadata> = new Map();

// Pluggable dependencies for unit tests
let fileSystemModule: typeof import('expo-file-system/legacy') | null = null;
let injectedFileSystem: any = null;
let injectedDownloader: ((fileId: string, destPath?: string) => Promise<{ uri: string; sizeBytes?: number }>) | null = null;

export function setCacheFileSystemMock(mock: any): void {
  injectedFileSystem = mock;
}

export function setCustomImageDownloader(
  downloader: ((fileId: string, destPath?: string) => Promise<{ uri: string; sizeBytes?: number }>) | null
): void {
  injectedDownloader = downloader;
}

function getFileSystem(): typeof import('expo-file-system/legacy') | null {
  if (injectedFileSystem) {
    return injectedFileSystem;
  }
  if (!fileSystemModule) {
    try {
      fileSystemModule = require('expo-file-system/legacy');
    } catch {
      fileSystemModule = null;
    }
  }
  return fileSystemModule;
}

function getCacheDir(): string {
  const FS = getFileSystem();
  const base = FS?.cacheDirectory ?? 'file:///tmp/cache/';
  return base.endsWith('/') ? `${base}ppeye_images/` : `${base}/ppeye_images/`;
}

// ---------------------------------------------------------------------------
// 1. File Naming & Path Utilities
// ---------------------------------------------------------------------------

/**
 * Extracts file extension from a file name or URI, lowercased without leading dot.
 * Defaults to 'jpg'.
 */
export function getFileExtension(fileNameOrUri: string): string {
  if (!fileNameOrUri || typeof fileNameOrUri !== 'string') {
    return 'jpg';
  }
  const cleanUri = fileNameOrUri.split('?')[0].split('#')[0].trim();
  const stripped = cleanUri.startsWith('.') ? cleanUri.substring(1) : cleanUri;
  const dotIndex = stripped.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = stripped.substring(dotIndex + 1).toLowerCase();
    return ext.length > 0 ? ext : 'jpg';
  }
  if (/^[a-zA-Z0-9]{1,5}$/.test(stripped)) {
    return stripped.toLowerCase();
  }
  return 'jpg';
}

/**
 * Backwards-compatible alias for getFileExtension.
 */
export const getImageExtension = getFileExtension;

/**
 * Sanitizes a file name by removing illegal path characters, spaces, and duplicate underscores.
 */
export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'file';
  }
  const sanitized = name
    .trim()
    .replace(/[^\w.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized.length > 0 ? sanitized : 'file';
}

/**
 * Generates a unique, collision-resistant file name with timestamp and random entropy.
 */
export function generateUniqueFileName(prefix: string, extension: string = 'jpg'): string {
  const cleanPrefix = sanitizeFileName(prefix);
  const cleanExt = getFileExtension(extension);
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${cleanPrefix}_${timestamp}_${randomStr}.${cleanExt}`;
}

/**
 * Generates the standardized PPE worker inspection photo file name:
 * Format: <sanitizedSite>_w<workerSequenceNo>_<front|back>.<ext>
 */
export function generatePPEFileName(
  siteName: string,
  workerSequenceNo: number,
  side: 'FRONT' | 'BACK',
  extension: string = 'jpg'
): string {
  const cleanSite = sanitizeFileName(siteName);
  const cleanSide = side.toLowerCase();
  const cleanExt = getFileExtension(extension);
  return `${cleanSite}_w${workerSequenceNo}_${cleanSide}.${cleanExt}`;
}

/**
 * Generates the standardized hazard or environmental site photo file name:
 * Format: <sanitizedSite>_other_<sequenceNo>.<ext>
 */
export function generateOtherFileName(
  siteName: string,
  sequenceNo: number,
  extension: string = 'jpg'
): string {
  const cleanSite = sanitizeFileName(siteName);
  const cleanExt = getFileExtension(extension);
  return `${cleanSite}_other_${sequenceNo}.${cleanExt}`;
}

/**
 * Generates the standardized user profile avatar photo file name:
 * Format: user_<userId>_avatar.<ext>
 */
export function generateProfileFileName(
  userId: number | string,
  extension: string = 'jpg'
): string {
  const cleanExt = getFileExtension(extension);
  return `user_${userId}_avatar.${cleanExt}`;
}

// ---------------------------------------------------------------------------
// 2. Private Local Cache Implementation
// ---------------------------------------------------------------------------

async function ensureCacheDirExists(): Promise<void> {
  const FS = getFileSystem();
  if (!FS) return;
  const dir = getCacheDir();
  try {
    if (typeof FS.getInfoAsync === 'function' && typeof FS.makeDirectoryAsync === 'function') {
      const info = await FS.getInfoAsync(dir);
      if (!info.exists) {
        await FS.makeDirectoryAsync(dir, { intermediates: true });
      }
    }
  } catch (err) {
    console.warn('[ImageCache] Error ensuring cache dir exists:', err);
  }
}

/**
 * Retrieve the local URI for a cached image if available, unexpired, and verified on disk.
 * Returns null on cache miss, expired entry, or missing file on disk.
 */
export async function getCachedImageUri(fileIdOrKey: string): Promise<string | null> {
  if (!fileIdOrKey || !fileIdOrKey.trim()) {
    return null;
  }

  const key = fileIdOrKey.trim();
  const entry = cacheIndex.get(key);

  if (entry) {
    // 1. Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await invalidateImageCache(key);
      return null;
    }

    // 2. Verify file exists on local disk and is non-empty
    const FS = getFileSystem();
    if (FS && typeof FS.getInfoAsync === 'function') {
      try {
        const info = await FS.getInfoAsync(entry.localUri);
        if (!info.exists || (info as any).size === 0) {
          cacheIndex.delete(key);
          return null;
        }
      } catch {
        cacheIndex.delete(key);
        return null;
      }
    }

    return entry.localUri;
  }

  return null;
}

/**
 * Retrieve image URI on-demand:
 * 1. Checks local private cache first (Cache-Hit).
 * 2. If absent, downloads from storage into private app storage (avoiding eager downloads).
 * 3. Preserves original image quality without adding compression.
 */
export async function getImageUri(
  fileId: string,
  options?: GetImageUriOptions
): Promise<string> {
  if (!fileId || !fileId.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'fileId must not be empty.'
    );
  }

  const cleanFileId = fileId.trim();

  // 1. Check Cache-Hit (unless forceRefresh requested)
  if (!options?.forceRefresh) {
    const cachedUri = await getCachedImageUri(cleanFileId);
    if (cachedUri) {
      return cachedUri;
    }
  }

  // 2. Download from Google Drive into app-private cache storage
  await ensureCacheDirExists();
  const cacheDir = getCacheDir();
  const destPath = `${cacheDir}ppeye_drive_${cleanFileId}.jpg`;

  let downloadResult: { uri: string; sizeBytes?: number };

  try {
    if (injectedDownloader) {
      downloadResult = await injectedDownloader(cleanFileId, destPath);
    } else {
      // Lazy load downloadFile from google-drive files service
      const { downloadFile } = require('../services/google-drive/files');
      const dl = await downloadFile(cleanFileId, destPath);
      downloadResult = { uri: dl.localUri, sizeBytes: dl.sizeBytes };
    }
  } catch (err: any) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      StorageErrorCode.DOWNLOAD_FAILED,
      `Failed to download image for fileId "${cleanFileId}": ${err?.message ?? err}`,
      { cause: err }
    );
  }

  // 3. Register in cache index
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const isSensitive = options?.isSensitive ?? false;

  const metadata: CachedImageMetadata = {
    fileId: cleanFileId,
    localUri: downloadResult.uri,
    fileName: `ppeye_drive_${cleanFileId}.jpg`,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    sizeBytes: downloadResult.sizeBytes ?? 0,
    isSensitive,
  };

  cacheIndex.set(cleanFileId, metadata);
  return downloadResult.uri;
}

/**
 * Cache an existing local image into app-private storage.
 * Preserves original image quality with 0 compression.
 */
export async function cacheImage(
  fileIdOrKey: string,
  sourceUri: string,
  options?: CacheImageOptions
): Promise<string> {
  if (!fileIdOrKey || !fileIdOrKey.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'fileIdOrKey must not be empty.'
    );
  }

  if (!sourceUri || !sourceUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'sourceUri must not be empty.'
    );
  }

  const key = fileIdOrKey.trim();
  const FS = getFileSystem();

  // Validate source file exists
  let sourceSize = 0;
  if (FS && typeof FS.getInfoAsync === 'function') {
    const info = await FS.getInfoAsync(sourceUri);
    if (!info.exists) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        `Source image not found for caching: ${sourceUri}`
      );
    }
    sourceSize = (info as any).size ?? 0;
  }

  await ensureCacheDirExists();
  const cacheDir = getCacheDir();
  const ext = getFileExtension(options?.customFileName ?? sourceUri);
  const destFileName = options?.customFileName
    ? sanitizeFileName(options.customFileName)
    : `ppeye_cached_${sanitizeFileName(key)}.${ext}`;
  const destPath = `${cacheDir}${destFileName}`;

  // Copy preserving original quality (no compression)
  if (FS && typeof FS.copyAsync === 'function') {
    try {
      await FS.copyAsync({ from: sourceUri, to: destPath });
    } catch (err: any) {
      throw new StorageError(
        StorageErrorCode.PROVIDER_ERROR,
        `Failed to copy image to cache: ${err?.message ?? err}`,
        { cause: err }
      );
    }
  }

  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const isSensitive = options?.isSensitive ?? false;

  const metadata: CachedImageMetadata = {
    fileId: key,
    localUri: destPath,
    fileName: destFileName,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    sizeBytes: sourceSize,
    isSensitive,
  };

  cacheIndex.set(key, metadata);
  return destPath;
}

/**
 * Removes a specific image from disk and invalidates its cache index entry.
 */
export async function invalidateImageCache(fileIdOrKey: string): Promise<boolean> {
  if (!fileIdOrKey || !fileIdOrKey.trim()) {
    return false;
  }

  const key = fileIdOrKey.trim();
  const entry = cacheIndex.get(key);
  const FS = getFileSystem();

  if (entry) {
    if (FS && typeof FS.deleteAsync === 'function') {
      try {
        await FS.deleteAsync(entry.localUri, { idempotent: true });
      } catch {
        // Ignore deletion failure
      }
    }
    cacheIndex.delete(key);
    return true;
  }

  return false;
}

/**
 * Clear cached images.
 * When options.onlySensitive is true, only purges sensitive inspection/profile images
 * (used on logout or account switch).
 */
export async function clearImageCache(options?: { onlySensitive?: boolean }): Promise<void> {
  const FS = getFileSystem();
  const onlySensitive = options?.onlySensitive ?? false;

  if (onlySensitive) {
    const sensitiveKeys: string[] = [];
    for (const [key, entry] of cacheIndex.entries()) {
      if (entry.isSensitive) {
        sensitiveKeys.push(key);
      }
    }
    for (const key of sensitiveKeys) {
      await invalidateImageCache(key);
    }
    return;
  }

  // Clear all cached files
  if (FS && typeof FS.deleteAsync === 'function') {
    const cacheDir = getCacheDir();
    try {
      await FS.deleteAsync(cacheDir, { idempotent: true });
    } catch {
      // Ignore directory deletion error
    }
  }

  cacheIndex.clear();
}

/**
 * Scans cache index and disk, removing expired images.
 * Returns the count of deleted files.
 */
export async function cleanupExpiredCache(maxAgeMs?: number): Promise<number> {
  let cleanedCount = 0;
  const now = Date.now();
  const expiredKeys: string[] = [];

  for (const [key, entry] of cacheIndex.entries()) {
    const isExpiredByTTL = entry.expiresAt && now > entry.expiresAt;
    const isExpiredByMaxAge = maxAgeMs !== undefined && now - entry.cachedAt > maxAgeMs;

    if (isExpiredByTTL || isExpiredByMaxAge) {
      expiredKeys.push(key);
    }
  }

  for (const key of expiredKeys) {
    await invalidateImageCache(key);
    cleanedCount++;
  }

  return cleanedCount;
}

/**
 * Helper to inspect the current size and count of the cache index.
 */
export function getCacheStats(): { count: number; totalSizeBytes: number } {
  let totalSizeBytes = 0;
  for (const entry of cacheIndex.values()) {
    totalSizeBytes += entry.sizeBytes ?? 0;
  }
  return {
    count: cacheIndex.size,
    totalSizeBytes,
  };
}
