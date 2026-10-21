/**
 * PPEye Google Drive Client & Folder Service Unit Tests (Mocked)
 *
 * Verifies:
 * - initializeDrive, isDriveReady, ensureDriveReady
 * - findFolderByName (existing vs missing)
 * - createFolder
 * - ensureRootFolder, ensureFolder, hierarchy resolution (PPEye/submissions, PPEye/profiles)
 * - In-memory caching and stale ID recovery (404 / trashed validation)
 * - Concurrent deduplication lock (preventing duplicate folder creation)
 * - API error handling (401/403/500 wrapping)
 */

import {
  clearFolderCache,
  createFolder,
  DEFAULT_ROOT_FOLDER_NAME,
  ensureDriveReady,
  ensureFolder,
  ensureRootFolder,
  findFolderByName,
  getDriveClient,
  getProfileFolderId,
  getSubmissionFolderId,
  initializeDrive,
  isDriveReady,
  setCustomDriveFetch,
  validateFolder,
} from '../folders';
import {
  setGoogleSignInNativeModule,
  signOutFromGoogle,
} from '../auth';
import { StorageErrorCode } from '../../storage/storage.errors';

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

interface MockDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
}

export async function runFoldersTests(): Promise<{ passed: number; failed: number }> {
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

  console.log('\n--- PPEye Google Drive Folder Service Test Suite ---\n');

  // In-memory mock Drive filesystem store
  let mockDriveFiles: MockDriveFile[] = [];
  let fileIdCounter = 100;
  let networkFailuresActive = false;
  let failureStatusCode = 500;

  // Custom fetch mock simulating Google Drive v3 REST API
  setCustomDriveFetch(async (url: string, init?: RequestInit): Promise<Response> => {
    if (networkFailuresActive) {
      return new Response(JSON.stringify({ error: 'Server error' }), {
        status: failureStatusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const method = init?.method ?? 'GET';

    // 1. GET /drive/v3/files/<id> (validate folder)
    if (method === 'GET' && pathname.includes('/files/')) {
      const parts = pathname.split('/files/');
      const fileId = decodeURIComponent(parts[1]);
      const file = mockDriveFiles.find((f) => f.id === fileId);

      if (!file || file.trashed) {
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

    // 2. GET /drive/v3/files (list/search)
    if (method === 'GET' && pathname.endsWith('/files')) {
      const q = parsedUrl.searchParams.get('q') ?? '';
      let matching = [...mockDriveFiles].filter((f) => !f.trashed);

      // Simple parser for standard query parts: name = '...' and '...' in parents
      const nameMatch = q.match(/name\s*=\s*'([^']+)'/);
      if (nameMatch) {
        const targetName = nameMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
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

    // 3. POST /drive/v3/files (create folder)
    if (method === 'POST' && pathname.endsWith('/files')) {
      const body = JSON.parse((init?.body as string) ?? '{}');
      fileIdCounter++;
      const newFile: MockDriveFile = {
        id: `folder-id-${fileIdCounter}`,
        name: body.name,
        mimeType: body.mimeType ?? 'application/vnd.google-apps.folder',
        parents: body.parents,
        trashed: false,
      };
      mockDriveFiles.push(newFile);

      return new Response(JSON.stringify(newFile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not handled in mock' }), { status: 400 });
  });

  // Setup mock Google Auth native module so token acquisition succeeds
  setGoogleSignInNativeModule({
    configure: () => {},
    hasPlayServices: async () => true,
    signIn: async () => ({ user: { id: 'test-user', email: 'test@ppeye.app' } }),
    signInSilently: async () => ({ user: { id: 'test-user', email: 'test@ppeye.app' } }),
    signOut: async () => {},
    revokeAccess: async () => {},
    hasPreviousSignIn: async () => true,
    getCurrentUser: async () => ({ user: { id: 'test-user', email: 'test@ppeye.app' } }),
    clearCachedAccessToken: async () => {},
    getTokens: async () => ({
      idToken: 'mock-id-token',
      accessToken: 'mock-google-drive-token-abc',
    }),
  });

  // Suite 1: Initialization & Readiness
  console.log('• Suite: Drive Readiness & Initialization');

  await test('isDriveReady and ensureDriveReady return true and valid token without interactive prompt', async () => {
    const ready = await isDriveReady();
    assert(ready === true, 'Drive should be ready when token is available');

    const token = await ensureDriveReady();
    assert(token === 'mock-google-drive-token-abc', 'Token should match mock token');
  });

  await test('initializeDrive returns true and establishes Drive service silently', async () => {
    clearFolderCache();
    mockDriveFiles = [];

    const initialized = await initializeDrive();
    assert(initialized === true, 'initializeDrive should return true');
  });

  // Suite 2: Existing vs Missing Folders
  console.log('\n• Suite: Folder Search & Creation');

  await test('findFolderByName returns null when folder does not exist', async () => {
    const folderId = await findFolderByName('non_existent_folder_123');
    assert(folderId === null, 'Missing folder should return null');
  });

  await test('createFolder creates a new folder on Drive with parent linkage', async () => {
    const createdId = await createFolder('custom_folder', 'parent-123');
    assert(createdId.startsWith('folder-id-'), 'Should return generated folder ID');

    const found = mockDriveFiles.find((f) => f.id === createdId);
    assert(found !== undefined, 'File should be added to mock Drive');
    assert(found?.name === 'custom_folder', 'Name must match');
    assert(found?.parents?.includes('parent-123') === true, 'Parent ID must be linked');
  });

  await test('findFolderByName finds an existing folder by name and parent', async () => {
    const foundId = await findFolderByName('custom_folder', 'parent-123');
    assert(foundId !== null, 'Existing folder should be found');
  });

  // Suite 3: Hierarchy & Caching
  console.log('\n• Suite: PPEye Hierarchy (submissions & profiles)');

  await test('ensureRootFolder creates top-level PPEye folder and caches it', async () => {
    clearFolderCache();
    mockDriveFiles = [];

    const rootId1 = await ensureRootFolder();
    assert(Boolean(rootId1), 'Root folder ID must be returned');

    // Calling again should use in-memory cache without creating a new folder
    const rootId2 = await ensureRootFolder();
    assert(rootId1 === rootId2, 'Subsequent calls must return cached root folder ID');

    const ppeyeFolders = mockDriveFiles.filter((f) => f.name === DEFAULT_ROOT_FOLDER_NAME);
    assert(ppeyeFolders.length === 1, 'Only 1 root PPEye folder should exist');
  });

  await test('getSubmissionFolderId resolves root submission folder', async () => {
    const submissionsRoot = await getSubmissionFolderId();
    assert(Boolean(submissionsRoot), 'Submissions root folder ID must be returned');

    const sub101FolderId = await getSubmissionFolderId(101);
    assert(Boolean(sub101FolderId), 'Submission 101 folder ID must be returned');
    assert(sub101FolderId === submissionsRoot, 'Submission folder resolves to root submission folder');
  });

  await test('getProfileFolderId resolves PPEye/profiles and user sub-folder', async () => {
    const profilesRoot = await getProfileFolderId();
    assert(Boolean(profilesRoot), 'Profiles root folder ID must be returned');

    const user9FolderId = await getProfileFolderId(9);
    assert(Boolean(user9FolderId), 'User 9 profile folder ID must be returned');
    assert(user9FolderId !== profilesRoot, 'User profile folder should be a sub-folder');

    const userFolder = mockDriveFiles.find((f) => f.id === user9FolderId);
    assert(userFolder?.name === '9', 'Folder name should be 9');
    assert(userFolder?.parents?.includes(profilesRoot) === true, 'Parent must be profiles root');
  });

  // Suite 4: Stale ID Invalidation & Recovery
  console.log('\n• Suite: Stale ID Invalidation & Recovery');

  await test('ensureFolder detects trashed/deleted cached folder and recreates it', async () => {
    const folderA = await ensureFolder('ephemeral_folder');
    assert(Boolean(folderA), 'Initial folder created');

    // Simulate external deletion / trashing on Drive
    const mockFile = mockDriveFiles.find((f) => f.id === folderA);
    if (mockFile) {
      mockFile.trashed = true;
    }

    // Next ensureFolder call should detect stale ID, invalidate cache, and create a fresh folder
    const folderB = await ensureFolder('ephemeral_folder');
    assert(folderB !== folderA, 'Stale ID should be replaced with a fresh folder ID');
    assert(Boolean(folderB), 'Fresh folder ID should be returned');
  });

  // Suite 5: Concurrent Folder Creation Lock
  console.log('\n• Suite: Concurrent Creation Lock');

  await test('concurrent parallel calls to ensureFolder deduplicate and only create 1 folder', async () => {
    const initialFolderCount = mockDriveFiles.length;

    // Launch 10 simultaneous ensureFolder calls for the same target folder
    const promises = Array.from({ length: 10 }, () =>
      ensureFolder('parallel_target_folder', 'parent-abc')
    );

    const results = await Promise.all(promises);

    // All 10 callers must receive the exact same folder ID
    const firstId = results[0];
    results.forEach((id) => {
      assert(id === firstId, 'All concurrent callers must resolve to the identical folder ID');
    });

    // Exactly 1 new folder should have been added to mock Drive
    const newFolders = mockDriveFiles.filter(
      (f) => f.name === 'parallel_target_folder' && f.parents?.includes('parent-abc')
    );
    assert(newFolders.length === 1, `Expected exactly 1 created folder, found ${newFolders.length}`);
  });

  // Suite 6: API Error Wrapping
  console.log('\n• Suite: API Error Handling');

  await test('wraps HTTP 401/403 into StorageError(AUTHENTICATION_REQUIRED)', async () => {
    networkFailuresActive = true;
    failureStatusCode = 401;

    await assertAsyncThrows(
      () => findFolderByName('any_folder'),
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      '401 should map to AUTHENTICATION_REQUIRED'
    );

    networkFailuresActive = false;
  });

  await test('wraps HTTP 500 into StorageError(PROVIDER_ERROR / UPLOAD_FAILED)', async () => {
    networkFailuresActive = true;
    failureStatusCode = 500;

    await assertAsyncThrows(
      () => createFolder('fail_folder'),
      StorageErrorCode.UPLOAD_FAILED,
      '500 on create should map to UPLOAD_FAILED'
    );

    networkFailuresActive = false;
  });

  await test('getDriveClient returns functional client interface with all required methods', async () => {
    const client = getDriveClient();
    assert(typeof client.getAccessToken === 'function', 'client.getAccessToken must exist');
    assert(typeof client.getHeaders === 'function', 'client.getHeaders must exist');
    assert(typeof client.findFolderByName === 'function', 'client.findFolderByName must exist');
    assert(typeof client.createFolder === 'function', 'client.createFolder must exist');
    assert(typeof client.ensureFolder === 'function', 'client.ensureFolder must exist');
    assert(typeof client.validateFolder === 'function', 'client.validateFolder must exist');
    assert(typeof client.fetch === 'function', 'client.fetch must exist');

    const headers = await client.getHeaders();
    assert(headers.Authorization.startsWith('Bearer '), 'Headers should include bearer token');
  });

  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  // Clean up
  setCustomDriveFetch(null);
  clearFolderCache();
  await signOutFromGoogle();

  return { passed, failed };
}
