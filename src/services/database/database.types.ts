/**
 * PPEye Supabase Database Service — Domain Types
 *
 * All primary and foreign keys mapped from BIGINT are typed as safe JavaScript numbers.
 */

import type { Database } from '@/types/database.types';

export type StorageProvider = 'SUPABASE' | 'GOOGLE_DRIVE';
export type SubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'COMPLETED';
export type ImageSide = 'FRONT' | 'BACK';
export type ReviewVerdict = 'SAFE' | 'UNSAFE';

export interface FileRecord {
  id: number;
  storage_provider: StorageProvider;
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_by: number | null;
  created_at: string;
}

export interface CreateFileInput {
  storage_provider?: StorageProvider;
  provider_file_id: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_by?: number | null;
  onConflict?: 'ignore' | 'update' | 'error';
}

export interface SubmissionRecord {
  id: number;
  vendor_profile_id: number;
  site_name: string;
  metadata: Record<string, any> | null;
  status: SubmissionStatus;
  submitted_by: number | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSubmissionHeaderInput {
  vendor_profile_id: number;
  site_name: string;
  metadata?: Record<string, any> | null;
  status?: SubmissionStatus;
  submitted_by?: number | null;
}

export interface WorkerInstanceRecord {
  id: number;
  submission_id: number;
  sequence_no: number;
  created_at: string;
}

export interface PPEImageRecord {
  id: number;
  worker_instance_id: number;
  file_id: number;
  side: ImageSide;
  created_at: string;
}

export interface OtherImageRecord {
  id: number;
  submission_id: number;
  file_id: number;
  sequence_no: number;
  created_at: string;
}

export interface SubmissionReviewRecord {
  id: number;
  submission_id: number;
  reviewer_id: number;
  status: 'APPROVED' | 'ACTION_REQUIRED' | 'UNDER_REVIEW';
  verdict: ReviewVerdict | null;
  reason: string | null;
  reviewed_at: string;
}

export interface PpeReviewRecord {
  id: number;
  worker_instance_id: number;
  reviewer_id: number;
  verdict: ReviewVerdict;
  reviewed_at: string;
}

export interface UnsafeReasonRecord {
  id: number;
  code: string;
  label: string;
  category: string | null;
  is_active: boolean;
}
