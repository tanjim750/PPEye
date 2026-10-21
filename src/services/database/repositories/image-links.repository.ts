/**
 * PPEye Supabase Database Service — Image Links Repository
 *
 * Manages relational junction tables:
 * - ppe_images (worker instance <-> files)
 * - other_images (submission <-> files)
 */

import { getDbClient } from '../client';
import { DatabaseError, toDatabaseError } from '../database.errors';
import type { ImageSide, OtherImageRecord, PPEImageRecord } from '../database.types';

export class ImageLinksRepository {
  /**
   * Links a PPE worker inspection photo to a worker instance.
   * If a record for the specified (workerInstanceId, side) already exists, updates the file_id.
   */
  async linkPPEWorkerImage(
    workerInstanceId: number,
    fileId: number,
    side: ImageSide
  ): Promise<PPEImageRecord> {
    if (!workerInstanceId || workerInstanceId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'workerInstanceId is required.');
    }
    if (!fileId || fileId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'fileId is required.');
    }
    if (side !== 'FRONT' && side !== 'BACK') {
      throw new DatabaseError('VALIDATION_ERROR', `Invalid side: ${side}. Must be FRONT or BACK.`);
    }

    const db = getDbClient();
    const now = new Date().toISOString();

    // Check if an image row already exists for this worker instance & side
    const { data: existing, error: findError } = await db
      .from('ppe_images')
      .select('*')
      .eq('worker_instance_id', workerInstanceId)
      .eq('side', side)
      .maybeSingle();

    if (findError) {
      throw toDatabaseError(findError, `Failed to check existing PPE image: ${findError.message}`);
    }

    if (existing) {
      const { data: updated, error: updateError } = await db
        .from('ppe_images')
        .update({ file_id: fileId, created_at: now })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updateError || !updated) {
        throw toDatabaseError(updateError, `Failed to update PPE image link: ${updateError?.message ?? 'Unknown'}`);
      }
      return updated as PPEImageRecord;
    }

    // Insert new link
    const { data: inserted, error: insertError } = await db
      .from('ppe_images')
      .insert({
        worker_instance_id: workerInstanceId,
        file_id: fileId,
        side,
        created_at: now,
      })
      .select('*')
      .single();

    if (insertError || !inserted) {
      throw toDatabaseError(insertError, `Failed to link PPE worker image: ${insertError?.message ?? 'Unknown'}`);
    }

    return inserted as PPEImageRecord;
  }

  /**
   * Replaces an existing worker image pointer with a newly uploaded file ID (e.g. resubmission).
   * Historical file records in public.files remain intact for audit logs.
   */
  async replacePPEWorkerImage(
    workerInstanceId: number,
    side: ImageSide,
    newFileId: number
  ): Promise<PPEImageRecord> {
    return this.linkPPEWorkerImage(workerInstanceId, newFileId, side);
  }

  /**
   * Links a site evidence or other hazard photo to a submission.
   */
  async linkOtherImage(
    submissionId: number,
    fileId: number,
    sequenceNo: number
  ): Promise<OtherImageRecord> {
    if (!submissionId || submissionId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'submissionId is required.');
    }
    if (!fileId || fileId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'fileId is required.');
    }

    const db = getDbClient();
    const now = new Date().toISOString();

    const { data, error } = await db
      .from('other_images')
      .insert({
        submission_id: submissionId,
        file_id: fileId,
        sequence_no: sequenceNo,
        created_at: now,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw toDatabaseError(error, `Failed to link other image: ${error?.message ?? 'Unknown'}`);
    }

    return data as OtherImageRecord;
  }

  /**
   * Deletes a PPE worker image junction record.
   * Useful for compensating rollback during submission coordination.
   */
  async deletePPEWorkerImage(workerInstanceId: number, side: ImageSide): Promise<boolean> {
    if (!workerInstanceId || workerInstanceId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'workerInstanceId is required.');
    }
    const db = getDbClient();
    const { error } = await db
      .from('ppe_images')
      .delete()
      .eq('worker_instance_id', workerInstanceId)
      .eq('side', side);

    if (error) {
      throw toDatabaseError(error, `Failed to delete PPE worker image link: ${error.message}`);
    }
    return true;
  }

  /**
   * Deletes an other_images junction record by ID.
   * Useful for compensating rollback during submission coordination.
   */
  async deleteOtherImage(otherImageId: number): Promise<boolean> {
    if (!otherImageId || otherImageId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'otherImageId is required.');
    }
    const db = getDbClient();
    const { error } = await db
      .from('other_images')
      .delete()
      .eq('id', otherImageId);

    if (error) {
      throw toDatabaseError(error, `Failed to delete other image link: ${error.message}`);
    }
    return true;
  }

  /**
   * Retrieves active front and back PPE images for a worker instance.
   */
  async getWorkerImages(
    workerInstanceId: number
  ): Promise<{ front: PPEImageRecord | null; back: PPEImageRecord | null }> {
    if (!workerInstanceId || workerInstanceId <= 0) {
      return { front: null, back: null };
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('ppe_images')
      .select('*')
      .eq('worker_instance_id', workerInstanceId);

    if (error) {
      throw toDatabaseError(error, `Failed to fetch images for worker ${workerInstanceId}: ${error.message}`);
    }

    const records = (data as PPEImageRecord[]) ?? [];
    const front = records.find((r) => r.side === 'FRONT') ?? null;
    const back = records.find((r) => r.side === 'BACK') ?? null;

    return { front, back };
  }

  /**
   * Updates a user's profile picture reference in public.users.
   * Pass fileId as null to clear the profile picture.
   */
  async updateUserProfilePicture(
    userId: number,
    fileId: number | null
  ): Promise<{ id: number; profile_picture_file_id: number | null }> {
    if (!userId || userId <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'userId is required.');
    }
    if (fileId !== null && (typeof fileId !== 'number' || fileId <= 0)) {
      throw new DatabaseError('VALIDATION_ERROR', 'fileId must be a positive number or null.');
    }

    const db = getDbClient();
    const now = new Date().toISOString();

    const { data, error } = await db
      .from('users')
      .update({ profile_picture_file_id: fileId, updated_at: now })
      .eq('id', userId)
      .select('id, profile_picture_file_id')
      .single();

    if (error || !data) {
      throw toDatabaseError(error, `Failed to update user profile picture: ${error?.message ?? 'Unknown'}`);
    }

    return data as { id: number; profile_picture_file_id: number | null };
  }

  /**
   * Retrieves a user's current profile picture file ID.
   */
  async getUserProfilePictureFileId(userId: number): Promise<number | null> {
    if (!userId || userId <= 0) {
      return null;
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('users')
      .select('profile_picture_file_id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw toDatabaseError(error, `Failed to fetch user profile picture ID: ${error.message}`);
    }

    return (data as any)?.profile_picture_file_id ?? null;
  }

  /**
   * Retrieves other evidence photos for a submission ordered by sequence_no.
   */
  async getSubmissionOtherImages(submissionId: number): Promise<OtherImageRecord[]> {
    if (!submissionId || submissionId <= 0) {
      return [];
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('other_images')
      .select('*')
      .eq('submission_id', submissionId)
      .order('sequence_no', { ascending: true });

    if (error) {
      throw toDatabaseError(error, `Failed to fetch other images for submission ${submissionId}: ${error.message}`);
    }

    return (data as OtherImageRecord[]) ?? [];
  }
}
