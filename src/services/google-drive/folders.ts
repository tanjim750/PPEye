import { config } from '../../constants/config';
import { StorageError, StorageErrorCode } from '../storage/storage.errors';
import { configureGoogleAuth, getValidAccessToken } from './auth';
import { DriveInitOptions, GoogleDriveClient } from './folders.types';

export * from './folders.types';

// Default folder names
export const DEFAULT_ROOT_FOLDER_NAME = config.googleDriveFolderName || 'PPEye_submit';
export const SUBMISSIONS_FOLDER_NAME = config.googleDriveFolderName || 'PPEye_submit';
export const PROFILES_FOLDER_NAME = 'profiles';

// In-memory cache for resolved folder IDs
// Key: `${parentId ?? 'root'}:${folderName}` => folderId
const folderIdCache: Map<string, string> = new Map();

// Reverse cache to validate folder existence
// Key: folderId => boolean (true if validated and not trashed)
const validatedFolderCache: Map<string, boolean> = new Map();

// Concurrent deduplication lock
// Key: `${parentId ?? 'root'}:${folderName}` => Promise<string>
const inFlightFolderPromises: Map<string, Promise<string>> = new Map();

// Dynamic or custom configured root folder ID override
let activeRootFolderId: string | undefined = undefined;

// Custom fetch injector for unit testing and mocked HTTP calls
let customFetchHandler: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

/**
 * Inject a custom fetch handler for unit tests or offline environments.
 */
export function setCustomDriveFetch(
  handler: ((url: string, init?: RequestInit) => Promise<Response>) | null
): void {
  customFetchHandler = handler;
}

/**
 * Clear the in-memory folder cache (used for unit tests and clean resets).
 */
export function clearFolderCache(): void {
  folderIdCache.clear();
  validatedFolderCache.clear();
  inFlightFolderPromises.clear();
  activeRootFolderId = undefined;
}

/**
 * Internal authenticated fetch wrapper for Google Drive v3 REST API.
 */
async function driveFetch(endpointOrUrl: string, init?: RequestInit): Promise<Response> {
  const token = await ensureDriveReady();
  const url = endpointOrUrl.startsWith('http')
    ? endpointOrUrl
    : `https://www.googleapis.com/drive/v3/${endpointOrUrl.replace(/^\//, '')}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init?.headers as Record<string, string>),
  };

  const fetchFn = customFetchHandler ?? fetch;

  try {
    const response = await fetchFn(url, {
      ...init,
      headers,
    });
    return response;
  } catch (err: any) {
    throw new StorageError(
      StorageErrorCode.NETWORK_ERROR,
      `Google Drive network request failed: ${err?.message ?? err}`,
      { cause: err }
    );
  }
}

/**
 * Checks whether Google Drive authorization is currently ready without triggering interactive sign-in.
 */
export async function isDriveReady(): Promise<boolean> {
  try {
    const token = await getValidAccessToken();
    return Boolean(token);
  } catch {
    return false;
  }
}

/**
 * Ensures Google Drive authorization is active and returns a valid access token.
 * Throws StorageError(AUTHENTICATION_REQUIRED) if authorization is missing.
 * Does NOT trigger interactive sign-in unexpectedly.
 */
export async function ensureDriveReady(): Promise<string> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Google Drive authorization is required. Please authorize Google Drive in settings.'
    );
  }
  return token;
}

/**
 * Initializes the Google Drive service.
 * - Configures Google Auth
 * - Checks authorization silently (does not trigger interactive login)
 * - Verifies or establishes the PPEye root folder if authenticated
 */
export async function initializeDrive(options?: DriveInitOptions): Promise<boolean> {
  // 1. Ensure auth configuration is initialized once
  configureGoogleAuth();

  // 2. Set root folder override if specified
  if (options?.rootFolderId) {
    activeRootFolderId = options.rootFolderId;
  }

  // 3. Check if Drive is ready silently
  const ready = await isDriveReady();
  if (!ready) {
    return false;
  }

  // 4. Optionally verify or establish the root folder hierarchy
  if (options?.verifyRootFolder !== false) {
    try {
      await ensureRootFolder();
    } catch (err) {
      console.warn('[Google Drive] Root folder initialization note:', err);
    }
  }

  return true;
}

/**
 * Validates whether a Google Drive folder ID exists, is not trashed, and is accessible.
 */
export async function validateFolder(folderId: string, forceCheck: boolean = false): Promise<boolean> {
  if (!folderId || !folderId.trim()) {
    return false;
  }

  if (!forceCheck && validatedFolderCache.get(folderId) === true) {
    return true;
  }

  try {
    const response = await driveFetch(
      `files/${encodeURIComponent(folderId)}?fields=id,name,trashed,mimeType`
    );

    if (response.status === 404) {
      validatedFolderCache.delete(folderId);
      return false;
    }

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const isValid = !data.trashed && data.mimeType === 'application/vnd.google-apps.folder';

    if (isValid) {
      validatedFolderCache.set(folderId, true);
    } else {
      validatedFolderCache.delete(folderId);
    }

    return isValid;
  } catch {
    return false;
  }
}

/**
 * Finds a folder by name within a parent folder.
 * Returns the folder ID if found, or null if not found.
 */
export async function findFolderByName(name: string, parentId?: string): Promise<string | null> {
  await ensureDriveReady();

  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${escapedName}'`;
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  }

  const url = `files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id, name, parents)')}&pageSize=10`;
  const response = await driveFetch(url);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new StorageError(
        StorageErrorCode.AUTHENTICATION_REQUIRED,
        `Google Drive authorization error (${response.status}) searching for folder "${name}".`
      );
    }
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to query Google Drive folder "${name}" (HTTP ${response.status}).`
    );
  }

  const data = await response.json();
  const files: Array<{ id: string; name: string }> = data.files ?? [];
  return files.length > 0 ? files[0].id : null;
}

/**
 * Creates a new folder in Google Drive within the specified parent folder.
 */
export async function createFolder(name: string, parentId?: string): Promise<string> {
  await ensureDriveReady();

  const body: Record<string, any> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentId) {
    body.parents = [parentId];
  }

  const response = await driveFetch('files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new StorageError(
        StorageErrorCode.AUTHENTICATION_REQUIRED,
        `Google Drive authorization error (${response.status}) creating folder "${name}".`
      );
    }
    throw new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      `Failed to create Google Drive folder "${name}" (HTTP ${response.status}).`
    );
  }

  const data = await response.json();
  if (!data?.id) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Google Drive API did not return an ID for newly created folder "${name}".`
    );
  }

  const createdId = data.id as string;
  validatedFolderCache.set(createdId, true);
  return createdId;
}

/**
 * Ensures a folder exists within a parent folder.
 * - Checks in-memory cache and validates stale IDs
 * - Deduplicates concurrent calls via in-flight Promise locks
 * - Searches by name within parent
 * - Creates folder if it does not exist
 */
export async function ensureFolder(name: string, parentId?: string): Promise<string> {
  const cacheKey = `${parentId ?? 'root'}:${name}`;

  // 1. Check in-flight creation promise to prevent duplicate concurrent creations
  const inFlight = inFlightFolderPromises.get(cacheKey);
  if (inFlight) {
    return await inFlight;
  }

  // 2. Check cached folder ID and validate that it isn't stale
  const cachedId = folderIdCache.get(cacheKey);
  if (cachedId) {
    const isValid = await validateFolder(cachedId, true);
    if (isValid) {
      return cachedId;
    }
    // Stale cached folder was trashed or deleted; remove and re-resolve
    folderIdCache.delete(cacheKey);
    validatedFolderCache.delete(cachedId);
  }

  // 3. Deduplicated resolution & creation flow
  const creationPromise = (async () => {
    // Search on Drive first
    const existingId = await findFolderByName(name, parentId);
    if (existingId) {
      folderIdCache.set(cacheKey, existingId);
      validatedFolderCache.set(existingId, true);
      return existingId;
    }

    // Create if missing
    const newId = await createFolder(name, parentId);
    folderIdCache.set(cacheKey, newId);
    validatedFolderCache.set(newId, true);
    return newId;
  })();

  inFlightFolderPromises.set(cacheKey, creationPromise);

  try {
    return await creationPromise;
  } finally {
    inFlightFolderPromises.delete(cacheKey);
  }
}

/**
 * Ensures the PPEye root folder exists and returns its ID.
 * Supports configured root folder ID from environment (config.googleDriveFolderId),
 * or establishes a top-level 'PPEye' folder in Google Drive.
 */
export async function ensureRootFolder(): Promise<string> {
  const candidateRootId = activeRootFolderId ?? config.googleDriveFolderId;

  if (candidateRootId) {
    const isValid = await validateFolder(candidateRootId);
    if (isValid) {
      return candidateRootId;
    }
    console.warn(`[Google Drive] Configured root folder ${candidateRootId} is invalid or inaccessible. Falling back to '${DEFAULT_ROOT_FOLDER_NAME}'.`);
  }

  return await ensureFolder(DEFAULT_ROOT_FOLDER_NAME);
}

/**
 * Get or create the submission folder in the PPEye hierarchy.
 * Hierarchy: PPEye/submissions OR PPEye/submissions/<submissionId>
 */
export async function getSubmissionFolderId(submissionId?: number | string): Promise<string> {
  const rootId = await ensureRootFolder();
  return rootId;
}

/**
 * Get or create the profile folder in the PPEye hierarchy.
 * Hierarchy: PPEye/profiles OR PPEye/profiles/<userId>
 */
export async function getProfileFolderId(userId?: number | string): Promise<string> {
  const rootId = await ensureRootFolder();
  const profilesRootId = await ensureFolder(PROFILES_FOLDER_NAME, rootId);

  if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
    return await ensureFolder(String(userId).trim(), profilesRootId);
  }

  return profilesRootId;
}

/**
 * Returns a high-level Google Drive Client instance.
 */
export function getDriveClient(): GoogleDriveClient {
  return {
    getAccessToken: ensureDriveReady,
    getHeaders: async () => {
      const token = await ensureDriveReady();
      return { Authorization: `Bearer ${token}` };
    },
    findFolderByName,
    createFolder,
    ensureFolder,
    validateFolder,
    fetch: driveFetch,
  };
}
