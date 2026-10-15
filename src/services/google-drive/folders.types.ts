/**
 * Google Drive Client and Folder Service Types
 */

export interface DriveFolderMetadata {
  id: string;
  name: string;
  parentId?: string;
  mimeType: 'application/vnd.google-apps.folder';
}

export interface DriveInitOptions {
  /**
   * Optional root folder ID to override config.googleDriveFolderId.
   */
  rootFolderId?: string;

  /**
   * If true, verifies the root folder exists on Drive immediately.
   */
  verifyRootFolder?: boolean;
}

export interface GoogleDriveClient {
  /**
   * Retrieve the active valid access token without interactive sign-in.
   */
  getAccessToken(): Promise<string>;

  /**
   * Retrieve authorization headers for Google Drive REST API.
   */
  getHeaders(): Promise<Record<string, string>>;

  /**
   * Find a folder by name within a parent folder.
   */
  findFolderByName(name: string, parentId?: string): Promise<string | null>;

  /**
   * Create a folder with the given name within a parent folder.
   */
  createFolder(name: string, parentId?: string): Promise<string>;

  /**
   * Ensure a folder exists within a parent folder (find or create with lock).
   */
  ensureFolder(name: string, parentId?: string): Promise<string>;

  /**
   * Validate whether a folder ID exists and is accessible.
   */
  validateFolder(folderId: string, forceCheck?: boolean): Promise<boolean>;

  /**
   * Execute an authenticated fetch against the Google Drive v3 REST API.
   */
  fetch(endpoint: string, init?: RequestInit): Promise<Response>;
}
