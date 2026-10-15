import { config } from '../../constants/config';
import {
  StorageError,
  StorageErrorCode,
} from './storage.errors';
import type {
  FileDownloadResult,
  IStorageService,
  StoredFile,
  UploadFileInput,
} from './storage.types';

type SupabaseClientType = typeof import('../supabase/client').supabase;
type DriveUploadFnType = typeof import('../google-drive').uploadFileToDrive;
type TokenGetterFnType = typeof import('../google-drive').getGoogleDriveAccessToken;

let defaultSupabaseClient: SupabaseClientType | null = null;
function getDefaultSupabase(): SupabaseClientType {
  if (!defaultSupabaseClient) {
    defaultSupabaseClient = require('../supabase/client').supabase;
  }
  return defaultSupabaseClient!;
}

let defaultDriveUploadFn: DriveUploadFnType | null = null;
function getDefaultDriveUpload(): DriveUploadFnType {
  if (!defaultDriveUploadFn) {
    defaultDriveUploadFn = require('../google-drive').uploadFileToDrive;
  }
  return defaultDriveUploadFn!;
}

let defaultTokenGetterFn: TokenGetterFnType | null = null;
function getDefaultTokenGetter(): TokenGetterFnType {
  if (!defaultTokenGetterFn) {
    defaultTokenGetterFn = require('../google-drive').getGoogleDriveAccessToken;
  }
  return defaultTokenGetterFn!;
}

function getDriveThumbnailUrlHelper(fileId: string): string {
  try {
    return require('../google-drive').getDriveThumbnailUrl(fileId);
  } catch {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  }
}

let fileSystemModule: typeof import('expo-file-system/legacy') | null = null;
function getFileSystem() {
  if (!fileSystemModule) {
    try {
      fileSystemModule = require('expo-file-system/legacy');
    } catch {
      fileSystemModule = null;
    }
  }
  return fileSystemModule;
}

export type StorageMode = 'direct' | 'server';

export interface StorageServiceOptions {
  dbClient?: SupabaseClientType;
  driveUploadFn?: DriveUploadFnType;
  tokenGetterFn?: TokenGetterFnType;
  serverClient?: IStorageService;
  mode?: StorageMode;
}

export class StorageService implements IStorageService {
  private dbClient?: SupabaseClientType;
  private driveUploadFn?: DriveUploadFnType;
  private tokenGetterFn?: TokenGetterFnType;
  private serverClient?: IStorageService;
  private mode: StorageMode;

  constructor(
    dbClientOrOptions?: SupabaseClientType | StorageServiceOptions,
    driveUploadFn?: DriveUploadFnType,
    tokenGetterFn?: TokenGetterFnType
  ) {
    if (dbClientOrOptions && typeof (dbClientOrOptions as any).mode === 'string') {
      const opts = dbClientOrOptions as StorageServiceOptions;
      this.dbClient = opts.dbClient;
      this.driveUploadFn = opts.driveUploadFn;
      this.tokenGetterFn = opts.tokenGetterFn;
      this.serverClient = opts.serverClient;
      this.mode = opts.mode ?? config.storageMode ?? 'server';
    } else {
      this.dbClient = dbClientOrOptions as SupabaseClientType | undefined;
      this.driveUploadFn = driveUploadFn;
      this.tokenGetterFn = tokenGetterFn;
      this.mode = driveUploadFn ? 'direct' : (config.storageMode ?? 'server');
    }
  }

  public setMode(mode: StorageMode): void {
    this.mode = mode;
  }

  public getMode(): StorageMode {
    return this.mode;
  }

  private getServerClient(): IStorageService {
    if (!this.serverClient) {
      const { ServerStorageClient } = require('./server-storage.client');
      this.serverClient = new ServerStorageClient();
    }
    return this.serverClient!;
  }

  private getDb(): SupabaseClientType {
    if (!this.dbClient) {
      this.dbClient = getDefaultSupabase();
    }
    return this.dbClient;
  }

  private getDriveUploader(): DriveUploadFnType {
    if (!this.driveUploadFn) {
      this.driveUploadFn = getDefaultDriveUpload();
    }
    return this.driveUploadFn;
  }

  private getTokenGetter(): TokenGetterFnType {
    if (!this.tokenGetterFn) {
      this.tokenGetterFn = getDefaultTokenGetter();
    }
    return this.tokenGetterFn;
  }

  /**
   * General-purpose upload function for any supported PPEye asset category.
   */
  async upload(input: UploadFileInput): Promise<StoredFile> {
    if (this.mode === 'server') {
      return this.getServerClient().upload(input);
    }
    if (!input.localUri || !input.localUri.trim()) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        'localUri must not be empty.'
      );
    }

    if (!input.fileName || !input.fileName.trim()) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        'fileName must not be empty.'
      );
    }

    const mimeType = input.mimeType ?? 'image/jpeg';

    // 1. Upload to physical storage provider (Google Drive)
    let uploadResult;
    try {
      uploadResult = await this.getDriveUploader()({
        localUri: input.localUri,
        fileName: input.fileName,
        mimeType,
        folderId: input.folderId,
      });
    } catch (err: any) {
      throw new StorageError(
        StorageErrorCode.UPLOAD_FAILED,
        `Provider upload failed for ${input.fileName}: ${err?.message ?? err}`,
        { cause: err }
      );
    }

    const providerFileId = uploadResult.fileId;
    let dbRecordId: number | undefined;
    let createdAt = new Date().toISOString();

    // 2. Persist file metadata record to Supabase "files" table
    try {
      const { data, error } = await this.getDb()
        .from('files')
        .insert({
          storage_provider: 'GOOGLE_DRIVE',
          provider_file_id: providerFileId,
          file_name: input.fileName,
          mime_type: mimeType,
          created_by: input.createdBy ?? null,
        })
        .select('id, created_at')
        .single();

      if (!error && data) {
        dbRecordId = data.id;
        createdAt = data.created_at;

        // If category is PROFILE_PICTURE and user ID provided, link to users table
        if (input.category === 'PROFILE_PICTURE' && input.createdBy) {
          await this.getDb()
            .from('users')
            .update({ profile_picture_file_id: dbRecordId })
            .eq('id', input.createdBy);
        }
      } else if (error) {
        console.warn('[StorageService] Metadata persistence note:', error.message);
      }
    } catch (err) {
      console.warn('[StorageService] Exception persisting metadata to Supabase:', err);
    }

    return {
      id: dbRecordId,
      storageProvider: 'GOOGLE_DRIVE',
      providerFileId,
      fileName: input.fileName,
      mimeType,
      createdBy: input.createdBy ?? null,
      category: input.category,
      webViewLink: uploadResult.webViewLink,
      thumbnailUrl: getDriveThumbnailUrlHelper(providerFileId),
      downloadUrl: this.formatDownloadUrl(providerFileId),
      createdAt,
    };
  }

  /**
   * Upload PPE front or back photo for a worker instance.
   */
  async uploadPPEImage(
    localUri: string,
    workerSequenceNo: number,
    side: 'FRONT' | 'BACK',
    siteName: string,
    createdBy?: number
  ): Promise<StoredFile> {
    const sanitizedSite = siteName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${sanitizedSite}_w${workerSequenceNo}_${side.toLowerCase()}.jpg`;

    return this.upload({
      localUri,
      fileName,
      category: 'PPE',
      createdBy,
      metadata: {
        workerSequenceNo,
        side,
        siteName,
      },
    });
  }

  /**
   * Upload other site photos (hazards, equipment, scene).
   */
  async uploadOtherImage(
    localUri: string,
    sequenceNo: number,
    siteName: string,
    createdBy?: number
  ): Promise<StoredFile> {
    const sanitizedSite = siteName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${sanitizedSite}_other_${sequenceNo}.jpg`;

    return this.upload({
      localUri,
      fileName,
      category: 'OTHERS',
      createdBy,
      metadata: {
        sequenceNo,
        siteName,
      },
    });
  }

  /**
   * Upload user profile avatar photo and link with user record.
   */
  async uploadProfilePicture(localUri: string, userId: number): Promise<StoredFile> {
    const fileName = `user_${userId}_avatar.jpg`;

    return this.upload({
      localUri,
      fileName,
      category: 'PROFILE_PICTURE',
      createdBy: userId,
      metadata: {
        userId,
      },
    });
  }

  /**
   * Generate provider download URL.
   */
  async getDownloadUrl(providerFileId: string): Promise<string> {
    if (this.mode === 'server') {
      return this.getServerClient().getDownloadUrl(providerFileId);
    }
    if (!providerFileId || !providerFileId.trim()) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        'providerFileId must not be empty.'
      );
    }
    return this.formatDownloadUrl(providerFileId);
  }

  /**
   * Download a file from storage to device local file system.
   */
  async downloadFile(
    providerFileId: string,
    targetLocalUri?: string
  ): Promise<FileDownloadResult> {
    if (this.mode === 'server') {
      return this.getServerClient().downloadFile(providerFileId, targetLocalUri);
    }
    if (!providerFileId || !providerFileId.trim()) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        'providerFileId must not be empty.'
      );
    }

    const downloadUrl = this.formatDownloadUrl(providerFileId);
    const FS = getFileSystem();
    const dest =
      targetLocalUri ??
      `${FS?.cacheDirectory ?? ''}drive_${providerFileId}.jpg`;

    try {
      if (!FS?.downloadAsync) {
        throw new Error('FileSystem.downloadAsync is not available in the current environment.');
      }
      const result = await FS.downloadAsync(downloadUrl, dest);
      return {
        fileId: providerFileId,
        localUri: result.uri,
      };
    } catch (err: any) {
      throw new StorageError(
        StorageErrorCode.DOWNLOAD_FAILED,
        `Failed to download file ${providerFileId}: ${err?.message ?? err}`,
        { cause: err }
      );
    }
  }

  /**
   * Delete a file from Google Drive and remove metadata record from Supabase.
   */
  async deleteFile(providerFileId: string, fileRecordId?: number): Promise<boolean> {
    if (this.mode === 'server') {
      return this.getServerClient().deleteFile(providerFileId, fileRecordId);
    }
    if (!providerFileId || !providerFileId.trim()) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        'providerFileId must not be empty.'
      );
    }

    let providerSuccess = false;
    const token = await this.getTokenGetter()();

    // 1. Delete from Google Drive if token available
    if (token) {
      try {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${providerFileId}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        providerSuccess = response.ok || response.status === 404;
      } catch (err) {
        console.warn(`[StorageService] Error deleting from Google Drive (${providerFileId}):`, err);
      }
    } else {
      // Mock / offline environment
      providerSuccess = true;
    }

    // 2. Remove metadata from Supabase files table
    try {
      let query = this.getDb().from('files').delete();
      if (fileRecordId) {
        query = query.eq('id', fileRecordId);
      } else {
        query = query.eq('provider_file_id', providerFileId);
      }
      await query;
    } catch (err) {
      console.warn('[StorageService] Error deleting file metadata from Supabase:', err);
    }

    return providerSuccess;
  }

  /**
   * Fetch stored file metadata by providerFileId.
   */
  async getFileMetadata(providerFileId: string): Promise<StoredFile | null> {
    if (this.mode === 'server') {
      return this.getServerClient().getFileMetadata(providerFileId);
    }
    if (!providerFileId || !providerFileId.trim()) {
      return null;
    }

    try {
      const { data, error } = await this.getDb()
        .from('files')
        .select('*')
        .eq('provider_file_id', providerFileId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        storageProvider: data.storage_provider,
        providerFileId: data.provider_file_id,
        fileName: data.file_name,
        mimeType: data.mime_type ?? 'image/jpeg',
        sizeBytes: data.size_bytes,
        createdBy: data.created_by,
        category: 'PPE',
        thumbnailUrl: getDriveThumbnailUrlHelper(data.provider_file_id),
        downloadUrl: this.formatDownloadUrl(data.provider_file_id),
        createdAt: data.created_at,
      };
    } catch (err) {
      console.warn('[StorageService] Error fetching file metadata:', err);
      return null;
    }
  }

  private formatDownloadUrl(providerFileId: string): string {
    return `https://drive.google.com/uc?export=download&id=${providerFileId}`;
  }
}

export const storageService = new StorageService();
