/**
 * PPEye Supabase Database Service — Submissions Repository
 *
 * Manages ppe_submissions and ppe_worker_instances tables.
 */

import { getDbClient } from '../client';
import { DatabaseError, toDatabaseError } from '../database.errors';
import type {
  CreateSubmissionHeaderInput,
  SubmissionRecord,
  SubmissionStatus,
  WorkerInstanceRecord,
} from '../database.types';

export class SubmissionsRepository {
  /**
   * Pre-creates a submission header and initial worker instances.
   */
  async createSubmissionHeader(
    input: CreateSubmissionHeaderInput,
    workerCount = 0
  ): Promise<{ submission: SubmissionRecord; workerInstances: WorkerInstanceRecord[] }> {
    if (!input.vendor_profile_id || input.vendor_profile_id <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', 'vendor_profile_id is required.');
    }
    if (!input.site_name || !input.site_name.trim()) {
      throw new DatabaseError('VALIDATION_ERROR', 'site_name is required.');
    }

    const db = getDbClient();
    const status: SubmissionStatus = input.status ?? 'SUBMITTED';
    const now = new Date().toISOString();

    const insertPayload = {
      vendor_profile_id: input.vendor_profile_id,
      site_name: input.site_name.trim(),
      metadata: input.metadata ?? null,
      status,
      submitted_by: input.submitted_by ?? null,
      submitted_at: status === 'SUBMITTED' ? now : null,
      created_at: now,
      updated_at: now,
    };

    const { data: subData, error: subError } = await db
      .from('ppe_submissions')
      .insert(insertPayload)
      .select('*')
      .single();

    if (subError || !subData) {
      throw toDatabaseError(subError, `Failed to create submission: ${subError?.message ?? 'Unknown'}`);
    }

    const submission = subData as SubmissionRecord;
    const workerInstances: WorkerInstanceRecord[] = [];

    if (workerCount > 0) {
      const instancesPayload = Array.from({ length: workerCount }, (_, i) => ({
        submission_id: submission.id,
        sequence_no: i + 1,
        created_at: now,
      }));

      const { data: instancesData, error: instancesError } = await db
        .from('ppe_worker_instances')
        .insert(instancesPayload)
        .select('*');

      if (instancesError) {
        throw toDatabaseError(
          instancesError,
          `Failed to create worker instances for submission ${submission.id}: ${instancesError.message}`
        );
      }

      if (instancesData) {
        workerInstances.push(...(instancesData as WorkerInstanceRecord[]));
      }
    }

    return { submission, workerInstances };
  }

  /**
   * Retrieves submission by primary key.
   */
  async getSubmissionById(id: number): Promise<SubmissionRecord | null> {
    if (!id || typeof id !== 'number' || id <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', `Invalid submission ID: ${id}`);
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('ppe_submissions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw toDatabaseError(error, `Failed to fetch submission ${id}: ${error.message}`);
    }

    return (data as SubmissionRecord) ?? null;
  }

  /**
   * Retrieves submissions for a specific vendor profile.
   */
  async listSubmissionsByVendor(
    vendorProfileId: number,
    options?: { status?: SubmissionStatus; limit?: number; offset?: number }
  ): Promise<SubmissionRecord[]> {
    if (!vendorProfileId || vendorProfileId <= 0) {
      return [];
    }

    const db = getDbClient();
    let query = db
      .from('ppe_submissions')
      .select('*')
      .eq('vendor_profile_id', vendorProfileId)
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }
    if (options?.limit && options.limit > 0) {
      query = query.limit(options.limit);
    }
    if (options?.offset && options.offset > 0) {
      query = query.range(options.offset, options.offset + (options.limit ?? 20) - 1);
    }

    const { data, error } = await query;
    if (error) {
      throw toDatabaseError(error, `Failed to list submissions for vendor ${vendorProfileId}: ${error.message}`);
    }

    return (data as SubmissionRecord[]) ?? [];
  }

  /**
   * Updates status of a submission.
   */
  async updateSubmissionStatus(
    id: number,
    status: SubmissionStatus,
    extra?: { submitted_at?: string; completed_at?: string }
  ): Promise<boolean> {
    if (!id || id <= 0) {
      throw new DatabaseError('VALIDATION_ERROR', `Invalid submission ID: ${id}`);
    }

    const db = getDbClient();
    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      status,
      updated_at: now,
    };

    if (status === 'SUBMITTED') {
      updatePayload.submitted_at = extra?.submitted_at ?? now;
    } else if (status === 'COMPLETED') {
      updatePayload.completed_at = extra?.completed_at ?? now;
    }

    const { error } = await db
      .from('ppe_submissions')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      throw toDatabaseError(error, `Failed to update submission status ${id}: ${error.message}`);
    }

    return true;
  }

  /**
   * Lists worker instances for a submission ordered by sequence_no.
   */
  async getWorkerInstances(submissionId: number): Promise<WorkerInstanceRecord[]> {
    if (!submissionId || submissionId <= 0) {
      return [];
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('ppe_worker_instances')
      .select('*')
      .eq('submission_id', submissionId)
      .order('sequence_no', { ascending: true });

    if (error) {
      throw toDatabaseError(error, `Failed to fetch worker instances for submission ${submissionId}: ${error.message}`);
    }

    return (data as WorkerInstanceRecord[]) ?? [];
  }
}
