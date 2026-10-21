/**
 * PPEye Supabase Database Service — Files Repository
 *
 * Owns persistence, lookups, reference validation, and deletion of file metadata in public.files.
 */

import { getDbClient } from '../client';
import { DatabaseError, toDatabaseError } from '../database.errors';
import type { CreateFileInput, FileRecord, StorageProvider } from '../database.types';

export class FilesRepository {
  /**
   * Persists file metadata record in public.files.
   * Uses provider_file_id as the canonical storage object identifier.
   */
  async createFileRecord(input: CreateFileInput): Promise<FileRecord> {
    if (!input.provider_file_id || !input.provider_file_id.trim()) {
      throw new DatabaseError('VALIDATION_ERROR', 'provider_file_id is required and cannot be empty.');
    }
    if (!input.file_name || !input.file_name.trim()) {
      throw new DatabaseError('VALIDATION_ERROR', 'file_name is required and cannot be empty.');
    }
    if (input.size_bytes !== undefined && input.size_bytes !== null && input.size_bytes < 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'size_bytes cannot be negative.');
    }

    const db = getDbClient();
    const storageProvider: StorageProvider = input.storage_provider ?? 'SUPABASE';
    const providerFileId = input.provider_file_id.trim();
    const fileName = input.file_name.trim();
    const mimeType = input.mime_type ?? 'image/jpeg';
    const sizeBytes = input.size_bytes ?? null;
    const createdBy = input.created_by ?? null;
    const onConflict = input.onConflict ?? 'ignore';

    const insertPayload = {
      storage_provider: storageProvider,
      provider_file_id: providerFileId,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      created_by: createdBy,
    };

    if (onConflict === 'update') {
      const { data, error } = await db
        .from('files')
        .upsert(insertPayload, { onConflict: 'storage_provider,provider_file_id' })
        .select('*')
        .single();

      if (error || !data) {
        throw toDatabaseError(error, `Failed to upsert file record: ${error?.message ?? 'Unknown'}`);
      }
      return data as FileRecord;
    }

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
        error.message?.toLowerCase().includes('uq_files_provider_file');

      if (isDuplicate) {
        if (onConflict === 'error') {
          throw new DatabaseError('CONFLICT', `File record already exists for ${storageProvider}:${providerFileId}`);
        }
        // onConflict === 'ignore': Fetch and return existing
        const existing = await this.getFileRecordByProviderId(providerFileId, storageProvider);
        if (existing) {
          return existing;
        }
      }
      throw toDatabaseError(error, `Failed to insert file record: ${error.message}`);
    }

    return data as FileRecord;
  }

  /**
   * Retrieves a file record by its BIGINT primary key ID.
   */
  async getFileRecordById(id: number): Promise<FileRecord | null> {
    if (!id || typeof id !== 'number' || id <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', `Invalid file ID: ${id}`);
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('files')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw toDatabaseError(error, `Failed to fetch file ID ${id}: ${error.message}`);
    }

    return (data as FileRecord) ?? null;
  }

  /**
   * Retrieves a file record by relative storage path or provider file ID.
   */
  async getFileRecordByProviderId(
    providerFileId: string,
    provider: StorageProvider = 'SUPABASE'
  ): Promise<FileRecord | null> {
    if (!providerFileId || !providerFileId.trim()) {
      return null;
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('files')
      .select('*')
      .eq('storage_provider', provider)
      .eq('provider_file_id', providerFileId.trim())
      .maybeSingle();

    if (error) {
      throw toDatabaseError(error, `Failed to fetch file by provider path ${providerFileId}: ${error.message}`);
    }

    return (data as FileRecord) ?? null;
  }

  /**
   * Batch retrieval of multiple file records by their primary keys.
   */
  async getFilesByIds(ids: number[]): Promise<FileRecord[]> {
    const validIds = ids.filter((id) => typeof id === 'number' && id > 0);
    if (validIds.length === 0) {
      return [];
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('files')
      .select('*')
      .in('id', validIds);

    if (error) {
      throw toDatabaseError(error, `Failed to fetch files by IDs: ${error.message}`);
    }

    return (data as FileRecord[]) ?? [];
  }

  /**
   * Checks whether a file record is actively referenced in:
   * - public.users (profile_picture_file_id)
   * - public.ppe_images (file_id)
   * - public.other_images (file_id)
   */
  async isFileReferenced(id: number): Promise<boolean> {
    if (!id || typeof id !== 'number' || id <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', `Invalid file ID for reference check: ${id}`);
    }

    const db = getDbClient();

    const [userRef, ppeRef, otherRef] = await Promise.all([
      db.from('users').select('id').eq('profile_picture_file_id', id).limit(1),
      db.from('ppe_images').select('id').eq('file_id', id).limit(1),
      db.from('other_images').select('id').eq('file_id', id).limit(1),
    ]);

    if (userRef.error) throw toDatabaseError(userRef.error);
    if (ppeRef.error) throw toDatabaseError(ppeRef.error);
    if (otherRef.error) throw toDatabaseError(otherRef.error);

    return (
      (userRef.data?.length ?? 0) > 0 ||
      (ppeRef.data?.length ?? 0) > 0 ||
      (otherRef.data?.length ?? 0) > 0
    );
  }

  /**
   * Deletes a file record from public.files.
   *
   * By default, performs an application-level pre-check via isFileReferenced() to fail fast
   * if the file is linked to users.profile_picture_file_id, ppe_images.file_id, or other_images.file_id.
   *
   * NOTE ON `options.force`:
   * - Setting `force: true` ONLY skips the client-side pre-flight query optimization.
   * - It CANNOT and DOES NOT bypass PostgreSQL Row Level Security (RLS) or database foreign key constraints.
   * - Under "Files delete policy", PostgreSQL independently enforces that:
   *     1) The caller is an internal user OR created_by == current_app_user_id()
   *     2) The file has zero references in users, ppe_images, or other_images.
   * - If any reference exists in PostgreSQL, the database engine will reject the DELETE with
   *   error 42501 (RLS violation) or 23503 (FK violation), regardless of `force: true`.
   *
   * ATOMICITY & SEQUENCING CONTRACT:
   * Storage binary uploads operate outside PostgreSQL transactions. Therefore:
   * 1. If Storage upload succeeds but Metadata insert fails:
   *    -> Compensating action: Call supabase_storage_service.deleteFile(path).
   * 2. If Metadata insert succeeds but Junction linking (ppe_images) fails:
   *    -> Compensating action: Call deleteFileRecord(fileId) [which succeeds because no junction
   *       reference exists yet], followed by supabase_storage_service.deleteFile(path).
   */
  async deleteFileRecord(id: number, options?: { force?: boolean }): Promise<boolean> {
    if (!id || typeof id !== 'number' || id <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', `Invalid file ID: ${id}`);
    }

    if (!options?.force) {
      const referenced = await this.isFileReferenced(id);
      if (referenced) {
        throw new DatabaseError(
          'CONFLICT',
          `Cannot delete file ${id}: actively referenced in user profile, PPE image, or other image records.`
        );
      }
    }

    const db = getDbClient();
    const { error } = await db.from('files').delete().eq('id', id);

    if (error) {
      throw toDatabaseError(error, `Failed to delete file record ${id}: ${error.message}`);
    }

    return true;
  }
}
