import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, StorageProvider } from '../../types/database.types';
import { StorageError, StorageErrorCode } from '../storage/storage.errors';

export type FileRecord = Database['public']['Tables']['files']['Row'];
export type FileInsert = Database['public']['Tables']['files']['Insert'];
export type FileUpdate = Database['public']['Tables']['files']['Update'];

export interface CreateFileInput {
  storage_provider?: StorageProvider;
  provider_file_id: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_by?: number | null;
}

export interface CreateFileOptions {
  /**
   * Conflict strategy when a record with the same (storage_provider, provider_file_id) exists:
   * - 'return_existing': Returns the existing database record without failing (default).
   * - 'error': Throws StorageError(INVALID_INPUT) on duplicate key violation.
   * - 'update': Updates the existing record with the new metadata values.
   */
  onConflict?: 'return_existing' | 'error' | 'update';
}

export interface DeleteFileOptions {
  /**
   * If true, bypasses the isFileReferenced check.
   */
  force?: boolean;
}

export interface FileReferenceDetails {
  isReferenced: boolean;
  userProfilesCount: number;
  ppeImagesCount: number;
  otherImagesCount: number;
}

// Pluggable client override for unit tests and dependency injection
let clientOverride: SupabaseClient<Database> | null = null;

export function setFilesRepoClientOverride(client: SupabaseClient<Database> | null): void {
  clientOverride = client;
}

function getDb(): SupabaseClient<Database> {
  if (clientOverride) {
    return clientOverride;
  }
  return require('./client').supabase;
}

/**
 * Persists a new file record into the Supabase "files" table.
 *
 * Enforces:
 * - Validated fields: storage_provider, provider_file_id, file_name, mime_type, size_bytes, created_by
 * - Duplicate prevention on (storage_provider, provider_file_id) via index/constraint
 * - Configurable conflict handling ('return_existing' | 'error' | 'update')
 * - Full RLS compatibility
 */
export async function createFileRecord(
  input: CreateFileInput,
  options?: CreateFileOptions
): Promise<FileRecord> {
  if (!input.provider_file_id || !input.provider_file_id.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'provider_file_id must not be empty.'
    );
  }

  if (!input.file_name || !input.file_name.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'file_name must not be empty.'
    );
  }

  if (input.size_bytes !== undefined && input.size_bytes !== null && input.size_bytes < 0) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'size_bytes cannot be negative.'
    );
  }

  const db = getDb();
  const onConflictStrategy = options?.onConflict ?? 'return_existing';
  const storageProvider: StorageProvider = input.storage_provider ?? 'GOOGLE_DRIVE';
  const providerFileId = input.provider_file_id.trim();
  const fileName = input.file_name.trim();
  const mimeType = input.mime_type ?? 'image/jpeg';
  const sizeBytes = input.size_bytes ?? null;
  const createdBy = input.created_by ?? null;

  const insertPayload = {
    storage_provider: storageProvider,
    provider_file_id: providerFileId,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_by: createdBy,
  };

  // Case 1: Upsert requested
  if (onConflictStrategy === 'update') {
    const { data, error } = await db
      .from('files')
      .upsert(insertPayload, { onConflict: 'storage_provider,provider_file_id' })
      .select('*')
      .single();

    if (error || !data) {
      throw new StorageError(
        StorageErrorCode.PROVIDER_ERROR,
        `Failed to upsert file record: ${error?.message ?? 'Unknown error'}`,
        { details: error }
      );
    }

    return data as FileRecord;
  }

  // Case 2: Standard Insert with Duplicate Handling
  const { data, error } = await db
    .from('files')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    const isDuplicate =
      error.code === '23505' ||
      error.message?.toLowerCase().includes('duplicate key') ||
      error.message?.toLowerCase().includes('unique constraint') ||
      error.message?.toLowerCase().includes('idx_files_provider_file') ||
      error.message?.toLowerCase().includes('uq_files_provider_file');

    if (isDuplicate) {
      if (onConflictStrategy === 'error') {
        throw new StorageError(
          StorageErrorCode.INVALID_INPUT,
          `A file record already exists for ${storageProvider}:${providerFileId}.`,
          { details: error }
        );
      }

      // Default 'return_existing': fetch and return the duplicate record
      const existing = await getFileByProviderId(providerFileId, storageProvider);
      if (existing) {
        return existing;
      }
    }

    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error creating file record: ${error.message}`,
      { details: error }
    );
  }

  if (!data) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      'Database insert completed but returned no record data.'
    );
  }

  return data as FileRecord;
}

/**
 * Fetch a single file record by its database primary key ID.
 * Returns null if the row does not exist.
 * Throws StorageError on database failure.
 */
export async function getFileRecord(id: number): Promise<FileRecord | null> {
  if (!id || id <= 0 || !Number.isInteger(id)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid file record ID: ${id}. Must be a positive integer.`
    );
  }

  const db = getDb();
  const { data, error } = await db
    .from('files')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error fetching file record #${id}: ${error.message}`,
      { details: error }
    );
  }

  return (data as FileRecord) ?? null;
}

/**
 * Fetch a file record by storage provider and provider-assigned file ID.
 * Returns null if not found.
 */
export async function getFileByProviderId(
  providerFileId: string,
  storageProvider: StorageProvider = 'GOOGLE_DRIVE'
): Promise<FileRecord | null> {
  if (!providerFileId || !providerFileId.trim()) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      'providerFileId must not be empty.'
    );
  }

  const db = getDb();
  const { data, error } = await db
    .from('files')
    .select('*')
    .eq('storage_provider', storageProvider)
    .eq('provider_file_id', providerFileId.trim())
    .maybeSingle();

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error fetching file by provider ID "${providerFileId}": ${error.message}`,
      { details: error }
    );
  }

  return (data as FileRecord) ?? null;
}

/**
 * Batch-fetch file records by an array of database primary key IDs.
 * Returns matching records, preserving order not guaranteed.
 */
export async function getFilesByIds(ids: number[]): Promise<FileRecord[]> {
  if (!ids || ids.length === 0) {
    return [];
  }

  // Sanitize IDs: filter for positive unique integers
  const validIds = Array.from(new Set(ids.filter((id) => typeof id === 'number' && id > 0 && Number.isInteger(id))));
  if (validIds.length === 0) {
    return [];
  }

  const db = getDb();
  const { data, error } = await db
    .from('files')
    .select('*')
    .in('id', validIds);

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error batch fetching file records: ${error.message}`,
      { details: error }
    );
  }

  return (data as FileRecord[]) ?? [];
}

/**
 * Checks whether a file record is referenced by any dependent tables:
 * - users.profile_picture_file_id
 * - ppe_images.file_id
 * - other_images.file_id
 *
 * Returns boolean. Throws StorageError on database failure.
 */
export async function isFileReferenced(id: number): Promise<boolean> {
  const details = await getFileReferenceDetails(id);
  return details.isReferenced;
}

/**
 * Detailed reference breakdown for a file record.
 */
export async function getFileReferenceDetails(id: number): Promise<FileReferenceDetails> {
  if (!id || id <= 0 || !Number.isInteger(id)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid file record ID: ${id}. Must be a positive integer.`
    );
  }

  const db = getDb();

  try {
    const [userRes, ppeRes, otherRes] = await Promise.all([
      db
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('profile_picture_file_id', id),
      db
        .from('ppe_images')
        .select('id', { count: 'exact', head: true })
        .eq('file_id', id),
      db
        .from('other_images')
        .select('id', { count: 'exact', head: true })
        .eq('file_id', id),
    ]);

    if (userRes.error) {
      throw new Error(`users reference query failed: ${userRes.error.message}`);
    }
    if (ppeRes.error) {
      throw new Error(`ppe_images reference query failed: ${ppeRes.error.message}`);
    }
    if (otherRes.error) {
      throw new Error(`other_images reference query failed: ${otherRes.error.message}`);
    }

    const userProfilesCount = userRes.count ?? 0;
    const ppeImagesCount = ppeRes.count ?? 0;
    const otherImagesCount = otherRes.count ?? 0;
    const isReferenced = userProfilesCount > 0 || ppeImagesCount > 0 || otherImagesCount > 0;

    return {
      isReferenced,
      userProfilesCount,
      ppeImagesCount,
      otherImagesCount,
    };
  } catch (err: any) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database failure checking references for file #${id}: ${err?.message ?? err}`,
      { cause: err }
    );
  }
}

/**
 * Deletes a file record from the database.
 *
 * Safety rules:
 * - Unless options.force is true, verifies isFileReferenced first and rejects with DELETE_FAILED
 *   if the file is still used by users, ppe_images, or other_images.
 * - Idempotent: returns true if deleted or if record was already absent.
 */
export async function deleteFileRecord(
  id: number,
  options?: DeleteFileOptions
): Promise<boolean> {
  if (!id || id <= 0 || !Number.isInteger(id)) {
    throw new StorageError(
      StorageErrorCode.INVALID_INPUT,
      `Invalid file record ID: ${id}. Must be a positive integer.`
    );
  }

  // 1. Guard against breaking foreign key references unless force is explicitly requested
  if (!options?.force) {
    const isRef = await isFileReferenced(id);
    if (isRef) {
      throw new StorageError(
        StorageErrorCode.DELETE_FAILED,
        `Cannot delete file record #${id}: file is referenced in other database records (users, ppe_images, or other_images). Remove those references first or specify force: true.`
      );
    }
  }

  // 2. Perform deletion
  const db = getDb();
  const { error } = await db
    .from('files')
    .delete()
    .eq('id', id);

  if (error) {
    throw new StorageError(
      StorageErrorCode.PROVIDER_ERROR,
      `Database error deleting file record #${id}: ${error.message}`,
      { details: error }
    );
  }

  return true;
}
