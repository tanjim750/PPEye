import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from './storage.errors';
import {
  createFileRecord,
  deleteFileRecord,
  getFileRecord,
  isFileReferenced,
  setFilesRepoClientOverride,
  type FileRecord,
} from '../supabase/files.repository';
import {
  cacheImage,
  generateProfileFileName,
  getCachedImageUri,
  getFileExtension,
  getImageUri,
  invalidateImageCache,
} from '../../utils/image';
import type {
  GetProfilePictureUriOptions,
  ProfileImageFileInfo,
  RemoveProfilePictureOptions,
  ReplaceProfilePictureInput,
  StoredProfilePicture,
  UploadProfilePictureInput,
} from './profile-image.types';

export * from './profile-image.types';

export type UserRow = Database['public']['Tables']['users']['Row'];

// ---------------------------------------------------------------------------
// Pluggable test injectors
// ---------------------------------------------------------------------------

let supabaseOverride: SupabaseClient<Database> | null = null;
let injectedDriveUploader: ((params: { localUri: string; fileName: string; folderId?: string }) => Promise<{
  fileId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}>) | null = null;
let injectedDriveDeleter: ((fileId: string) => Promise<boolean>) | null = null;

export function setProfileImageSupabaseOverride(client: SupabaseClient<Database> | null): void {
  supabaseOverride = client;
  setFilesRepoClientOverride(client);
}

export function setProfileImageDriveUploaderMock(
  uploader: ((params: { localUri: string; fileName: string; folderId?: string }) => Promise<{
    fileId: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
  }>) | null
): void {
  injectedDriveUploader = uploader;
}

export function setProfileImageDriveDeleterMock(
  deleter: ((fileId: string) => Promise<boolean>) | null
): void {
  injectedDriveDeleter = deleter;
}

function getDb(client?: SupabaseClient<Database>): SupabaseClient<Database> {
  if (client) {
    return client;
  }
  if (supabaseOverride) {
    return supabaseOverride;
  }
  return require('../supabase/client').supabase;
}

function getDriveUploader() {
  if (injectedDriveUploader) {
    return injectedDriveUploader;
  }
  return async (params: { localUri: string; fileName: string; folderId?: string }) => {
    const { uploadFileToDrive } = require('../google-drive/upload');
    const result = await uploadFileToDrive({
      localUri: params.localUri,
      fileName: params.fileName,
      folderId: params.folderId,
    });
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
    };
  };
}

function getDriveDeleter() {
  if (injectedDriveDeleter) {
    return injectedDriveDeleter;
  }
  return async (fileId: string) => {
    const { deleteFile } = require('../google-drive/files');
    return deleteFile(fileId);
  };
}

// ---------------------------------------------------------------------------
// Authorization and Safe Cleanup Helpers
// ---------------------------------------------------------------------------

function verifyUserAuth(targetUserId: number, currentAuthUserId?: number): void {
  if (currentAuthUserId !== undefined && currentAuthUserId !== null) {
    if (currentAuthUserId !== targetUserId) {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        `User #${currentAuthUserId} is not authorized to modify the profile picture for user #${targetUserId}.`
      );
    }
  }
}

async function verifyUserExists(userId: number, client?: SupabaseClient<Database>): Promise<UserRow> {
  const db = getDb(client);
  const { data: user, error } = await db
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error verifying user #${userId}: ${error.message}`,
      { details: error }
    );
  }

  if (!user) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `User #${userId} not found.`
    );
  }

  return user;
}

/**
 * Safely removes a file record and remote storage binary only if the file
 * is no longer referenced by any record (users, ppe_images, other_images).
 */
async function cleanupUnreferencedFile(fileId: number, client?: SupabaseClient<Database>): Promise<void> {
  try {
    const isReferenced = await isFileReferenced(fileId);
    if (!isReferenced) {
      const fileRec = await getFileRecord(fileId);
      await deleteFileRecord(fileId, { force: true });
      if (fileRec?.provider_file_id) {
        const deleter = getDriveDeleter();
        await deleter(fileRec.provider_file_id);
      }
    }
  } catch (err) {
    console.warn(`[Profile Image] Warning cleaning up unreferenced file #${fileId}:`, err);
  }
}

function getAvatarCacheKey(userId: number): string {
  return `user_avatar_${userId}`;
}

// ---------------------------------------------------------------------------
// 1. uploadProfilePicture
// ---------------------------------------------------------------------------

/**
 * Uploads a profile picture for a user, links it to users.profile_picture_file_id,
 * and caches it locally as sensitive app data.
 */
export async function uploadProfilePicture(
  input: UploadProfilePictureInput,
  client?: SupabaseClient<Database>
): Promise<StoredProfilePicture> {
  const { userId, localUri, currentAuthUserId } = input;

  if (!userId || userId <= 0 || !Number.isInteger(userId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid userId: ${userId}. Must be a positive integer.`
    );
  }

  if (!localUri || !localUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'localUri must not be empty.'
    );
  }

  verifyUserAuth(userId, currentAuthUserId);
  const db = getDb(client);
  const user = await verifyUserExists(userId, db);

  // If user already has an active profile picture, delegate to replaceProfilePicture
  if (user.profile_picture_file_id) {
    return replaceProfilePicture(
      {
        userId,
        newLocalUri: localUri,
        currentAuthUserId,
        folderId: input.folderId,
      },
      db
    );
  }

  // 1. Resolve standardized filename
  const ext = getFileExtension(localUri);
  const fileName = generateProfileFileName(userId, ext);

  // 2. Upload binary to storage (Google Drive)
  const uploader = getDriveUploader();
  let driveResult: { fileId: string; fileName: string; mimeType?: string; sizeBytes?: number };

  try {
    driveResult = await uploader({
      localUri,
      fileName,
      folderId: input.folderId,
    });
  } catch (err: any) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      `Failed to upload profile picture to storage: ${err?.message ?? err}`,
      { cause: err }
    );
  }

  // 3. Persist record in files table
  let fileRecord: FileRecord;
  try {
    fileRecord = await createFileRecord(
      {
        storage_provider: 'GOOGLE_DRIVE',
        provider_file_id: driveResult.fileId,
        file_name: fileName,
        mime_type: driveResult.mimeType ?? 'image/jpeg',
        size_bytes: driveResult.sizeBytes ?? null,
        created_by: userId,
      },
      { onConflict: 'return_existing' }
    );
  } catch (err: any) {
    try {
      const deleter = getDriveDeleter();
      await deleter(driveResult.fileId);
    } catch {}
    throw err;
  }

  // 4. Update users table reference
  const { data: updatedUser, error: updateErr } = await db
    .from('users')
    .update({
      profile_picture_file_id: fileRecord.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (updateErr || !updatedUser) {
    // Reference update failure -> rollback new file record and remote Drive file
    try {
      await deleteFileRecord(fileRecord.id, { force: true });
      const deleter = getDriveDeleter();
      await deleter(driveResult.fileId);
    } catch {}

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to link profile picture to user #${userId}: ${updateErr?.message ?? 'Unknown error'}`,
      { details: updateErr }
    );
  }

  // 5. Cache locally as sensitive app data
  let cachedLocalUri = localUri;
  try {
    cachedLocalUri = await cacheImage(getAvatarCacheKey(userId), localUri, {
      isSensitive: true,
      customFileName: fileName,
    });
  } catch (cacheErr) {
    console.warn('[Profile Image] Warning caching profile picture:', cacheErr);
  }

  return {
    userId,
    fileId: fileRecord.id,
    localUri: cachedLocalUri,
    file: {
      id: fileRecord.id,
      storageProvider: fileRecord.storage_provider as StorageProvider,
      providerFileId: fileRecord.provider_file_id,
      fileName: fileRecord.file_name,
      mimeType: fileRecord.mime_type,
      sizeBytes: fileRecord.size_bytes,
      createdBy: fileRecord.created_by,
      createdAt: fileRecord.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. getProfilePictureUri
// ---------------------------------------------------------------------------

/**
 * Retrieves the profile picture URI for a user.
 * - Checks local cache first (Cache-Hit).
 * - On cache-miss, checks users.profile_picture_file_id and loads image on-demand.
 * - Supports forceRefresh to bypass cache.
 */
export async function getProfilePictureUri(
  userId: number,
  options?: GetProfilePictureUriOptions,
  client?: SupabaseClient<Database>
): Promise<string | null> {
  if (!userId || userId <= 0 || !Number.isInteger(userId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid userId: ${userId}. Must be a positive integer.`
    );
  }

  const cacheKey = getAvatarCacheKey(userId);

  // 1. Check local private cache first (unless forceRefresh)
  if (!options?.forceRefresh) {
    const cachedUri = await getCachedImageUri(cacheKey);
    if (cachedUri) {
      return cachedUri;
    }
  }

  // 2. Fetch user's profile_picture_file_id
  const db = getDb(client);
  const user = await verifyUserExists(userId, db);

  if (!user.profile_picture_file_id) {
    return null;
  }

  // 3. Resolve files record
  const fileRec = await getFileRecord(user.profile_picture_file_id);
  if (!fileRec || !fileRec.provider_file_id) {
    return null;
  }

  // 4. Download on-demand via getImageUri into app-private cache
  try {
    const localUri = await getImageUri(fileRec.provider_file_id, {
      isSensitive: true,
      forceRefresh: options?.forceRefresh,
      ttlMs: options?.ttlMs,
      storageProvider: fileRec.storage_provider as any,
      bucket: 'avatars',
    });

    // Also register under user avatar cache key
    try {
      await cacheImage(cacheKey, localUri, { isSensitive: true });
    } catch {}

    return localUri;
  } catch (err: any) {
    console.warn(`[Profile Image] Error downloading profile picture for user #${userId}:`, err?.message ?? err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. replaceProfilePicture
// ---------------------------------------------------------------------------

/**
 * Replaces a user's existing profile picture.
 *
 * Safety Protocol:
 * 1. Upload and persist new image in storage and files table BEFORE changing the profile reference.
 * 2. If upload or database file creation fails, previous image is preserved untouched.
 * 3. Update users.profile_picture_file_id to new file.
 * 4. If reference update fails, rollback new file and preserve previous image.
 * 5. Invalidate stale cache entries and cache new image.
 * 6. Schedule old file cleanup only after confirming that it is no longer referenced anywhere.
 */
export async function replaceProfilePicture(
  input: ReplaceProfilePictureInput,
  client?: SupabaseClient<Database>
): Promise<StoredProfilePicture> {
  const { userId, newLocalUri, currentAuthUserId } = input;

  if (!userId || userId <= 0 || !Number.isInteger(userId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid userId: ${userId}. Must be a positive integer.`
    );
  }

  if (!newLocalUri || !newLocalUri.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'newLocalUri must not be empty.'
    );
  }

  verifyUserAuth(userId, currentAuthUserId);
  const db = getDb(client);
  const user = await verifyUserExists(userId, db);

  const oldFileId = user.profile_picture_file_id;

  // If user has no current profile picture, perform initial upload
  if (!oldFileId) {
    return uploadProfilePicture(
      {
        userId,
        localUri: newLocalUri,
        currentAuthUserId,
        folderId: input.folderId,
      },
      db
    );
  }

  // 1. Resolve replacement filename
  const ext = getFileExtension(newLocalUri);
  const fileName = generateProfileFileName(userId, ext);

  // 2. STEP 1: Upload and persist replacement BEFORE touching the user profile reference
  const uploader = getDriveUploader();
  let newDriveResult: { fileId: string; fileName: string; mimeType?: string; sizeBytes?: number };

  try {
    newDriveResult = await uploader({
      localUri: newLocalUri,
      fileName,
      folderId: input.folderId,
    });
  } catch (err: any) {
    // Previous image remains 100% active and untouched
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageError(
      StorageErrorCode.UPLOAD_FAILED,
      `Failed to upload replacement profile picture to storage: ${err?.message ?? err}. Previous image preserved.`,
      { cause: err }
    );
  }

  let newFileRecord: FileRecord;
  try {
    newFileRecord = await createFileRecord(
      {
        storage_provider: 'GOOGLE_DRIVE',
        provider_file_id: newDriveResult.fileId,
        file_name: fileName,
        mime_type: newDriveResult.mimeType ?? 'image/jpeg',
        size_bytes: newDriveResult.sizeBytes ?? null,
        created_by: userId,
      },
      { onConflict: 'return_existing' }
    );
  } catch (err: any) {
    try {
      const deleter = getDriveDeleter();
      await deleter(newDriveResult.fileId);
    } catch {}
    throw err;
  }

  // 3. STEP 2: Switch the profile reference in users table
  const { data: updatedUser, error: updateErr } = await db
    .from('users')
    .update({
      profile_picture_file_id: newFileRecord.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (updateErr || !updatedUser) {
    // ROLLBACK: Delete newly uploaded file and preserve previous image reference
    try {
      await deleteFileRecord(newFileRecord.id, { force: true });
      const deleter = getDriveDeleter();
      await deleter(newDriveResult.fileId);
    } catch {}

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to switch user profile picture reference in database: ${updateErr?.message ?? 'Unknown error'}. Previous image preserved.`,
      { details: updateErr }
    );
  }

  // 4. STEP 3: Invalidate stale cache entry and register new image
  const cacheKey = getAvatarCacheKey(userId);
  try {
    await invalidateImageCache(cacheKey);
  } catch {}

  let cachedLocalUri = newLocalUri;
  try {
    cachedLocalUri = await cacheImage(cacheKey, newLocalUri, {
      isSensitive: true,
      customFileName: fileName,
    });
  } catch (cacheErr) {
    console.warn('[Profile Image] Warning caching replaced profile picture:', cacheErr);
  }

  // 5. STEP 4: Safe old-file cleanup: verify old file is not referenced elsewhere before deleting
  await cleanupUnreferencedFile(oldFileId, db);

  return {
    userId,
    fileId: newFileRecord.id,
    localUri: cachedLocalUri,
    file: {
      id: newFileRecord.id,
      storageProvider: newFileRecord.storage_provider as StorageProvider,
      providerFileId: newFileRecord.provider_file_id,
      fileName: newFileRecord.file_name,
      mimeType: newFileRecord.mime_type,
      sizeBytes: newFileRecord.size_bytes,
      createdBy: newFileRecord.created_by,
      createdAt: newFileRecord.created_at,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. removeProfilePicture
// ---------------------------------------------------------------------------

/**
 * Removes a user's profile picture reference and cache, and safely cleans up
 * the underlying file only if it is no longer referenced anywhere else.
 */
export async function removeProfilePicture(
  userId: number,
  options?: RemoveProfilePictureOptions,
  client?: SupabaseClient<Database>
): Promise<boolean> {
  if (!userId || userId <= 0 || !Number.isInteger(userId)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid userId: ${userId}. Must be a positive integer.`
    );
  }

  verifyUserAuth(userId, options?.currentAuthUserId);
  const db = getDb(client);
  const user = await verifyUserExists(userId, db);

  const oldFileId = user.profile_picture_file_id;
  if (!oldFileId) {
    // Idempotent
    return true;
  }

  // 1. Clear profile reference in users table
  const { error: updateErr } = await db
    .from('users')
    .update({
      profile_picture_file_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateErr) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Failed to clear profile picture reference for user #${userId}: ${updateErr.message}`,
      { details: updateErr }
    );
  }

  // 2. Invalidate stale cache entry
  try {
    await invalidateImageCache(getAvatarCacheKey(userId));
  } catch {}

  // 3. Safe cleanup of old file if no longer referenced anywhere
  await cleanupUnreferencedFile(oldFileId, db);

  return true;
}
