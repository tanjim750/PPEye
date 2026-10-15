import type { StorageProvider } from '@/types/database.types';

export type { StorageProvider };

export type StorageCategory = 'PPE' | 'OTHERS' | 'PROFILE_PICTURE';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  webViewLink?: string;
  thumbnailLink?: string;
  downloadUrl?: string;
  createdTime?: string;
}

export interface UploadFileInput {
  localUri: string;
  fileName: string;
  mimeType?: string;
  category: StorageCategory;
  folderId?: string;
  createdBy?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface StoredFile {
  id?: number;
  storageProvider: StorageProvider;
  providerFileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number | null;
  createdBy?: number | null;
  category: StorageCategory;
  webViewLink?: string;
  thumbnailUrl?: string;
  downloadUrl?: string;
  createdAt?: string;
}

export interface FileDownloadResult {
  fileId: string;
  localUri: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface IStorageService {
  upload(input: UploadFileInput): Promise<StoredFile>;
  uploadPPEImage(
    localUri: string,
    workerSequenceNo: number,
    side: 'FRONT' | 'BACK',
    siteName: string,
    createdBy?: number
  ): Promise<StoredFile>;
  uploadOtherImage(
    localUri: string,
    sequenceNo: number,
    siteName: string,
    createdBy?: number
  ): Promise<StoredFile>;
  uploadProfilePicture(localUri: string, userId: number): Promise<StoredFile>;
  getDownloadUrl(providerFileId: string): Promise<string>;
  downloadFile(providerFileId: string, targetLocalUri?: string): Promise<FileDownloadResult>;
  deleteFile(providerFileId: string, fileRecordId?: number): Promise<boolean>;
  getFileMetadata(providerFileId: string): Promise<StoredFile | null>;
}
