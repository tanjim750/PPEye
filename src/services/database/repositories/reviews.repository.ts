/**
 * PPEye Supabase Database Service — Reviews Repository
 *
 * Manages queries for submission_reviews, ppe_reviews, and unsafe_reasons tables.
 */

import { getDbClient } from '../client';
import { DatabaseError, toDatabaseError } from '../database.errors';
import type {
  PpeReviewRecord,
  SubmissionReviewRecord,
  UnsafeReasonRecord,
} from '../database.types';

export class ReviewsRepository {
  /**
   * Retrieves review outcome for a submission.
   */
  async getSubmissionReview(submissionId: number): Promise<SubmissionReviewRecord | null> {
    if (!submissionId || submissionId <= 0) {
      return null;
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('submission_reviews')
      .select('*')
      .eq('submission_id', submissionId)
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw toDatabaseError(error, `Failed to fetch review for submission ${submissionId}: ${error.message}`);
    }

    return (data as SubmissionReviewRecord) ?? null;
  }

  /**
   * Retrieves worker review history for a worker instance.
   */
  async getWorkerReviews(workerInstanceId: number): Promise<PpeReviewRecord[]> {
    if (!workerInstanceId || workerInstanceId <= 0) {
      return [];
    }

    const db = getDbClient();
    const { data, error } = await db
      .from('ppe_reviews')
      .select('*')
      .eq('worker_instance_id', workerInstanceId)
      .order('reviewed_at', { ascending: false });

    if (error) {
      throw toDatabaseError(error, `Failed to fetch reviews for worker ${workerInstanceId}: ${error.message}`);
    }

    return (data as PpeReviewRecord[]) ?? [];
  }

  /**
   * Lists active unsafe taxonomy reasons.
   */
  async listUnsafeReasons(): Promise<UnsafeReasonRecord[]> {
    const db = getDbClient();
    const { data, error } = await db
      .from('unsafe_reasons')
      .select('*')
      .eq('is_active', true)
      .order('id', { ascending: true });

    if (error) {
      throw toDatabaseError(error, `Failed to list unsafe reasons: ${error.message}`);
    }

    return (data as UnsafeReasonRecord[]) ?? [];
  }
}
