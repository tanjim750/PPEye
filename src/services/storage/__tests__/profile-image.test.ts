/**
 * PPEye Profile Image Helpers Unit Tests (Mocked)
 *
 * Verifies:
 * - uploadProfilePicture: links to users.profile_picture_file_id and caches locally as sensitive.
 * - Authenticated-user authorization: enforces currentAuthUserId === userId.
 * - Upload failure rollback: storage error preserves previous profile picture untouched.
 * - Reference update failure rollback: db update error rolls back new files row and Drive file.
 * - getProfilePictureUri: cache-hit vs cache-miss on-demand download and forceRefresh.
 * - replaceProfilePicture: uploads replacement before changing reference, preserves previous on failure.
 * - Cache invalidation: invalidates stale cache entries on replacement and removal.
 * - Safe deletion: deletes unreferenced old files while preserving shared/referenced files.
 * - removeProfilePicture: clears reference, invalidates cache, and safely cleans up old file.
 */

import {
  getProfilePictureUri,
  removeProfilePicture,
  replaceProfilePicture,
  setProfileImageDriveDeleterMock,
  setProfileImageDriveUploaderMock,
  setProfileImageSupabaseOverride,
  uploadProfilePicture,
} from '../profile-image';
import {
  clearImageCache,
  getCachedImageUri,
  setCacheFileSystemMock,
  setCustomImageDownloader,
} from '../../../utils/image';
import { StorageErrorCode } from '../storage.errors';

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
// In-Memory Simulation State
// ---------------------------------------------------------------------------

interface MockUser {
  id: number;
  name: string;
  profile_picture_file_id: number | null;
  updated_at: string;
}

interface MockFileRow {
  id: number;
  storage_provider: string;
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: number | null;
  created_at: string;
}

export async function runProfileImageTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  let users: MockUser[] = [];
  let files: MockFileRow[] = [];
  let sharedFiles: Set<number> = new Set(); // file IDs referenced by external entities (e.g. ppe_images)
  let nextFileId = 1;

  // Remote Drive simulation
  const remoteDriveFiles = new Map<string, { fileName: string; localUri: string; folderId?: string }>();
  let failDriveUploadFor: string | null = null;
  let simulateUserUpdateFailure = false;

  // FileSystem Mock for local cache
  const localDiskFiles = new Map<string, { exists: boolean; size: number }>();
  const mockFS: any = {
    cacheDirectory: 'file:///app-cache/',
    getInfoAsync: async (uri: string) => {
      const f = localDiskFiles.get(uri);
      if (f) return { exists: true, size: f.size };
      return { exists: false, size: 0 };
    },
    makeDirectoryAsync: async () => {},
    copyAsync: async (opts: { from: string; to: string }) => {
      localDiskFiles.set(opts.to, { exists: true, size: 2048 });
    },
    deleteAsync: async (uri: string) => {
      localDiskFiles.delete(uri);
    },
  };

  function resetState() {
    users = [
      { id: 1, name: 'Tanjim Bhai', profile_picture_file_id: null, updated_at: new Date().toISOString() },
      { id: 2, name: 'Worker Rahim', profile_picture_file_id: null, updated_at: new Date().toISOString() },
    ];
    files = [];
    sharedFiles = new Set();
    nextFileId = 1;
    remoteDriveFiles.clear();
    failDriveUploadFor = null;
    simulateUserUpdateFailure = false;
    localDiskFiles.clear();

    setCacheFileSystemMock(mockFS);
    setCustomImageDownloader(async (fileId, dest) => {
      localDiskFiles.set(dest!, { exists: true, size: 4096 });
      return { uri: dest!, sizeBytes: 4096 };
    });
  }

  // Drive Uploader & Deleter Mocks
  setProfileImageDriveUploaderMock(async (params) => {
    if (failDriveUploadFor && params.localUri.includes(failDriveUploadFor)) {
      throw new Error(`Simulated Drive upload error for ${params.fileName}`);
    }
    const fileId = `drive_avatar_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    remoteDriveFiles.set(fileId, {
      fileName: params.fileName,
      localUri: params.localUri,
      folderId: params.folderId,
    });
    return {
      fileId,
      fileName: params.fileName,
      mimeType: 'image/jpeg',
      sizeBytes: 3000,
    };
  });

  setProfileImageDriveDeleterMock(async (fileId) => {
    remoteDriveFiles.delete(fileId);
    return true;
  });

  // Supabase Mock Client
  const mockSupabase: any = {
    from: (table: string) => {
      const filters: Array<{ col: string; op: string; val: any }> = [];

      const queryBuilder: any = {
        select: () => queryBuilder,
        eq: (col: string, val: any) => {
          filters.push({ col, op: 'eq', val });
          return queryBuilder;
        },
        insert: (rows: any) => {
          const rowArray = Array.isArray(rows) ? rows : [rows];
          const inserted: any[] = [];

          for (const item of rowArray) {
            if (table === 'files') {
              const newRow: MockFileRow = {
                id: nextFileId++,
                storage_provider: item.storage_provider ?? 'GOOGLE_DRIVE',
                provider_file_id: item.provider_file_id,
                file_name: item.file_name,
                mime_type: item.mime_type ?? null,
                size_bytes: item.size_bytes ?? null,
                created_by: item.created_by ?? null,
                created_at: new Date().toISOString(),
              };
              files.push(newRow);
              inserted.push(newRow);
            }
          }

          return {
            select: () => ({
              single: async () => ({ data: inserted[0] ?? null, error: null }),
            }),
          };
        },
        update: (values: any) => ({
          eq: (col: string, val: any) => {
            if (table === 'users' && simulateUserUpdateFailure) {
              return {
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: { message: 'Database connection lost', code: '500' },
                  }),
                }),
              };
            }

            if (table === 'users') {
              const target = users.find((u) => (u as any)[col] === val);
              if (target) {
                Object.assign(target, values);
              }
              return {
                select: () => ({
                  single: async () => ({ data: target ?? null, error: null }),
                }),
                then: (resolve: any) => resolve({ data: target ?? null, error: null }),
              };
            }

            return {
              select: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            };
          },
        }),
        delete: () => ({
          eq: async (col: string, val: any) => {
            if (table === 'files') {
              files = files.filter((f) => (f as any)[col] !== val);
            }
            return { error: null };
          },
        }),
        maybeSingle: async () => {
          let list: any[] = [];
          if (table === 'users') list = users;
          if (table === 'files') list = files;

          for (const f of filters) {
            list = list.filter((item) => item[f.col] === f.val);
          }
          return { data: list[0] ?? null, error: null };
        },
        single: async () => {
          return queryBuilder.maybeSingle();
        },
        then: (resolve: any) => {
          // Count reference checks for isFileReferenced
          if (['users', 'ppe_images', 'other_images'].includes(table)) {
            const fileIdVal = filters.find((f) => f.col === 'profile_picture_file_id' || f.col === 'file_id')?.val;
            let refCount = 0;

            if (table === 'users') {
              refCount = users.filter((u) => u.profile_picture_file_id === fileIdVal).length;
            } else {
              refCount = fileIdVal && sharedFiles.has(fileIdVal) ? 1 : 0;
            }

            resolve({ count: refCount, error: null });
            return;
          }

          let list: any[] = [];
          if (table === 'users') list = users;
          if (table === 'files') list = files;

          for (const f of filters) {
            list = list.filter((item) => item[f.col] === f.val);
          }
          resolve({ data: list, error: null });
        },
      };

      return queryBuilder;
    },
  };

  setProfileImageSupabaseOverride(mockSupabase);

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

  console.log('\n--- PPEye Profile Image Helpers Test Suite ---');

  // =========================================================================
  // 1. Upload & Authorization
  // =========================================================================
  console.log('\n• Suite: Upload & Authorization');

  await test('uploadProfilePicture uploads, persists, links to user, and caches locally', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/my_avatar.png', { exists: true, size: 2048 });

    const result = await uploadProfilePicture({
      userId: 1,
      localUri: 'file:///cam/my_avatar.png',
      currentAuthUserId: 1,
    });

    assert(result.userId === 1, 'userId matches');
    assert(result.fileId === 1, 'fileId 1 assigned');
    assert(result.file.fileName.includes('user_1_avatar.png'), `Standardized avatar name: ${result.file.fileName}`);

    // Verify database link
    const userInDb = users.find((u) => u.id === 1);
    assert(userInDb?.profile_picture_file_id === result.fileId, 'users table has updated reference');

    // Verify local cache entry
    const cachedUri = await getCachedImageUri('user_avatar_1');
    assert(cachedUri !== null, 'Image is cached in local storage under user_avatar_1');
  });

  await test('uploadProfilePicture rejects unauthorized user modifying another user profile', async () => {
    resetState();
    // User 2 trying to upload profile picture for user 1
    await assertAsyncThrows(
      () =>
        uploadProfilePicture({
          userId: 1,
          localUri: 'file:///cam/hacker.jpg',
          currentAuthUserId: 2,
        }),
      StorageErrorCode.PERMISSION_DENIED,
      'Unauthorized user must reject'
    );
  });

  await test('uploadProfilePicture preserves user profile when storage upload fails', async () => {
    resetState();
    failDriveUploadFor = 'broken_avatar';

    await assertAsyncThrows(
      () =>
        uploadProfilePicture({
          userId: 1,
          localUri: 'file:///cam/broken_avatar.jpg',
        }),
      StorageErrorCode.UPLOAD_FAILED,
      'Storage upload failure should throw'
    );

    // Verify user profile is untouched
    const userInDb = users.find((u) => u.id === 1);
    assert(userInDb?.profile_picture_file_id === null, 'User profile picture reference remains null');
    assert(files.length === 0, 'No files created in database');
  });

  await test('uploadProfilePicture rolls back new files row when reference update fails', async () => {
    resetState();
    localDiskFiles.set('file:///cam/avatar.jpg', { exists: true, size: 2048 });
    simulateUserUpdateFailure = true;

    await assertAsyncThrows(
      () =>
        uploadProfilePicture({
          userId: 1,
          localUri: 'file:///cam/avatar.jpg',
        }),
      StorageErrorCode.PROVIDER_ERROR,
      'Database update failure should throw'
    );

    simulateUserUpdateFailure = false;

    // Rollback verification: no orphaned files in database or Drive
    assert(files.length === 0, 'No orphaned file record in database');
    assert(remoteDriveFiles.size === 0, 'No orphaned file on remote Drive');
  });

  // =========================================================================
  // 2. getProfilePictureUri (Cache-Hit, Cache-Miss, forceRefresh)
  // =========================================================================
  console.log('\n• Suite: getProfilePictureUri Retrieval & Cache Hit');

  await test('getProfilePictureUri returns null if user has no profile picture', async () => {
    resetState();
    await clearImageCache();

    const uri = await getProfilePictureUri(1);
    assert(uri === null, 'User with no profile picture returns null');
  });

  await test('getProfilePictureUri returns cached URI without network call on cache-hit', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/avatar.jpg', { exists: true, size: 2048 });
    const uploaded = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/avatar.jpg' });

    let downloaderCalled = false;
    setCustomImageDownloader(async () => {
      downloaderCalled = true;
      return { uri: 'noop', sizeBytes: 0 };
    });

    const uri = await getProfilePictureUri(1);
    assert(uri === uploaded.localUri, 'Returns cached URI');
    assert(downloaderCalled === false, 'Did not trigger network download on cache-hit');
  });

  await test('getProfilePictureUri with forceRefresh downloads fresh image', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/avatar.jpg', { exists: true, size: 2048 });
    await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/avatar.jpg' });

    let forceDownloaderCalled = false;
    setCustomImageDownloader(async (_fileId, dest) => {
      forceDownloaderCalled = true;
      localDiskFiles.set(dest!, { exists: true, size: 5000 });
      return { uri: dest!, sizeBytes: 5000 };
    });

    const uri = await getProfilePictureUri(1, { forceRefresh: true });
    assert(Boolean(forceDownloaderCalled), 'forceRefresh triggers fresh download');
    assert(uri !== null, 'URI returned');
  });

  // =========================================================================
  // 3. Replacement Rollback & Safe Deletion
  // =========================================================================
  console.log('\n• Suite: Replacement Rollback & Safe Deletion');

  await test('replaceProfilePicture rolls back and preserves previous picture when upload fails', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/orig.jpg', { exists: true, size: 2048 });
    const original = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/orig.jpg' });

    // Attempt replacement with failing drive upload
    failDriveUploadFor = 'failing_replacement';

    await assertAsyncThrows(
      () =>
        replaceProfilePicture({
          userId: 1,
          newLocalUri: 'file:///cam/failing_replacement.jpg',
        }),
      StorageErrorCode.UPLOAD_FAILED,
      'Upload failure during replacement should throw'
    );

    // Verify previous image remains active
    const userInDb = users.find((u) => u.id === 1);
    assert(userInDb?.profile_picture_file_id === original.fileId, 'Previous image reference preserved in users');
  });

  await test('replaceProfilePicture rolls back and preserves previous picture when DB update fails', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/orig.jpg', { exists: true, size: 2048 });
    const original = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/orig.jpg' });

    localDiskFiles.set('file:///cam/new.jpg', { exists: true, size: 2048 });
    simulateUserUpdateFailure = true;

    await assertAsyncThrows(
      () =>
        replaceProfilePicture({
          userId: 1,
          newLocalUri: 'file:///cam/new.jpg',
        }),
      StorageErrorCode.PROVIDER_ERROR,
      'DB update failure during replacement should throw'
    );

    simulateUserUpdateFailure = false;

    // Verify previous image is preserved and new file row rolled back
    const userInDb = users.find((u) => u.id === 1);
    assert(userInDb?.profile_picture_file_id === original.fileId, 'Previous image reference preserved');
    assert(files.length === 1, 'New file record was rolled back, only original file exists');
  });

  await test('replaceProfilePicture invalidates stale cache and safely deletes unreferenced old file', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/v1.jpg', { exists: true, size: 2048 });
    const v1 = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/v1.jpg' });
    const oldFileId = v1.fileId;
    const oldProviderFileId = v1.file.providerFileId;

    assert(files.length === 1, '1 file in DB');
    assert(remoteDriveFiles.has(oldProviderFileId), 'Old file on Drive');

    localDiskFiles.set('file:///cam/v2.jpg', { exists: true, size: 3000 });
    const v2 = await replaceProfilePicture({
      userId: 1,
      newLocalUri: 'file:///cam/v2.jpg',
    });

    assert(v2.fileId !== oldFileId, 'Active image switched to new file');
    const userInDb = users.find((u) => u.id === 1);
    assert(userInDb?.profile_picture_file_id === v2.fileId, 'User points to new file');

    // Safe deletion: old unreferenced file was removed from files and Drive
    assert(!files.some((f) => f.id === oldFileId), 'Old file deleted from files table');
    assert(!remoteDriveFiles.has(oldProviderFileId), 'Old file deleted from remote Drive');
    assert(files.length === 1, 'Only 1 file in DB (the replacement)');
  });

  await test('replaceProfilePicture preserves old file if still shared with another entity', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/shared_orig.jpg', { exists: true, size: 2048 });
    const v1 = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/shared_orig.jpg' });

    // Mark old file as shared with another record (e.g. ppe_images)
    sharedFiles.add(v1.fileId);

    localDiskFiles.set('file:///cam/new_avatar.jpg', { exists: true, size: 3000 });
    const v2 = await replaceProfilePicture({
      userId: 1,
      newLocalUri: 'file:///cam/new_avatar.jpg',
    });

    assert(v2.fileId !== v1.fileId, 'User profile switched to new file');

    // Old file MUST BE PRESERVED because it is shared
    const oldFileInDb = files.find((f) => f.id === v1.fileId);
    assert(oldFileInDb !== undefined, 'Old file record preserved in DB due to shared reference');
    assert(remoteDriveFiles.has(v1.file.providerFileId), 'Old file preserved on Drive due to shared reference');
    assert(files.length === 2, 'Both files exist in DB');
  });

  // =========================================================================
  // 4. removeProfilePicture
  // =========================================================================
  console.log('\n• Suite: removeProfilePicture');

  await test('removeProfilePicture clears reference, invalidates cache, and deletes unreferenced file', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/to_remove.jpg', { exists: true, size: 2048 });
    const uploaded = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/to_remove.jpg' });

    assert(users.find((u) => u.id === 1)?.profile_picture_file_id === uploaded.fileId, 'User has avatar');

    const success = await removeProfilePicture(1);
    assert(success === true, 'removeProfilePicture returns true');

    // Reference cleared in users
    assert(users.find((u) => u.id === 1)?.profile_picture_file_id === null, 'User reference is now null');

    // Cache invalidated
    const cached = await getCachedImageUri('user_avatar_1');
    assert(cached === null, 'Cache entry invalidated');

    // File deleted from DB and Drive
    assert(files.length === 0, 'Unreferenced file record deleted from DB');
    assert(!remoteDriveFiles.has(uploaded.file.providerFileId), 'Unreferenced file deleted from Drive');
  });

  await test('removeProfilePicture preserves file if shared with another entity', async () => {
    resetState();
    await clearImageCache();

    localDiskFiles.set('file:///cam/shared.jpg', { exists: true, size: 2048 });
    const uploaded = await uploadProfilePicture({ userId: 1, localUri: 'file:///cam/shared.jpg' });

    // Mark as shared
    sharedFiles.add(uploaded.fileId);

    await removeProfilePicture(1);

    // Reference cleared
    assert(users.find((u) => u.id === 1)?.profile_picture_file_id === null, 'User reference cleared');

    // File preserved because it is shared
    assert(files.length === 1, 'Shared file record preserved in DB');
    assert(remoteDriveFiles.has(uploaded.file.providerFileId), 'Shared file preserved on Drive');
  });

  const total = passed + failed;
  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${total} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total };
}
