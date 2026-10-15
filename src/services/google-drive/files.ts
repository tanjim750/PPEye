import { config } from '../../constants/config';
import { StorageError, StorageErrorCode } from '../storage/storage.errors';
import type { DriveFile, FileDownloadResult } from '../storage/storage.types';
import { getValidAccessToken } from './auth';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webViewLink?: string;
  createdTime?: string;
  sizeBytes?: number;
}

let fileSystemModule: typeof import('expo-file-system/legacy') | null = null;
let injectedFilesFS: any = null;
let customFilesFetchHandler: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

export function setFilesFSMock(mock: any): void {
  injectedFilesFS = mock;
}

export function setCustomFilesFetch(
  handler: ((url: string, init?: RequestInit) => Promise<Response>) | null
): void {
  customFilesFetchHandler = handler;
}

function getFileSystem(): typeof import('expo-file-system/legacy') | null {
  if (injectedFilesFS) {
    return injectedFilesFS;
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

/**
 * Parses Google Drive v3 REST API HTTP error responses.
 * Accurately distinguishes between:
 * - 401: AUTHENTICATION_REQUIRED
 * - 403 (quota): PROVIDER_ERROR with quota details
 * - 403 (permissions): PERMISSION_DENIED
 * - 404: FILE_NOT_FOUND
 * - Network failures / other: defaultCode
 */
export async function parseDriveError(
  response: Response,
  actionDescription: string,
  defaultCode: StorageErrorCode = StorageErrorCode.PROVIDER_ERROR
): Promise<StorageError> {
  let errorData: any = null;
  let text = '';
  try {
    text = await response.text();
    errorData = JSON.parse(text);
  } catch {
    // not JSON
  }

  const message = errorData?.error?.message ?? text ?? `HTTP ${response.status}`;
  const errors: Array<{ reason?: string; message?: string }> = errorData?.error?.errors ?? [];
  const reasons = errors.map((e) => e.reason).filter(Boolean);

  if (response.status === 401) {
    return new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      `Google Drive authorization expired or missing during ${actionDescription}: ${message}`,
      { details: errorData }
    );
  }

  if (response.status === 403) {
    const isQuota =
      reasons.some((r) =>
        ['userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'].includes(r!)
      ) ||
      message.toLowerCase().includes('quota') ||
      message.toLowerCase().includes('rate limit');

    if (isQuota) {
      return new StorageError(
        StorageErrorCode.PROVIDER_ERROR,
        `Google Drive API quota exceeded during ${actionDescription}: ${message}`,
        { details: errorData }
      );
    }

    return new StorageError(
      StorageErrorCode.PERMISSION_DENIED,
      `Permission denied for ${actionDescription}: ${message}`,
      { details: errorData }
    );
  }

  if (response.status === 404) {
    return new StorageError(
      StorageErrorCode.FILE_NOT_FOUND,
      `File not found during ${actionDescription}: ${message}`,
      { details: errorData }
    );
  }

  return new StorageError(
    defaultCode,
    `Google Drive ${actionDescription} failed (${response.status}): ${message}`,
    { details: errorData }
  );
}

/**
 * Retrieve metadata for a Google Drive file.
 * Returns null if file is missing (404) or trashed.
 * Throws StorageError for permission, authentication, network, or quota errors.
 */
export async function getFile(fileId: string): Promise<DriveFile | null> {
  if (!fileId || !fileId.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'fileId must not be empty.'
    );
  }

  const token = await getValidAccessToken();
  if (!token) {
    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Google Drive authorization is required to fetch file metadata.'
    );
  }

  const fetchFn = customFilesFetchHandler ?? fetch;
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId.trim()
  )}?fields=${encodeURIComponent('id,name,mimeType,size,webViewLink,thumbnailLink,createdTime,trashed,parents')}`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (netErr: any) {
    throw new StorageError(
      StorageErrorCode.NETWORK_ERROR,
      `Network error fetching file ${fileId}: ${netErr?.message ?? netErr}`,
      { cause: netErr }
    );
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw await parseDriveError(res, `fetching file "${fileId}"`, StorageErrorCode.PROVIDER_ERROR);
  }

  const data = await res.json();
  if (data.trashed) {
    return null;
  }

  const sizeBytes = data.size ? parseInt(data.size, 10) : undefined;
  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType ?? 'image/jpeg',
    sizeBytes,
    webViewLink: data.webViewLink,
    thumbnailLink:
      data.thumbnailLink ?? `https://drive.google.com/thumbnail?id=${data.id}&sz=w800`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${data.id}`,
    createdTime: data.createdTime,
  };
}

/**
 * Checks whether a file exists in Google Drive and is accessible.
 * Accurately distinguishes missing files (returns false) from
 * permission, authentication, network, and quota failures (throws typed error).
 */
export async function fileExists(fileId: string): Promise<boolean> {
  if (!fileId || !fileId.trim()) {
    return false;
  }

  const file = await getFile(fileId);
  return file !== null;
}

/**
 * Downloads a private image or file from Google Drive into app-private cache storage.
 */
export async function downloadFile(
  fileId: string,
  customDestPath?: string
): Promise<FileDownloadResult> {
  if (!fileId || !fileId.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'fileId must not be empty.'
    );
  }

  // 1. Verify file exists and fetch metadata
  const file = await getFile(fileId);
  if (!file) {
    throw new StorageError(
      StorageErrorCode.FILE_NOT_FOUND,
      `Cannot download non-existent or trashed file: ${fileId}`
    );
  }

  const token = await getValidAccessToken();
  if (!token) {
    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Google Drive authorization is required to download files.'
    );
  }

  // 2. Prepare app-private cache directory destination
  const FS = getFileSystem();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cacheDir = FS?.cacheDirectory ?? '';
  const destPath = customDestPath ?? `${cacheDir}ppeye_drive_${fileId}_${safeName}`;

  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media`;

  // 3. Download via native downloadAsync streaming into private cache storage
  try {
    if (FS && typeof FS.downloadAsync === 'function') {
      const result = await FS.downloadAsync(downloadUrl, destPath, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Download returned HTTP status ${result.status}`);
      }

      return {
        fileId,
        localUri: result.uri,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
      };
    } else {
      // Mock / fallback fetch for non-native test environments
      const fetchFn = customFilesFetchHandler ?? fetch;
      const res = await fetchFn(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw await parseDriveError(res, `downloading file "${fileId}"`, StorageErrorCode.DOWNLOAD_FAILED);
      }

      return {
        fileId,
        localUri: destPath.startsWith('file://') ? destPath : `file://${destPath}`,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
      };
    }
  } catch (err: any) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      StorageErrorCode.DOWNLOAD_FAILED,
      `Failed to download Google Drive file ${fileId}: ${err?.message ?? err}`,
      { cause: err }
    );
  }
}

/**
 * Idempotently deletes a file from Google Drive.
 * If the file is already gone (404), returns true (idempotent success).
 * Never interprets permission, quota, or network errors as file-not-found.
 */
export async function deleteFile(fileId: string): Promise<boolean> {
  if (!fileId || !fileId.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'fileId must not be empty.'
    );
  }

  const token = await getValidAccessToken();
  if (!token) {
    throw new StorageError(
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Google Drive authorization is required to delete files.'
    );
  }

  const fetchFn = customFilesFetchHandler ?? fetch;
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId.trim())}`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (netErr: any) {
    throw new StorageError(
      StorageErrorCode.NETWORK_ERROR,
      `Network error deleting file ${fileId}: ${netErr?.message ?? netErr}`,
      { cause: netErr }
    );
  }

  // Idempotent deletion: 200, 204, or 404 all indicate target state (file does not exist) is achieved
  if (res.ok || res.status === 204 || res.status === 404) {
    return true;
  }

  // Throw typed errors for unauthorized, forbidden, quota, or server errors
  throw await parseDriveError(res, `deleting file "${fileId}"`, StorageErrorCode.DELETE_FAILED);
}

/**
 * Search for an existing file by name inside a specific parent folder.
 */
export async function findFileInFolder(
  fileName: string,
  folderId?: string
): Promise<DriveFile | null> {
  const token = await getValidAccessToken();
  if (!token) {
    return null;
  }

  const targetFolder = folderId ?? config.googleDriveFolderId;
  const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let q = `trashed = false and name = '${escapedName}'`;
  if (targetFolder) {
    q += ` and '${targetFolder}' in parents`;
  }

  const fetchFn = customFilesFetchHandler ?? fetch;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=${encodeURIComponent('files(id, name, mimeType, size, webViewLink, thumbnailLink, createdTime)')}&pageSize=5`;

  try {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const match = data.files?.[0];
    if (!match?.id) {
      return null;
    }

    return {
      id: match.id,
      name: match.name,
      mimeType: match.mimeType ?? 'image/jpeg',
      sizeBytes: match.size ? parseInt(match.size, 10) : undefined,
      webViewLink: match.webViewLink,
      thumbnailLink:
        match.thumbnailLink ?? `https://drive.google.com/thumbnail?id=${match.id}&sz=w800`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${match.id}`,
      createdTime: match.createdTime,
    };
  } catch {
    return null;
  }
}

/**
 * List files from Google Drive (optionally scoped to a folder).
 */
export async function listDriveFiles(folderId?: string): Promise<DriveFileItem[]> {
  const token = await getValidAccessToken();
  if (!token) {
    return [];
  }

  const targetFolder = folderId ?? config.googleDriveFolderId;
  let q = 'trashed = false';
  if (targetFolder) {
    q += ` and '${targetFolder}' in parents`;
  }

  const fetchFn = customFilesFetchHandler ?? fetch;
  try {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=${encodeURIComponent('files(id, name, mimeType, thumbnailLink, webViewLink, createdTime, size)')}&pageSize=50`;

    const res = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return (data.files ?? []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
      createdTime: f.createdTime,
      sizeBytes: f.size ? parseInt(f.size, 10) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Get direct view or thumbnail URL for a Google Drive file ID.
 */
export function getDriveThumbnailUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}
