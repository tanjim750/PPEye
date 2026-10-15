import { StorageError, StorageErrorCode } from './storage.errors';
import type {
  FileDownloadResult,
  IStorageService,
  StorageCategory,
  StoredFile,
  UploadFileInput,
} from './storage.types';

export interface ServerStorageConfig {
  functionName?: string;
  baseUrl?: string;
  supabaseClient?: any;
}

export class ServerStorageClient implements IStorageService {
  private functionName: string;
  private baseUrl: string;
  private supabaseClient?: any;

  constructor(config?: ServerStorageConfig) {
    this.functionName = config?.functionName ?? 'storage-api';
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    this.baseUrl = config?.baseUrl ?? `${supabaseUrl}/functions/v1/${this.functionName}`;
    this.supabaseClient = config?.supabaseClient;
  }

  private getSupabase(): any {
    if (this.supabaseClient) {
      return this.supabaseClient;
    }
    return require('../supabase/client').supabase;
  }

  /**
   * Retrieves the current active Supabase JWT access token.
   */
  private async getAuthToken(): Promise<string> {
    const client = this.getSupabase();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new StorageError(
        StorageErrorCode.AUTHENTICATION_REQUIRED,
        'Authentication required: Please log in with Supabase to perform authorized storage operations.'
      );
    }
    return data.session.access_token;
  }

  /**
   * Uploads a file through the secure server-mediated Supabase Edge Function.
   */
  async upload(input: UploadFileInput): Promise<StoredFile> {
    const token = await this.getAuthToken();
    const url = `${this.baseUrl}?action=upload`;

    const formData = new FormData();
    formData.append('fileName', input.fileName);
    formData.append('category', input.category);
    if (input.mimeType) formData.append('mimeType', input.mimeType);

    if (input.metadata) {
      if (input.metadata.submissionId) formData.append('submissionId', String(input.metadata.submissionId));
      if (input.metadata.workerInstanceId) formData.append('workerInstanceId', String(input.metadata.workerInstanceId));
      if (input.metadata.side) formData.append('side', String(input.metadata.side));
      if (input.metadata.sequenceNo) formData.append('sequenceNo', String(input.metadata.sequenceNo));
    }

    // In React Native / Expo, file attachment format
    const fileEntry: any = {
      uri: input.localUri,
      name: input.fileName,
      type: input.mimeType || 'image/jpeg',
    };
    formData.append('file', fileEntry);

    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: formData,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody.error || `Server storage upload failed with HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        throw new StorageError(StorageErrorCode.PERMISSION_DENIED, errMsg);
      }
      throw new StorageError(StorageErrorCode.UPLOAD_FAILED, errMsg);
    }

    const data = await res.json();
    const fileRec = data.file;

    return {
      id: fileRec.id,
      storageProvider: 'GOOGLE_DRIVE',
      providerFileId: data.driveFileId || fileRec.provider_file_id,
      fileName: fileRec.file_name,
      mimeType: fileRec.mime_type || 'image/jpeg',
      sizeBytes: fileRec.size_bytes,
      createdBy: fileRec.created_by,
      category: input.category,
      createdAt: fileRec.created_at,
    };
  }

  async uploadPPEImage(
    localUri: string,
    workerSequenceNo: number,
    side: 'FRONT' | 'BACK',
    siteName: string,
    createdBy?: number
  ): Promise<StoredFile> {
    return this.upload({
      localUri,
      fileName: `${siteName}_w${workerSequenceNo}_${side.toLowerCase()}.jpg`,
      category: 'PPE',
      createdBy,
      metadata: {
        workerSequenceNo,
        side,
        siteName,
      },
    });
  }

  async uploadOtherImage(
    localUri: string,
    sequenceNo: number,
    siteName: string,
    createdBy?: number
  ): Promise<StoredFile> {
    return this.upload({
      localUri,
      fileName: `${siteName}_other_${sequenceNo}.jpg`,
      category: 'OTHERS',
      createdBy,
      metadata: {
        sequenceNo,
        siteName,
      },
    });
  }

  async uploadProfilePicture(localUri: string, userId: number): Promise<StoredFile> {
    return this.upload({
      localUri,
      fileName: `avatar_u${userId}.jpg`,
      category: 'PROFILE_PICTURE',
      createdBy: userId,
    });
  }

  /**
   * Generates a private streaming URL for an authorized client.
   * Evidence is NEVER public.
   */
  async getDownloadUrl(providerFileId: string): Promise<string> {
    return `${this.baseUrl}?action=download&fileId=${encodeURIComponent(providerFileId)}`;
  }

  /**
   * Downloads a private evidence file directly into app-private cache storage.
   */
  async downloadFile(providerFileId: string, targetLocalUri?: string): Promise<FileDownloadResult> {
    const token = await this.getAuthToken();
    const url = await this.getDownloadUrl(providerFileId);
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });

    if (!res.ok) {
      if (res.status === 403) {
        throw new StorageError(StorageErrorCode.PERMISSION_DENIED, 'Access denied: You are not authorized to view this evidence.');
      }
      if (res.status === 404) {
        throw new StorageError(StorageErrorCode.FILE_NOT_FOUND, 'Requested evidence file was not found.');
      }
      throw new StorageError(StorageErrorCode.DOWNLOAD_FAILED, `Download failed with HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const contentLength = res.headers.get('content-length');

    // In local / Expo environment, save to targetLocalUri if provided
    let localUri = targetLocalUri || `file:///cache/${providerFileId}.jpg`;
    try {
      const FileSystem = require('expo-file-system/legacy');
      if (FileSystem.cacheDirectory) {
        localUri = targetLocalUri || `${FileSystem.cacheDirectory}evidence_${providerFileId}.jpg`;
        const blob = await res.blob();
        const reader = new FileReader();
        const base64Data: string = await new Promise((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await FileSystem.writeAsStringAsync(localUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    } catch {
      // Fallback in testing / mock environments
    }

    return {
      fileId: providerFileId,
      localUri,
      mimeType: contentType,
      sizeBytes: contentLength ? parseInt(contentLength, 10) : undefined,
    };
  }

  async deleteFile(providerFileId: string, fileRecordId?: number): Promise<boolean> {
    const token = await this.getAuthToken();
    const id = fileRecordId ? String(fileRecordId) : providerFileId;
    const url = `${this.baseUrl}?action=delete&fileId=${encodeURIComponent(id)}`;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });

    return res.ok;
  }

  async getFileMetadata(providerFileId: string): Promise<StoredFile | null> {
    const client = this.getSupabase();
    const { data, error } = await client
      .from('files')
      .select('*')
      .eq('provider_file_id', providerFileId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      storageProvider: 'GOOGLE_DRIVE',
      providerFileId: data.provider_file_id,
      fileName: data.file_name,
      mimeType: data.mime_type || 'image/jpeg',
      sizeBytes: data.size_bytes,
      createdBy: data.created_by,
      category: 'PPE',
      createdAt: data.created_at,
    };
  }
}
