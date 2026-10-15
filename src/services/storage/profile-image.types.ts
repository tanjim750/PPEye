import type { StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';

export interface ProfileImageFileInfo {
  id: number;
  storageProvider: StorageProvider;
  providerFileId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdBy: number | null;
  createdAt: string;
}

export interface StoredProfilePicture {
  userId: number;
  fileId: number;
  localUri: string;
  file: ProfileImageFileInfo;
}

export interface UploadProfilePictureInput {
  userId: number;
  localUri: string;
  currentAuthUserId?: number;
  folderId?: string;
}

export interface GetProfilePictureUriOptions {
  /**
   * If true, bypasses in-memory and disk cache and fetches fresh image.
   */
  forceRefresh?: boolean;
  ttlMs?: number;
}

export interface ReplaceProfilePictureInput {
  userId: number;
  newLocalUri: string;
  currentAuthUserId?: number;
  folderId?: string;
}

export interface RemoveProfilePictureOptions {
  currentAuthUserId?: number;
  force?: boolean;
}
