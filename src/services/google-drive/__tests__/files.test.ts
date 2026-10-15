/**
 * PPEye Google Drive Core File Operations Unit Tests (Mocked)
 *
 * Verifies:
 * - uploadFile (local URI validation, readability, MIME type, nonzero size, size limits, parent folder, reconciliation)
 * - getFile (metadata normalization, 404/trashed handling, 401 auth, 403 quota vs permission)
 * - fileExists (distinguishes missing files from permission/network/quota errors)
 * - downloadFile (app-private cache storage, metadata preservation)
 * - deleteFile (idempotent 200/204 and 404, error preservation)
 */

import {
  deleteFile,
  downloadFile,
  fileExists,
  getFile,
  setCustomFilesFetch,
  setFilesFSMock,
} from '../files';
import {
  setCustomUploadFetch,
  setFileSystemMock,
  uploadFile,
  validateLocalFile,
} from '../upload';
import {
  setGoogleSignInNativeModule,
  signOutFromGoogle,
} from '../auth';
import { isStorageError, StorageErrorCode } from '../../storage/storage.errors';

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

interface MockRemoteFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  thumbnailLink?: string;
  createdTime?: string;
}

export async function runFileOperationsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message ?? err}`);
      failed++;
    }
  }

  console.log('\n--- PPEye Google Drive File Operations Test Suite ---\n');

  // Shared mock remote files store
  let remoteDriveFiles: MockRemoteFile[] = [];
  let fileCounter = 500;

  let lastInitiatedMetadata: any = null;

  // Mock FileSystem
  const mockFS = {
    cacheDirectory: 'file:///data/user/0/com.tanjim.abubokor.PPEye/cache/',
    FileSystemUploadType: { BINARY_CONTENT: 0 },
    getInfoAsync: async (uri: string) => {
      if (uri.includes('non_existent')) {
        return { exists: false, isDirectory: false };
      }
      if (uri.includes('zero_size')) {
        return { exists: true, size: 0, isDirectory: false };
      }
      if (uri.includes('large_file')) {
        return { exists: true, size: 30 * 1024 * 1024, isDirectory: false }; // 30 MB
      }
      return { exists: true, size: 2048, isDirectory: false };
    },
    uploadAsync: async (sessionUri: string, localUri: string, options: any) => {
      fileCounter++;
      const newFile: MockRemoteFile = {
        id: `uploaded-drive-id-${fileCounter}`,
        name: lastInitiatedMetadata?.name ?? 'uploaded_photo.jpg',
        mimeType: lastInitiatedMetadata?.mimeType ?? options?.headers?.['Content-Type'] ?? 'image/jpeg',
        size: '2048',
        webViewLink: `https://drive.google.com/file/d/uploaded-drive-id-${fileCounter}/view`,
        thumbnailLink: `https://drive.google.com/thumbnail?id=uploaded-drive-id-${fileCounter}&sz=w800`,
        createdTime: new Date().toISOString(),
      };
      remoteDriveFiles.push(newFile);

      return {
        status: 200,
        body: JSON.stringify(newFile),
        headers: {},
      };
    },
    downloadAsync: async (url: string, destPath: string, options: any) => {
      return {
        status: 200,
        uri: destPath,
        headers: {},
      };
    },
  };

  setFileSystemMock(mockFS);
  setFilesFSMock(mockFS);

  // Mock Google Drive REST API Handler
  const mockDriveApiHandler = async (url: string, init?: RequestInit): Promise<Response> => {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const method = init?.method ?? 'GET';

    // 1. Initiate Resumable Upload
    if (pathname.includes('/upload/drive/v3/files')) {
      try {
        lastInitiatedMetadata = JSON.parse((init?.body as string) ?? '{}');
      } catch {
        lastInitiatedMetadata = null;
      }
      const locationUri = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock-upload-session-123';
      return new Response('', {
        status: 200,
        headers: {
          Location: locationUri,
        },
      });
    }

    // 2. GET /drive/v3/files/<id>
    if (method === 'GET' && pathname.includes('/files/')) {
      const parts = pathname.split('/files/');
      const fileId = decodeURIComponent(parts[1].split('?')[0]);

      if (fileId === 'error-401') {
        return new Response(JSON.stringify({ error: { message: 'Token expired', status: 'UNAUTHENTICATED' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (fileId === 'error-quota') {
        return new Response(
          JSON.stringify({
            error: {
              errors: [{ reason: 'rateLimitExceeded', message: 'User Rate Limit Exceeded' }],
              message: 'Rate Limit Exceeded',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (fileId === 'error-forbidden') {
        return new Response(
          JSON.stringify({
            error: {
              errors: [{ reason: 'insufficientFilePermissions', message: 'The user does not have permission' }],
              message: 'Permission denied',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const file = remoteDriveFiles.find((f) => f.id === fileId);
      if (!file) {
        return new Response(JSON.stringify({ error: { message: 'File not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(file), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. GET /drive/v3/files (list/search)
    if (method === 'GET' && pathname.endsWith('/files')) {
      const q = parsedUrl.searchParams.get('q') ?? '';
      let matching = [...remoteDriveFiles].filter((f) => !f.trashed);

      const nameMatch = q.match(/name\s*=\s*'([^']+)'/);
      if (nameMatch) {
        const targetName = nameMatch[1].replace(/\\'/g, "'");
        matching = matching.filter((f) => f.name === targetName);
      }

      const parentMatch = q.match(/'([^']+)'\s*in\s*parents/);
      if (parentMatch) {
        const targetParent = parentMatch[1];
        matching = matching.filter((f) => f.parents?.includes(targetParent));
      }

      return new Response(JSON.stringify({ files: matching }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. DELETE /drive/v3/files/<id>
    if (method === 'DELETE' && pathname.includes('/files/')) {
      const parts = pathname.split('/files/');
      const fileId = decodeURIComponent(parts[1]);

      if (fileId === 'delete-error-403') {
        return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const index = remoteDriveFiles.findIndex((f) => f.id === fileId);
      if (index === -1) {
        // Idempotent: 404 returned
        return new Response(JSON.stringify({ error: { message: 'File not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      remoteDriveFiles.splice(index, 1);
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ error: 'Unmocked route' }), { status: 400 });
  };

  setCustomUploadFetch(mockDriveApiHandler);
  setCustomFilesFetch(mockDriveApiHandler);

  // Setup mock Google Auth native module
  setGoogleSignInNativeModule({
    configure: () => {},
    hasPlayServices: async () => true,
    signIn: async () => null,
    signInSilently: async () => null,
    signOut: async () => {},
    revokeAccess: async () => {},
    hasPreviousSignIn: async () => true,
    getCurrentUser: async () => null,
    clearCachedAccessToken: async () => {},
    getTokens: async () => ({
      idToken: 'mock-id-token',
      accessToken: 'mock-access-token-777',
    }),
  });

  // Suite 1: Local File Validation
  console.log('• Suite: validateLocalFile');

  await test('validateLocalFile rejects empty local URI', async () => {
    await assertAsyncThrows(
      () => validateLocalFile('', 'image/jpeg'),
      StorageErrorCode.INVALID_INPUT,
      'Empty URI should reject'
    );
  });

  await test('validateLocalFile rejects non-existent local file', async () => {
    await assertAsyncThrows(
      () => validateLocalFile('file:///non_existent_path.jpg', 'image/jpeg'),
      StorageErrorCode.FILE_NOT_FOUND,
      'Missing local file should reject with FILE_NOT_FOUND'
    );
  });

  await test('validateLocalFile rejects zero-size empty file', async () => {
    await assertAsyncThrows(
      () => validateLocalFile('file:///zero_size_photo.jpg', 'image/jpeg'),
      StorageErrorCode.INVALID_INPUT,
      'Zero-size file should reject with INVALID_INPUT'
    );
  });

  await test('validateLocalFile rejects files exceeding maximum size limit', async () => {
    await assertAsyncThrows(
      () => validateLocalFile('file:///large_file.jpg', 'image/jpeg', 25 * 1024 * 1024),
      StorageErrorCode.INVALID_INPUT,
      'Oversized file should reject with INVALID_INPUT'
    );
  });

  await test('validateLocalFile rejects unsupported MIME type', async () => {
    await assertAsyncThrows(
      () => validateLocalFile('file:///some_video.mp4', 'video/mp4'),
      StorageErrorCode.INVALID_INPUT,
      'Unsupported MIME should reject with INVALID_INPUT'
    );
  });

  // Suite 2: uploadFile & Reconciliation
  console.log('\n• Suite: uploadFile & Reconciliation');

  await test('uploadFile uploads binary file and returns normalized DriveFile metadata', async () => {
    remoteDriveFiles = [];

    const driveFile = await uploadFile({
      localUri: 'file:///photo_to_upload.jpg',
      fileName: 'site_worker_front.jpg',
      mimeType: 'image/jpeg',
      folderId: 'folder-sub-1',
    });

    assert(driveFile.id.startsWith('uploaded-drive-id-'), 'Returned ID must be valid');
    assert(driveFile.name === 'site_worker_front.jpg', 'File name should match');
    assert(driveFile.mimeType === 'image/jpeg', 'MIME type should match');
    assert(driveFile.sizeBytes === 2048, 'File size should match');
    assert(Boolean(driveFile.webViewLink), 'webViewLink should be populated');
    assert(Boolean(driveFile.downloadUrl), 'downloadUrl should be populated');
  });

  await test('uploadFile reconciles uncertain outcome when file already exists with same size', async () => {
    // Seed an existing file in folder-sub-1 with identical name and matching size
    remoteDriveFiles.push({
      id: 'existing-reconciled-id-888',
      name: 'already_uploaded_photo.jpg',
      mimeType: 'image/jpeg',
      size: '2048',
      parents: ['folder-sub-1'],
      webViewLink: 'https://drive.google.com/file/d/existing-reconciled-id-888/view',
    });

    const fileCountBefore = remoteDriveFiles.length;

    // Call uploadFile for the exact same file
    const reconciled = await uploadFile({
      localUri: 'file:///valid_photo.jpg',
      fileName: 'already_uploaded_photo.jpg',
      mimeType: 'image/jpeg',
      folderId: 'folder-sub-1',
    });

    // Should return existing file metadata without calling uploadAsync or creating duplicates
    assert(reconciled.id === 'existing-reconciled-id-888', 'Should reconcile to existing file ID');
    assert(remoteDriveFiles.length === fileCountBefore, 'Should not add a duplicate file to Drive');
  });

  // Suite 3: getFile & fileExists (with Error Discrimination)
  console.log('\n• Suite: getFile & fileExists Error Discrimination');

  await test('getFile returns normalized metadata for an existing file', async () => {
    const file = await getFile('existing-reconciled-id-888');
    assert(file !== null, 'File should exist');
    assert(file?.name === 'already_uploaded_photo.jpg', 'File name should match');
    assert(file?.downloadUrl?.includes('existing-reconciled-id-888') === true, 'Download URL should be valid');
  });

  await test('getFile returns null for genuine 404 missing file', async () => {
    const file = await getFile('completely-unknown-file-id');
    assert(file === null, '404 should return null');
  });

  await test('getFile returns null for trashed file', async () => {
    remoteDriveFiles.push({
      id: 'trashed-file-id',
      name: 'trashed.jpg',
      mimeType: 'image/jpeg',
      size: '1024',
      trashed: true,
    });

    const file = await getFile('trashed-file-id');
    assert(file === null, 'Trashed file should return null');
  });

  await test('getFile throws AUTHENTICATION_REQUIRED on HTTP 401', async () => {
    await assertAsyncThrows(
      () => getFile('error-401'),
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'HTTP 401 should map to AUTHENTICATION_REQUIRED'
    );
  });

  await test('getFile distinguishes quota error from permission error on HTTP 403', async () => {
    await assertAsyncThrows(
      () => getFile('error-quota'),
      StorageErrorCode.PROVIDER_ERROR,
      'Quota error on 403 should map to PROVIDER_ERROR'
    );

    await assertAsyncThrows(
      () => getFile('error-forbidden'),
      StorageErrorCode.PERMISSION_DENIED,
      'Permission error on 403 should map to PERMISSION_DENIED'
    );
  });

  await test('fileExists returns true for existing file and false for 404', async () => {
    const exists = await fileExists('existing-reconciled-id-888');
    assert(exists === true, 'Should return true for existing file');

    const missing = await fileExists('non-existent-file-id');
    assert(missing === false, 'Should return false for 404 missing file');
  });

  await test('fileExists never swallows permission/quota errors into false', async () => {
    await assertAsyncThrows(
      () => fileExists('error-forbidden'),
      StorageErrorCode.PERMISSION_DENIED,
      'Permission error must NOT be silently swallowed into false'
    );
  });

  // Suite 4: downloadFile into Private Cache Storage
  console.log('\n• Suite: downloadFile');

  await test('downloadFile downloads image into app-private cache directory', async () => {
    const result = await downloadFile('existing-reconciled-id-888');

    assert(result.fileId === 'existing-reconciled-id-888', 'File ID should match');
    assert(result.localUri.includes('cache/'), 'Destination must be in private cache directory');
    assert(result.localUri.includes('ppeye_drive_'), 'Destination must include ppeye_drive prefix');
    assert(result.mimeType === 'image/jpeg', 'MIME type should match');
  });

  await test('downloadFile throws FILE_NOT_FOUND for non-existent file', async () => {
    await assertAsyncThrows(
      () => downloadFile('missing-file-id-xyz'),
      StorageErrorCode.FILE_NOT_FOUND,
      'Downloading missing file should throw FILE_NOT_FOUND'
    );
  });

  // Suite 5: deleteFile & Idempotency
  console.log('\n• Suite: deleteFile & Idempotency');

  await test('deleteFile deletes file and returns true', async () => {
    const countBefore = remoteDriveFiles.length;
    const deleted = await deleteFile('existing-reconciled-id-888');
    assert(deleted === true, 'Should return true on successful deletion');
    assert(remoteDriveFiles.length === countBefore - 1, 'File should be removed from remote files');
  });

  await test('deleteFile is idempotent and returns true if file is already 404 gone', async () => {
    // Calling deleteFile on an ID that does not exist on Drive returns 404
    const deletedAgain = await deleteFile('existing-reconciled-id-888');
    assert(deletedAgain === true, 'Idempotent deletion should return true for 404');
  });

  await test('deleteFile preserves and throws permission errors (403)', async () => {
    await assertAsyncThrows(
      () => deleteFile('delete-error-403'),
      StorageErrorCode.PERMISSION_DENIED,
      'Deletion 403 should throw PERMISSION_DENIED'
    );
  });

  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  // Clean up
  setCustomUploadFetch(null);
  setCustomFilesFetch(null);
  setFileSystemMock(null);
  setFilesFSMock(null);
  await signOutFromGoogle();

  return { passed, failed };
}
