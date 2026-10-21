/**
 * PPEye Supabase Storage Service — Path Generator
 *
 * Generates deterministic, collision-resistant storage paths partitioned by submission and user.
 * Paths are strictly aligned with PostgreSQL RLS helper functions:
 * - get_submission_id_from_storage_path (^submissions/[0-9]+/)
 * - get_user_id_from_storage_path (^users/[0-9]+/)
 */

import type { StorageBucket } from './supabase-storage.types';

export function generateRandomEntropy(length = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export interface PathGeneratorOptions {
  timestamp?: number;
  entropy?: string;
}

/**
 * Generates standard storage path for a PPE worker inspection photo.
 * Example: 'submissions/45/workers/1_front_1729512345678_k8a9f2.jpg'
 */
export function generateWorkerPhotoPath(
  submissionId: number,
  workerSequenceNo: number,
  side: 'FRONT' | 'BACK',
  options?: PathGeneratorOptions
): string {
  if (!submissionId || submissionId <= 0) {
    throw new Error(`Invalid submissionId: ${submissionId}`);
  }
  if (!workerSequenceNo || workerSequenceNo <= 0) {
    throw new Error(`Invalid workerSequenceNo: ${workerSequenceNo}`);
  }
  const timestamp = options?.timestamp ?? Date.now();
  const entropy = options?.entropy ?? generateRandomEntropy();
  const sideLower = side.toLowerCase();

  return `submissions/${submissionId}/workers/${workerSequenceNo}_${sideLower}_${timestamp}_${entropy}.jpg`;
}

/**
 * Generates standard storage path for general site evidence or other hazard photos.
 * Example: 'submissions/45/others/other_1_1729512345678_m3n7x1.jpg'
 */
export function generateOtherEvidencePath(
  submissionId: number,
  sequenceNo: number,
  options?: PathGeneratorOptions
): string {
  if (!submissionId || submissionId <= 0) {
    throw new Error(`Invalid submissionId: ${submissionId}`);
  }
  if (!sequenceNo || sequenceNo <= 0) {
    throw new Error(`Invalid sequenceNo: ${sequenceNo}`);
  }
  const timestamp = options?.timestamp ?? Date.now();
  const entropy = options?.entropy ?? generateRandomEntropy();

  return `submissions/${submissionId}/others/other_${sequenceNo}_${timestamp}_${entropy}.jpg`;
}

/**
 * Generates standard storage path for a user profile avatar.
 * Example: 'users/12/avatar_1729512345678_q9w2e4.jpg'
 */
export function generateAvatarPath(
  userId: number,
  options?: PathGeneratorOptions
): string {
  if (!userId || userId <= 0) {
    throw new Error(`Invalid userId: ${userId}`);
  }
  const timestamp = options?.timestamp ?? Date.now();
  const entropy = options?.entropy ?? generateRandomEntropy();

  return `users/${userId}/avatar_${timestamp}_${entropy}.jpg`;
}

/**
 * Validates that a storage path matches bucket conventions and RLS extraction regex.
 */
export function isValidStoragePath(path: string, bucket: StorageBucket): boolean {
  if (!path || typeof path !== 'string' || path.includes('..')) {
    return false;
  }

  if (bucket === 'evidence') {
    return /^submissions\/[0-9]+\/(workers\/[0-9]+_(front|back)_[0-9]+_[a-z0-9]+\.(jpg|jpeg|png|webp)|others\/other_[0-9]+_[0-9]+_[a-z0-9]+\.(jpg|jpeg|png|webp))$/.test(
      path
    );
  }

  if (bucket === 'avatars') {
    return /^users\/[0-9]+\/avatar_[0-9]+_[a-z0-9]+\.(jpg|jpeg|png)$/.test(path);
  }

  return false;
}
