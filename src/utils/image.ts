import { StorageError, StorageErrorCode } from '../services/storage/storage.errors';

export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_UPLOAD_MAX_LONG_EDGE = 1920; // Target within 1600-2048px for sharp PPE inspection detail
export const DEFAULT_UPLOAD_JPEG_QUALITY = 0.8; // Favors PPE detail while staying within the requested range
const UPLOAD_STAGING_SUBDIR = 'ppeye_upload_staging/';

export interface PrepareImageForUploadOptions {
  /**
   * Maximum pixel dimension on the longer edge. Defaults to 1920px.
   */
  maxLongEdge?: number;
  /**
   * JPEG compression quality (0.1 - 1.0). Defaults to 0.8.
   */
  quality?: number;
  /**
   * Force re-compression even if a staged compressed version already exists.
   */
  force?: boolean;
  forceRecompress?: boolean;
  /**
   * Optional FileSystem adapter override (used by unit test suites).
   */
  fileSystem?: any;
}

export interface PreparedUploadImage {
  uri: string;
  originalUri: string;
  width?: number;
  height?: number;
  originalSizeBytes?: number;
  preparedSizeBytes?: number;
  sizeBytes?: number;
  wasCompressed: boolean;
  reusedPrepared: boolean;
  mimeType?: string;
}

export type ImageManipulatorFn = (
  uri: string,
  actions: Array<{ resize: { width?: number; height?: number } }>,
  saveOptions: { compress: number; format: 'jpeg' | 'png' }
) => Promise<{ uri: string; width?: number; height?: number; sizeBytes?: number }>;

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
  /**
   * Storage provider: 'GOOGLE_DRIVE' | 'SUPABASE'.
   */
  storageProvider?: 'GOOGLE_DRIVE' | 'SUPABASE';
  /**
   * Storage bucket for Supabase Storage: 'evidence' | 'avatars'.
   */
  bucket?: 'evidence' | 'avatars';
}

export interface CacheImageOptions {
  ttlMs?: number;
  isSensitive?: boolean;
  customFileName?: string;
}

// In-memory cache index
const cacheIndex: Map<string, CachedImageMetadata> = new Map();
const inFlightDownloads: Map<string, Promise<string>> = new Map();

// Pre-upload compression staging maps (keeps original file intact & prevents double-compression on retry)
const preparedBySourceUri: Map<string, PreparedUploadImage> = new Map();
const preparedOutputUris: Set<string> = new Set();

// Pluggable dependencies for unit tests
let fileSystemModule: typeof import('expo-file-system/legacy') | null = null;
let injectedFileSystem: any = null;
let injectedDownloader: ((fileId: string, destPath?: string) => Promise<{ uri: string; sizeBytes?: number }>) | null = null;
let injectedManipulator: ImageManipulatorFn | null = null;
let nativeManipulatorModule: any | undefined = undefined;

export function setCacheFileSystemMock(mock: any): void {
  injectedFileSystem = mock;
}

export function setCustomImageDownloader(
  downloader: ((fileId: string, destPath?: string) => Promise<{ uri: string; sizeBytes?: number }>) | null
): void {
  injectedDownloader = downloader;
}

export function setCustomImageManipulator(manipulator: ImageManipulatorFn | null): void {
  injectedManipulator = manipulator;
}

export function clearPreparedUploadCache(): void {
  preparedBySourceUri.clear();
  preparedOutputUris.clear();
}

function getNativeImageManipulator(): any | null {
  if (nativeManipulatorModule !== undefined) {
    return nativeManipulatorModule;
  }
  try {
    // Dynamic resolution so app works both with and without expo-image-manipulator installed
    const modName = 'expo-image-manipulator';
    nativeManipulatorModule = require(modName);
  } catch {
    nativeManipulatorModule = null;
  }
  return nativeManipulatorModule;
}

function getImageManipulator(): ImageManipulatorFn | null {
  if (injectedManipulator) {
    return injectedManipulator;
  }
  const nativeMod = getNativeImageManipulator();
  if (nativeMod?.ImageManipulator?.manipulate) {
    return async (uri, actions, saveOptions) => {
      let context = nativeMod.ImageManipulator.manipulate(uri);
      for (const action of actions) {
        context = context.resize(action.resize);
      }
      const rendered = await context.renderAsync();
      return rendered.saveAsync({
        compress: saveOptions.compress,
        format: nativeMod.SaveFormat?.JPEG ?? 'jpeg',
      });
    };
  }
  return null;
}

export function isNativeImageManipulatorAvailable(): boolean {
  const nativeMod = getNativeImageManipulator();
  return Boolean(injectedManipulator || nativeMod?.ImageManipulator?.manipulate || nativeMod?.manipulateAsync);
}

/**
 * Keep capture/picker encoding at maximum quality; the shared upload helper performs
 * the size-reducing JPEG encode immediately before upload.
 */
export function getRecommendedCaptureQuality(): number {
  return 1;
}

function hashUploadSource(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getPreparedStagingUri(sourceUri: string, maxLongEdge: number, quality: number, sourceSizeBytes?: number, fileSystem?: any): string {
  const FS = fileSystem ?? getFileSystem();
  const baseDir = FS?.cacheDirectory ?? 'file:///cache/';
  const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  const sourceKey = hashUploadSource(`${sourceUri}|${sourceSizeBytes ?? 0}`);
  return `${normalizedBase}${UPLOAD_STAGING_SUBDIR}image_${sourceKey}_ppeye_opt_${maxLongEdge}_q${Math.round(quality * 100)}.jpg`;
}

/**
 * Selects the best camera hardware `pictureSize` (e.g. "1920x1440" or "1920x1080")
 * targeting a long edge between 1600px and 2048px (closest to 1920px, preferring 4:3 sensor aspect).
 */
export function selectOptimalCameraPictureSize(
  availableSizes: string[],
  targetLongEdge: number = DEFAULT_UPLOAD_MAX_LONG_EDGE
): string | undefined {
  if (!Array.isArray(availableSizes) || availableSizes.length === 0) {
    return undefined;
  }

  const parsed = availableSizes
    .map((raw) => {
      const match = /^(\d+)x(\d+)$/i.exec(raw.trim());
      if (!match) return null;
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      if (!w || !h) return null;
      const longEdge = Math.max(w, h);
      const shortEdge = Math.min(w, h);
      const aspect = longEdge / shortEdge;
      const isFourThree = Math.abs(aspect - 4 / 3) < 0.08;
      return { raw: raw.trim(), longEdge, shortEdge, isFourThree };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (parsed.length === 0) {
    return undefined;
  }

  // Prefer sizes within the 1600–2048px target window
  const inTargetWindow = parsed.filter(
    (s) => s.longEdge >= 1600 && s.longEdge <= 2048
  );
  const pool = inTargetWindow.length > 0 ? inTargetWindow : parsed;

  pool.sort((a, b) => {
    const distA = Math.abs(a.longEdge - targetLongEdge) - (a.isFourThree ? 60 : 0);
    const distB = Math.abs(b.longEdge - targetLongEdge) - (b.isFourThree ? 60 : 0);
    return distA - distB;
  });

  return pool[0]?.raw;
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

  // 3. If key is already an existing local file URI, return it directly
  const FS = getFileSystem();
  if (key.startsWith('file://') && FS && typeof FS.getInfoAsync === 'function') {
    try {
      const info = await FS.getInfoAsync(key);
      if (info.exists && (info as any).size > 0) {
        return key;
      }
    } catch {}
  }

  // 4. Recover from disk cache if entry existed prior to app reload
  if (FS && typeof FS.getInfoAsync === 'function') {
    try {
      const cacheDir = getCacheDir();
      const sanitizedKey = sanitizeFileName(key);
      const candidateNames = [
        `ppeye_drive_${key}.jpg`,
        `ppeye_cached_${sanitizedKey}.jpg`,
        `ppeye_cached_${sanitizedKey}.png`,
      ];

      for (const candidateName of candidateNames) {
        const diskPath = `${cacheDir}${candidateName}`;
        const info = await FS.getInfoAsync(diskPath);
        if (info.exists && (info as any).size > 0) {
          const metadata: CachedImageMetadata = {
            fileId: key,
            localUri: diskPath,
            fileName: candidateName,
            cachedAt: Date.now(),
            expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
            sizeBytes: (info as any).size,
            isSensitive: false,
          };
          cacheIndex.set(key, metadata);
          return diskPath;
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Retrieve cached local URI synchronously from the in-memory cache index.
 * Returns null immediately on cache miss or expiration without I/O.
 */
export function getCachedImageUriSync(fileIdOrKey: string): string | null {
  if (!fileIdOrKey || !fileIdOrKey.trim()) {
    return null;
  }
  const key = fileIdOrKey.trim();
  const entry = cacheIndex.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    cacheIndex.delete(key);
    return null;
  }
  return entry.localUri;
}

/**
 * Retrieve image URI on-demand:
 * 1. Checks local private cache first (Cache-Hit).
 * 2. Deduplicates concurrent in-flight downloads for the same fileId.
 * 3. If absent, downloads from storage into private app storage (avoiding eager downloads).
 * Supports dual-provider: Supabase Storage and Google Drive.
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

    const existingDownload = inFlightDownloads.get(cleanFileId);
    if (existingDownload) {
      return await existingDownload;
    }
  }

  const downloadPromise = (async () => {
    // 2. Download from storage into app-private cache storage
    await ensureCacheDirExists();
    const cacheDir = getCacheDir();
    const isSupabase =
      options?.storageProvider === 'SUPABASE' ||
      cleanFileId.startsWith('submissions/') ||
      cleanFileId.startsWith('users/') ||
      (cleanFileId.includes('/') && !cleanFileId.startsWith('http://') && !cleanFileId.startsWith('https://'));

    const safeFileId = cleanFileId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const prefix = isSupabase ? 'ppeye_supabase_' : 'ppeye_drive_';
    const destPath = `${cacheDir}${prefix}${safeFileId}.jpg`;

    let downloadResult: { uri: string; sizeBytes?: number };

    try {
      if (injectedDownloader) {
        downloadResult = await injectedDownloader(cleanFileId, destPath);
      } else if (isSupabase) {
        const { supabaseStorageService } = require('../services/storage/supabase-storage.client');
        const bucket = options?.bucket || (cleanFileId.startsWith('users/') ? 'avatars' : 'evidence');
        const dl = await supabaseStorageService.downloadFile(bucket, cleanFileId, destPath);
        downloadResult = { uri: dl.localUri, sizeBytes: dl.sizeBytes };
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
      fileName: `${prefix}${safeFileId}.jpg`,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      sizeBytes: downloadResult.sizeBytes ?? 0,
      isSensitive,
    };

    cacheIndex.set(cleanFileId, metadata);
    return downloadResult.uri;
  })();

  inFlightDownloads.set(cleanFileId, downloadPromise);
  try {
    return await downloadPromise;
  } finally {
    inFlightDownloads.delete(cleanFileId);
  }
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
  const preparedSource = preparedBySourceUri.get(sourceUri.trim());
  const cacheSourceUri = preparedSource?.uri ?? sourceUri;

  // Validate source file exists
  let sourceSize = 0;
  if (FS && typeof FS.getInfoAsync === 'function') {
    const info = await FS.getInfoAsync(cacheSourceUri);
    if (!info.exists) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        `Source image not found for caching: ${cacheSourceUri}`
      );
    }
    sourceSize = (info as any).size ?? 0;
  }

  await ensureCacheDirExists();
  const cacheDir = getCacheDir();
  const ext = getFileExtension(options?.customFileName ?? cacheSourceUri);
  const destFileName = options?.customFileName
    ? sanitizeFileName(options.customFileName)
    : `ppeye_cached_${sanitizeFileName(key)}.${ext}`;
  const destPath = `${cacheDir}${destFileName}`;

  // Copy preserving original quality (no compression)
  if (FS && typeof FS.copyAsync === 'function') {
    try {
      await FS.copyAsync({ from: cacheSourceUri, to: destPath });
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
  clearPreparedUploadCache();
}

/**
 * Helper to resolve image pixel dimensions using React Native's Image.getSize
 * with a safe timeout fallback so it never blocks or hangs in non-UI/test environments.
 */
function getImageDimensionsSafe(uri: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (dims: { width?: number; height?: number }) => {
      if (!settled) {
        settled = true;
        resolve(dims);
      }
    };

    const timer = setTimeout(() => finish({}), 600);

    try {
      const RN = require('react-native');
      if (RN?.Image?.getSize) {
        RN.Image.getSize(
          uri,
          (width: number, height: number) => {
            clearTimeout(timer);
            finish({ width, height });
          },
          () => {
            clearTimeout(timer);
            finish({});
          }
        );
        return;
      }
    } catch {
      // Ignore if react-native Image.getSize is unavailable
    }

    clearTimeout(timer);
    finish({});
  });
}

/**
 * Computes target dimensions constrained to `maxLongEdge` while preserving aspect ratio.
 */
export function computeTargetDimensions(
  width?: number,
  height?: number,
  maxLongEdge: number = DEFAULT_UPLOAD_MAX_LONG_EDGE
): { width?: number; height?: number; needsResize: boolean } {
  if (!width || !height || width <= 0 || height <= 0) {
    return { width, height, needsResize: false };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height, needsResize: false };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    needsResize: true,
  };
}

/**
 * Prepares a local image once right before upload:
 * - Resizes long edge to <= `maxLongEdge` (default 1920px, within 1600–2048px target)
 * - Compresses once as JPEG at `quality` (default 0.8, within 0.7–0.8 target)
 * - Keeps the original local file intact for retries (`originalUri`)
 * - Guarantees idempotency on retry: if called again with either the original URI
 *   or the already-prepared URI, returns the existing prepared image without re-compressing.
 */
export async function prepareImageForUpload(
  sourceUri: string,
  options?: PrepareImageForUploadOptions
): Promise<PreparedUploadImage> {
  if (!sourceUri || !sourceUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'Local image URI is required for upload preparation.'
    );
  }

  const trimmedUri = sourceUri.trim();
  const maxLongEdge = options?.maxLongEdge ?? DEFAULT_UPLOAD_MAX_LONG_EDGE;
  const quality = Math.min(1, Math.max(0.1, options?.quality ?? DEFAULT_UPLOAD_JPEG_QUALITY));
  const force = Boolean(options?.force || options?.forceRecompress);
  const FS = options?.fileSystem ?? getFileSystem();

  // 1. Guard against double-compression if caller passes an already-prepared output URI
  if (!force && (preparedOutputUris.has(trimmedUri) || trimmedUri.includes('_ppeye_opt_'))) {
    let existingSize: number | undefined;
    if (FS && typeof FS.getInfoAsync === 'function') {
      try {
        const info = await FS.getInfoAsync(trimmedUri);
        if (info?.exists) {
          existingSize = info.size;
        }
      } catch {
        // Ignore stat error
      }
    }
    return {
      uri: trimmedUri,
      originalUri: trimmedUri,
      originalSizeBytes: existingSize,
      preparedSizeBytes: existingSize,
      sizeBytes: existingSize,
      wasCompressed: false,
      reusedPrepared: true,
      mimeType: 'image/jpeg',
    };
  }

  // 2. Guard against re-compression on retry for the same original source URI
  if (!force) {
    const previouslyPrepared = preparedBySourceUri.get(trimmedUri);
    if (previouslyPrepared) {
      let stillExists = true;
      if (FS && typeof FS.getInfoAsync === 'function') {
        try {
          const info = await FS.getInfoAsync(previouslyPrepared.uri);
          stillExists = Boolean(info?.exists);
        } catch {
          stillExists = false;
        }
      }
      if (stillExists) {
        return {
          ...previouslyPrepared,
          wasCompressed: false,
          reusedPrepared: true,
        };
      }
      preparedBySourceUri.delete(trimmedUri);
    }
  }

  // 3. Verify original local file exists and measure original size
  let originalSizeBytes: number | undefined;
  if (FS && typeof FS.getInfoAsync === 'function') {
    const sourceInfo = await FS.getInfoAsync(trimmedUri);
    if (!sourceInfo || !sourceInfo.exists) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        `Local image does not exist at path: ${trimmedUri}`
      );
    }
    originalSizeBytes = sourceInfo.size;
  }

  const stagingFS = FS ?? getFileSystem();
  const stableOutputUri = getPreparedStagingUri(trimmedUri, maxLongEdge, quality, originalSizeBytes, stagingFS);
  if (!force && stagingFS && typeof stagingFS.getInfoAsync === 'function') {
    try {
      const stagedInfo = await stagingFS.getInfoAsync(stableOutputUri);
      if (stagedInfo?.exists && Number(stagedInfo.size) > 0) {
        const reused: PreparedUploadImage = {
          uri: stableOutputUri,
          originalUri: trimmedUri,
          originalSizeBytes,
          preparedSizeBytes: stagedInfo.size,
          sizeBytes: stagedInfo.size,
          wasCompressed: false,
          reusedPrepared: true,
          mimeType: 'image/jpeg',
        };
        preparedOutputUris.add(stableOutputUri);
        preparedBySourceUri.set(trimmedUri, reused);
        return reused;
      }
    } catch {
      // Rebuild a missing or unreadable staged file below.
    }
  }

  // 4. Inspect original dimensions and compute resize target (long edge <= 1920px)
  const originalDims = await getImageDimensionsSafe(trimmedUri);
  const targetDims = computeTargetDimensions(
    originalDims.width,
    originalDims.height,
    maxLongEdge
  );

  const manipulator = getImageManipulator();
  if (manipulator) {
    const actions: Array<{ resize: { width?: number; height?: number } }> = [];
    if (targetDims.needsResize && targetDims.width && targetDims.height) {
      actions.push({
        resize: { width: targetDims.width, height: targetDims.height },
      });
    } else if (!originalDims.width && !originalDims.height) {
      // If dimensions could not be read ahead of time, constrain width to maxLongEdge
      actions.push({
        resize: { width: maxLongEdge },
      });
    }

    const manipulated = await manipulator(trimmedUri, actions, {
      compress: quality,
      format: 'jpeg',
    });

    let preparedSizeBytes = manipulated.sizeBytes;
    if (stagingFS && typeof stagingFS.getInfoAsync === 'function') {
      try {
        const outInfo = await stagingFS.getInfoAsync(manipulated.uri);
        if (outInfo?.exists) {
          preparedSizeBytes = outInfo.size;
        }
      } catch {
        // Ignore stat error
      }
    }

    let outputUri = manipulated.uri;
    if (stagingFS && typeof stagingFS.copyAsync === 'function' && outputUri !== stableOutputUri) {
      try {
        const stagingDir = stableOutputUri.slice(0, stableOutputUri.lastIndexOf('/') + 1);
        if (typeof stagingFS.makeDirectoryAsync === 'function') {
          const dirInfo = await stagingFS.getInfoAsync?.(stagingDir);
          if (!dirInfo?.exists) await stagingFS.makeDirectoryAsync(stagingDir, { intermediates: true });
        }
        await stagingFS.copyAsync({ from: outputUri, to: stableOutputUri });
        outputUri = stableOutputUri;
        if (typeof stagingFS.getInfoAsync === 'function') {
          const stagedInfo = await stagingFS.getInfoAsync(outputUri);
          if (stagedInfo?.exists) preparedSizeBytes = stagedInfo.size;
        }
      } catch {
        // Retain the valid ImageManipulator output if staging copy is unavailable.
      }
    }

    const result: PreparedUploadImage = {
      uri: outputUri,
      originalUri: trimmedUri,
      width: manipulated.width ?? targetDims.width ?? originalDims.width,
      height: manipulated.height ?? targetDims.height ?? originalDims.height,
      originalSizeBytes,
      preparedSizeBytes,
      sizeBytes: preparedSizeBytes,
      wasCompressed: true,
      reusedPrepared: false,
      mimeType: 'image/jpeg',
    };

    preparedOutputUris.add(result.uri);
    preparedBySourceUri.set(trimmedUri, result);
    return result;
  }

  // 5. If the native module is unavailable, retain and upload the unchanged source.
  // Never label an unconverted source as a prepared JPEG.
  const fallbackResult: PreparedUploadImage = {
    uri: trimmedUri,
    originalUri: trimmedUri,
    width: targetDims.width ?? originalDims.width,
    height: targetDims.height ?? originalDims.height,
    originalSizeBytes,
    preparedSizeBytes: originalSizeBytes,
    sizeBytes: originalSizeBytes,
    wasCompressed: false,
    reusedPrepared: false,
    mimeType: undefined,
  };

  preparedBySourceUri.set(trimmedUri, fallbackResult);
  return fallbackResult;
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
