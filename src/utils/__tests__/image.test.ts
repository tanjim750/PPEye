/**
 * PPEye Image Utilities and Private Local Cache Unit Tests (Mocked)
 *
 * Verifies:
 * - Naming utilities (getFileExtension, getImageExtension, sanitizeFileName,
 *   generateUniqueFileName, generatePPEFileName, generateOtherFileName, generateProfileFileName)
 * - Private local cache (cacheImage, getCachedImageUri, getImageUri, invalidateImageCache)
 * - Cache-hit vs missing-file vs zero-byte eviction
 * - Non-eager downloads (lazy cache retrieval) and forceRefresh
 * - Quality preservation (direct copy without compression)
 * - TTL expiration & cleanupExpiredCache
 * - Sensitive cache clearance on logout/account switch (clearImageCache({ onlySensitive: true }))
 * - Full cache clearance (clearImageCache())
 * - Cache statistics (getCacheStats)
 */

import {
  cacheImage,
  clearImageCache,
  clearPreparedUploadCache,
  cleanupExpiredCache,
  computeTargetDimensions,
  DEFAULT_UPLOAD_JPEG_QUALITY,
  DEFAULT_UPLOAD_MAX_LONG_EDGE,
  generateOtherFileName,
  generatePPEFileName,
  generateProfileFileName,
  generateUniqueFileName,
  getCachedImageUri,
  getCacheStats,
  getFileExtension,
  getImageExtension,
  getImageUri,
  invalidateImageCache,
  prepareImageForUpload,
  sanitizeFileName,
  selectOptimalCameraPictureSize,
  setCacheFileSystemMock,
  setCustomImageDownloader,
  setCustomImageManipulator,
} from '../image';
import { isStorageError, StorageErrorCode } from '../../services/storage/storage.errors';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function assertAsyncThrows(
  promiseFn: () => Promise<any>,
  expectedCode?: string,
  message?: string
): Promise<void> {
  let threw = false;
  try {
    await promiseFn();
  } catch (err: any) {
    threw = true;
    if (expectedCode) {
      assert(
        err?.code === expectedCode,
        `Expected error code '${expectedCode}', received '${err?.code}' (${err?.message}): ${message}`
      );
    }
  }
  assert(threw, `Expected async function to throw, but it succeeded: ${message}`);
}

// ---------------------------------------------------------------------------
// In-Memory Mock FileSystem
// ---------------------------------------------------------------------------

interface MockFileInfo {
  exists: boolean;
  size: number;
  isDirectory?: boolean;
}

class MockFileSystem {
  public cacheDirectory = 'file:///data/user/0/com.ppeye/cache/';
  public files = new Map<string, MockFileInfo>();
  public copyCalls: Array<{ from: string; to: string }> = [];
  public deleteCalls: string[] = [];
  public makeDirCalls: string[] = [];

  reset(): void {
    this.files.clear();
    this.copyCalls = [];
    this.deleteCalls = [];
    this.makeDirCalls = [];
  }

  setFile(uri: string, size: number = 1024): void {
    this.files.set(uri, { exists: true, size, isDirectory: false });
  }

  async getInfoAsync(uri: string): Promise<MockFileInfo> {
    const file = this.files.get(uri);
    if (file) {
      return { ...file };
    }
    // Check if directory exists
    if (this.makeDirCalls.includes(uri) || uri.endsWith('/')) {
      return { exists: true, size: 0, isDirectory: true };
    }
    return { exists: false, size: 0, isDirectory: false };
  }

  async makeDirectoryAsync(uri: string, _options?: any): Promise<void> {
    this.makeDirCalls.push(uri);
    this.files.set(uri, { exists: true, size: 0, isDirectory: true });
  }

  async copyAsync(options: { from: string; to: string }): Promise<void> {
    this.copyCalls.push(options);
    const source = this.files.get(options.from);
    const size = source ? source.size : 2048;
    this.files.set(options.to, { exists: true, size, isDirectory: false });
  }

  async deleteAsync(uri: string, _options?: any): Promise<void> {
    this.deleteCalls.push(uri);
    // Delete file or all keys starting with uri if directory
    if (this.files.has(uri)) {
      this.files.delete(uri);
    }
    for (const key of Array.from(this.files.keys())) {
      if (key.startsWith(uri)) {
        this.files.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test Suite Runner
// ---------------------------------------------------------------------------

export async function runImageTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;
  const mockFS = new MockFileSystem();

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed++;
      console.log(`  ✔ [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✖ [FAIL] ${name}`);
      console.error(`    ${err?.stack ?? err?.message ?? err}`);
    }
  };

  console.log('\n--- PPEye Image Utilities & Private Cache Test Suite ---');

  // =========================================================================
  // 1. File Naming & Path Utilities
  // =========================================================================
  console.log('\n• Suite: File Naming & Path Utilities');

  await test('getFileExtension handles standard filenames, paths, and URLs', () => {
    assert(getFileExtension('photo.jpg') === 'jpg', 'photo.jpg should return jpg');
    assert(getFileExtension('/var/mobile/Containers/photo.PNG') === 'png', 'photo.PNG should return png');
    assert(
      getFileExtension('https://cdn.example.com/images/worker.jpeg?size=large#preview') === 'jpeg',
      'URL with query and hash should return jpeg'
    );
    assert(getFileExtension('archive.tar.gz') === 'gz', 'multiple dots should extract final extension');
    assert(getFileExtension('no_extension_file') === 'jpg', 'no extension should default to jpg');
    assert(getFileExtension('') === 'jpg', 'empty string should default to jpg');
    assert(getFileExtension(null as any) === 'jpg', 'null should default to jpg');
  });

  await test('getImageExtension is a backward-compatible alias of getFileExtension', () => {
    assert(getImageExtension === getFileExtension, 'getImageExtension must strictly equal getFileExtension');
    assert(getImageExtension('image.webp') === 'webp', 'getImageExtension should extract webp');
  });

  await test('sanitizeFileName sanitizes special characters, whitespace, and collapses underscores', () => {
    assert(sanitizeFileName('site_alpha') === 'site_alpha', 'clean filename unchanged');
    assert(
      sanitizeFileName('Plant #4 / Sector (North) - 1.jpg') === 'Plant_4_Sector_North_1.jpg',
      'replaces spaces and special chars with underscores'
    );
    assert(sanitizeFileName('___trimmed___') === 'trimmed', 'strips leading and trailing underscores');
    assert(sanitizeFileName('') === 'file', 'empty string defaults to file');
    assert(sanitizeFileName('   ') === 'file', 'whitespace-only string defaults to file');
    assert(sanitizeFileName(null as any) === 'file', 'null defaults to file');
  });

  await test('generateUniqueFileName includes prefix, timestamp, random entropy, and extension', () => {
    const name1 = generateUniqueFileName('ppe_inspect', 'png');
    const name2 = generateUniqueFileName('ppe_inspect', 'png');

    assert(name1.startsWith('ppe_inspect_'), `name1 should start with prefix: ${name1}`);
    assert(name1.endsWith('.png'), `name1 should end with .png: ${name1}`);
    assert(name1 !== name2, 'subsequent calls must produce unique names');

    // Test with complex prefix and default extension
    const name3 = generateUniqueFileName('Sector #9 / Unit A');
    assert(name3.startsWith('Sector_9_Unit_A_'), `sanitizes prefix: ${name3}`);
    assert(name3.endsWith('.jpg'), `defaults to .jpg: ${name3}`);
  });

  await test('generatePPEFileName generates standardized worker inspection photo name', () => {
    const frontName = generatePPEFileName('Main Site #1', 3, 'FRONT', 'jpg');
    assert(
      frontName === 'Main_Site_1_w3_front.jpg',
      `Unexpected front photo name: ${frontName}`
    );

    const backName = generatePPEFileName('Main Site #1', 3, 'BACK', 'png');
    assert(
      backName === 'Main_Site_1_w3_back.png',
      `Unexpected back photo name: ${backName}`
    );
  });

  await test('generateOtherFileName generates standardized hazard/other photo name', () => {
    const otherName = generateOtherFileName('Substation B / East', 4, 'jpg');
    assert(
      otherName === 'Substation_B_East_other_4.jpg',
      `Unexpected other photo name: ${otherName}`
    );
  });

  await test('generateProfileFileName generates standardized user avatar file name', () => {
    const profileNameStr = generateProfileFileName('usr_abc_123', 'png');
    assert(
      profileNameStr === 'user_usr_abc_123_avatar.png',
      `Unexpected profile name: ${profileNameStr}`
    );

    const profileNameNum = generateProfileFileName(42);
    assert(
      profileNameNum === 'user_42_avatar.jpg',
      `Unexpected profile name: ${profileNameNum}`
    );
  });

  // =========================================================================
  // 2. Private Local Cache Operations
  // =========================================================================
  console.log('\n• Suite: Private Local Cache Operations');

  await test('cacheImage validates inputs and throws INVALID_INPUT on empty parameters', async () => {
    await assertAsyncThrows(
      () => cacheImage('', 'file:///source.jpg'),
      StorageErrorCode.INVALID_INPUT,
      'empty fileIdOrKey'
    );
    await assertAsyncThrows(
      () => cacheImage('key1', ''),
      StorageErrorCode.INVALID_INPUT,
      'empty sourceUri'
    );
  });

  await test('cacheImage throws FILE_NOT_FOUND when source file does not exist on disk', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    await assertAsyncThrows(
      () => cacheImage('missing_file_key', 'file:///nonexistent/path/pic.jpg'),
      StorageErrorCode.FILE_NOT_FOUND,
      'missing source file'
    );
  });

  await test('cacheImage preserves quality with direct copy and registers in cache index', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/original_photo.jpg';
    mockFS.setFile(sourceUri, 4194304); // 4MB uncompressed original photo

    const cachedPath = await cacheImage('photo_item_1', sourceUri, {
      isSensitive: true,
      customFileName: 'worker_inspection_hi_res.jpg',
    });

    assert(cachedPath.includes('worker_inspection_hi_res.jpg'), `Path matches custom name: ${cachedPath}`);
    assert(mockFS.copyCalls.length === 1, 'copyAsync called exactly once');
    assert(mockFS.copyCalls[0].from === sourceUri, 'copy source matches original photo');
    assert(mockFS.copyCalls[0].to === cachedPath, 'copy destination matches cache path');

    const cachedFile = mockFS.files.get(cachedPath);
    assert(cachedFile !== undefined && cachedFile.exists, 'cached file exists in mock FS');
    assert(cachedFile?.size === 4194304, 'cached file size exactly matches source file size (no compression)');

    // Verify cache index entry
    const stats = getCacheStats();
    assert(stats.count === 1, `Expected 1 cached item, got ${stats.count}`);
    assert(stats.totalSizeBytes === 4194304, `Expected 4MB total size, got ${stats.totalSizeBytes}`);
  });

  await test('getCachedImageUri returns cached URI on cache hit', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/inspect.jpg';
    mockFS.setFile(sourceUri, 2048);
    const cachedPath = await cacheImage('key_hit', sourceUri);

    const hit = await getCachedImageUri('key_hit');
    assert(hit === cachedPath, `Expected hit to equal ${cachedPath}, got ${hit}`);
  });

  await test('getCachedImageUri returns null on cache miss', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const result = await getCachedImageUri('unknown_key_999');
    assert(result === null, 'Unknown key must return null');
    assert((await getCachedImageUri('')) === null, 'Empty key must return null');
  });

  await test('getCachedImageUri evicts and returns null if cached file was deleted on disk', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/to_delete.jpg';
    mockFS.setFile(sourceUri, 2048);
    const cachedPath = await cacheImage('disk_evict_test', sourceUri);

    // Simulate external disk cleanup / OS purge
    mockFS.files.delete(cachedPath);

    const result = await getCachedImageUri('disk_evict_test');
    assert(result === null, 'Missing file on disk must return null');
    assert(getCacheStats().count === 0, 'Entry should have been evicted from cache index');
  });

  await test('getCachedImageUri evicts and returns null if cached file is 0 bytes (corrupt)', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/corrupt.jpg';
    mockFS.setFile(sourceUri, 2048);
    const cachedPath = await cacheImage('corrupt_test', sourceUri);

    // Simulate corrupted 0-byte file
    mockFS.setFile(cachedPath, 0);

    const result = await getCachedImageUri('corrupt_test');
    assert(result === null, 'Zero-byte file must return null');
    assert(getCacheStats().count === 0, 'Corrupt zero-byte entry should have been evicted');
  });

  await test('getCachedImageUri evicts and returns null if cache entry is expired by TTL', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/expired.jpg';
    mockFS.setFile(sourceUri, 1024);
    // 1 millisecond TTL
    await cacheImage('expired_test', sourceUri, { ttlMs: 1 });

    // Wait 15ms for expiration
    await new Promise((r) => setTimeout(r, 15));

    const result = await getCachedImageUri('expired_test');
    assert(result === null, 'Expired entry must return null');
    assert(getCacheStats().count === 0, 'Expired entry should have been evicted');
  });

  // =========================================================================
  // 3. On-Demand Image Retrieval (Lazy vs Eager Downloads)
  // =========================================================================
  console.log('\n• Suite: On-Demand Image Retrieval (getImageUri)');

  await test('getImageUri avoids eager downloads on cache hit', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/already_cached.jpg';
    mockFS.setFile(sourceUri, 2048);
    const cachedPath = await cacheImage('drive_file_100', sourceUri);

    let downloaderCalled: boolean = false;
    setCustomImageDownloader(async () => {
      downloaderCalled = true;
      return { uri: 'file:///downloaded/file.jpg', sizeBytes: 1024 };
    });

    const result = await getImageUri('drive_file_100');
    assert(result === cachedPath, 'Should return existing cached URI');
    assert(downloaderCalled === false, 'Must NOT trigger download when cache-hit occurs (avoids eager download)');
  });

  await test('getImageUri downloads and caches when item is not in cache (cache miss)', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    let downloadedFileId = '';
    let downloadedDest = '';
    setCustomImageDownloader(async (fileId, dest) => {
      downloadedFileId = fileId;
      downloadedDest = dest ?? '';
      mockFS.setFile(dest!, 5000);
      return { uri: dest!, sizeBytes: 5000 };
    });

    const uri = await getImageUri('drive_file_200', { isSensitive: true });
    assert(downloadedFileId === 'drive_file_200', 'Downloader called with correct fileId');
    assert(uri === downloadedDest, `Returned URI matches downloaded destination: ${uri}`);
    assert(mockFS.files.has(uri), 'Downloaded file exists in file system');

    // Subsequent retrieval is a cache-hit
    let secondDownloadCalled: boolean = false;
    setCustomImageDownloader(async () => {
      secondDownloadCalled = true;
      return { uri: 'noop', sizeBytes: 0 };
    });

    const secondUri = await getImageUri('drive_file_200');
    assert(secondUri === uri, 'Second retrieval returns same cached URI');
    assert(secondDownloadCalled === false, 'Second retrieval does not re-download');
  });

  await test('getImageUri with forceRefresh forces fresh download despite cache hit', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/existing.jpg';
    mockFS.setFile(sourceUri, 2048);
    await cacheImage('drive_file_300', sourceUri);

    let forceDownloadCalled: boolean = false;
    setCustomImageDownloader(async (fileId, dest) => {
      forceDownloadCalled = true;
      mockFS.setFile(dest!, 3000);
      return { uri: dest!, sizeBytes: 3000 };
    });

    const uri = await getImageUri('drive_file_300', { forceRefresh: true });
    assert(Boolean(forceDownloadCalled), 'forceRefresh must call downloader');
    assert(uri.includes('ppeye_drive_drive_file_300.jpg'), `URI matches fresh destination: ${uri}`);
  });

  await test('getImageUri wraps downloader failures into DOWNLOAD_FAILED StorageError', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    setCustomImageDownloader(async () => {
      throw new Error('Network connection dropped');
    });

    await assertAsyncThrows(
      () => getImageUri('drive_fail_test'),
      StorageErrorCode.DOWNLOAD_FAILED,
      'Downloader failure should throw DOWNLOAD_FAILED'
    );
  });

  // =========================================================================
  // 4. Invalidation, Expiration Cleanup, and Sensitive Clearance
  // =========================================================================
  console.log('\n• Suite: Invalidation, Expiration & Sensitive Clearance');

  await test('invalidateImageCache deletes file from disk and evicts cache entry', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const sourceUri = 'file:///camera/inv.jpg';
    mockFS.setFile(sourceUri, 1024);
    const cachedPath = await cacheImage('inv_item', sourceUri);

    assert(mockFS.files.has(cachedPath), 'file exists before invalidation');
    const removed = await invalidateImageCache('inv_item');
    assert(removed === true, 'invalidateImageCache returns true for existing key');
    assert(!mockFS.files.has(cachedPath), 'file removed from disk');
    assert((await getCachedImageUri('inv_item')) === null, 'key evicted from cache index');

    const removedAgain = await invalidateImageCache('inv_item');
    assert(removedAgain === false, 'second invalidation returns false');
  });

  await test('cleanupExpiredCache purges only expired items by TTL or maxAgeMs', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const source1 = 'file:///camera/item1.jpg';
    const source2 = 'file:///camera/item2.jpg';
    mockFS.setFile(source1, 1024);
    mockFS.setFile(source2, 1024);

    // item 1 expires in 5ms
    await cacheImage('item_short_ttl', source1, { ttlMs: 5 });
    // item 2 expires in 1 day
    await cacheImage('item_long_ttl', source2, { ttlMs: 86400000 });

    await new Promise((r) => setTimeout(r, 15));

    const cleanedCount = await cleanupExpiredCache();
    assert(cleanedCount === 1, `Expected 1 expired item cleaned, got ${cleanedCount}`);
    assert((await getCachedImageUri('item_short_ttl')) === null, 'item_short_ttl is evicted');
    assert((await getCachedImageUri('item_long_ttl')) !== null, 'item_long_ttl remains in cache');
  });

  await test('clearImageCache({ onlySensitive: true }) purges only sensitive images (logout flow)', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const s1 = 'file:///cam/s1.jpg';
    const s2 = 'file:///cam/s2.jpg';
    const s3 = 'file:///cam/s3.jpg';
    mockFS.setFile(s1, 100);
    mockFS.setFile(s2, 200);
    mockFS.setFile(s3, 300);

    const pathSensitiveWorker = await cacheImage('worker_inspection_photo', s1, { isSensitive: true });
    const pathSensitiveProfile = await cacheImage('user_avatar_photo', s2, { isSensitive: true });
    const pathPublicThumbnail = await cacheImage('app_brand_logo', s3, { isSensitive: false });

    assert(getCacheStats().count === 3, '3 items in cache');

    // Trigger sensitive clear (simulating user logout or account switch)
    await clearImageCache({ onlySensitive: true });

    // Sensitive items are deleted
    assert((await getCachedImageUri('worker_inspection_photo')) === null, 'sensitive worker photo evicted');
    assert((await getCachedImageUri('user_avatar_photo')) === null, 'sensitive profile photo evicted');
    assert(!mockFS.files.has(pathSensitiveWorker), 'worker photo deleted from disk');
    assert(!mockFS.files.has(pathSensitiveProfile), 'profile photo deleted from disk');

    // Non-sensitive items remain untouched
    const pubUri = await getCachedImageUri('app_brand_logo');
    assert(pubUri === pathPublicThumbnail, 'non-sensitive item remains in cache');
    assert(mockFS.files.has(pathPublicThumbnail), 'non-sensitive item preserved on disk');
    assert(getCacheStats().count === 1, 'cache stats reflect 1 remaining item');
  });

  await test('clearImageCache() wipes all cached files and resets index completely', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    const s1 = 'file:///cam/1.jpg';
    const s2 = 'file:///cam/2.jpg';
    mockFS.setFile(s1, 100);
    mockFS.setFile(s2, 200);

    await cacheImage('img1', s1);
    await cacheImage('img2', s2);
    assert(getCacheStats().count === 2, '2 items in cache');

    await clearImageCache();
    assert(getCacheStats().count === 0, 'all items evicted from cache index');
    assert((await getCachedImageUri('img1')) === null, 'img1 null');
    assert((await getCachedImageUri('img2')) === null, 'img2 null');
  });

  // =========================================================================
  // 5. Pre-Upload Compression, Retry Idempotency & Deduplication
  // =========================================================================
  console.log('\n• Suite: Pre-Upload Compression & Retry Idempotency');

  await test('computeTargetDimensions scales 12MP photos down to 1920px long edge while preserving aspect ratio', () => {
    const portrait = computeTargetDimensions(3024, 4032, DEFAULT_UPLOAD_MAX_LONG_EDGE);
    assert(portrait.needsResize === true, '12MP portrait should need resize');
    assert(portrait.height === 1920, `Expected height 1920, got ${portrait.height}`);
    assert(portrait.width === 1440, `Expected width 1440, got ${portrait.width}`);

    const small = computeTargetDimensions(1200, 1600, DEFAULT_UPLOAD_MAX_LONG_EDGE);
    assert(small.needsResize === false, '1600px long edge should not be upscaled');
    assert(small.width === 1200 && small.height === 1600, 'Dimensions stay intact');
  });

  await test('selectOptimalCameraPictureSize picks 1920x1440 within 1600–2048px window', () => {
    const available = ['4032x3024', '3840x2160', '2560x1920', '1920x1440', '1920x1080', '1280x960'];
    const best = selectOptimalCameraPictureSize(available, DEFAULT_UPLOAD_MAX_LONG_EDGE);
    assert(best === '1920x1440', `Expected 1920x1440, got ${best}`);
  });

  await test('prepareImageForUpload compresses once, keeps original file intact, and skips re-compression on retry', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    clearPreparedUploadCache();

    const rawCaptureUri = 'file:///camera/DCIM_12mp_worker_front.jpg';
    const rawSize = 2_450_000; // ~2.45 MB raw capture
    const compressedSize = 263_000; // ~263 KB compressed
    mockFS.setFile(rawCaptureUri, rawSize);

    let manipulatorCallCount = 0;
    let capturedQuality = 0;
    setCustomImageManipulator(async (_uri, _actions, saveOptions) => {
      manipulatorCallCount++;
      capturedQuality = saveOptions.compress;
      const outUri = `${mockFS.cacheDirectory}ppeye_upload_staging/worker_front_ppeye_opt_1920.jpg`;
      mockFS.setFile(outUri, compressedSize);
      return {
        uri: outUri,
        width: 1440,
        height: 1920,
        sizeBytes: compressedSize,
      };
    });

    // First preparation before upload
    const first = await prepareImageForUpload(rawCaptureUri);
    assert(manipulatorCallCount === 1, 'Manipulator called exactly once on initial upload');
    assert(
      Math.abs(capturedQuality - DEFAULT_UPLOAD_JPEG_QUALITY) < 0.001,
      `Expected quality ${DEFAULT_UPLOAD_JPEG_QUALITY}, got ${capturedQuality}`
    );
    assert(first.wasCompressed === true, 'First pass marks wasCompressed = true');
    assert(first.reusedPrepared === false, 'First pass marks reusedPrepared = false');
    assert(first.originalUri === rawCaptureUri, 'Preserves originalUri reference');
    assert(first.originalSizeBytes === rawSize, 'Reports originalSizeBytes');
    assert(first.preparedSizeBytes === compressedSize, 'Reports compressed preparedSizeBytes');

    // Original local file MUST remain untouched on disk for retry safety
    const origInfo = await mockFS.getInfoAsync(rawCaptureUri);
    assert(origInfo.exists && origInfo.size === rawSize, 'Original local file remains intact on disk');

    const cachedPrepared = await cacheImage('drive_prepared_worker', rawCaptureUri, { isSensitive: true });
    const lastCopy = mockFS.copyCalls[mockFS.copyCalls.length - 1];
    assert(lastCopy?.from === first.uri, 'Reviewer cache copies the resized upload image, not the full source');
    assert(cachedPrepared.length > 0, 'Prepared reviewer cache URI is returned');

    // Simulate upload retry with the SAME original URI -> must NOT re-compress
    const retryFromOriginal = await prepareImageForUpload(rawCaptureUri);
    assert(manipulatorCallCount === 1, 'Retry with original URI must NOT call manipulator again');
    assert(retryFromOriginal.uri === first.uri, 'Retry returns identical prepared URI');
    assert(retryFromOriginal.reusedPrepared === true, 'Retry marks reusedPrepared = true');
    assert(retryFromOriginal.wasCompressed === false, 'Retry marks wasCompressed = false');

    // Simulate a new JS process: the deterministic staged file survives even after maps clear.
    clearPreparedUploadCache();
    const retryAfterRestart = await prepareImageForUpload(rawCaptureUri);
    assert(manipulatorCallCount === 1, 'Retry after in-memory state is cleared reuses disk output');
    assert(retryAfterRestart.uri === first.uri, 'Retry after restart returns the deterministic prepared file');
    assert(retryAfterRestart.reusedPrepared, 'Disk-staged image is marked as reused');

    // Simulate nested call passing the ALREADY-COMPRESSED URI -> must NOT double-compress
    const retryFromPrepared = await prepareImageForUpload(first.uri);
    assert(manipulatorCallCount === 1, 'Passing already-prepared URI must NOT double-compress');
    assert(retryFromPrepared.uri === first.uri, 'Returns same prepared URI');
    assert(retryFromPrepared.reusedPrepared === true, 'Marks reusedPrepared = true');
  });

  await test('getImageUri deduplicates concurrent in-flight downloads for the same fileId', async () => {
    mockFS.reset();
    setCacheFileSystemMock(mockFS);
    await clearImageCache();

    let downloadCount = 0;
    setCustomImageDownloader(async (_fileId, dest) => {
      downloadCount++;
      await new Promise((r) => setTimeout(r, 20));
      mockFS.setFile(dest!, 4096);
      return { uri: dest!, sizeBytes: 4096 };
    });

    const [uriA, uriB, uriC] = await Promise.all([
      getImageUri('concurrent_provider_file_id_77'),
      getImageUri('concurrent_provider_file_id_77'),
      getImageUri('concurrent_provider_file_id_77'),
    ]);

    assert(uriA === uriB && uriB === uriC, 'All concurrent callers receive identical local URI');
    assert(downloadCount === 1, `Expected 1 network download for 3 concurrent requests, got ${downloadCount}`);
  });

  // Clean up test mocks so subsequent test suites in the same process are unaffected
  setCacheFileSystemMock(null);
  setCustomImageDownloader(null);
  setCustomImageManipulator(null);
  clearPreparedUploadCache();

  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${total} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total };
}
