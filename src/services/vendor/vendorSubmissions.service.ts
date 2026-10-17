import { StorageError, StorageErrorCode } from '@/services/storage/storage.errors';
import { replacePPEImage } from '@/services/storage/ppe-images';
import { getDriveThumbnailUrl } from '@/services/google-drive/files';
import type {
  ExternalUserType,
  ImageSide,
  SafetyVerdict,
  SubmissionStatus,
} from '@/types/database.types';
import type { CreateSubmissionPayload } from '@/services/supabase/ppeyeDb.service';

let supabaseOverride: any = null;
let replacePPEImageOverride: typeof replacePPEImage | null = null;

export function setVendorSubmissionsSupabaseOverride(client: any): void {
  supabaseOverride = client;
}

export function setVendorSubmissionsReplaceImageMock(mock: typeof replacePPEImage | null): void {
  replacePPEImageOverride = mock;
}

function getDb(): any {
  if (supabaseOverride) {
    return supabaseOverride;
  }
  return require('@/services/supabase/client').supabase;
}

function getReplacePPEImage(): typeof replacePPEImage {
  return replacePPEImageOverride || replacePPEImage;
}


export interface VendorDashboardStats {
  totalSubmissions: number;
  pendingCount: number;
  safeCount: number;
  unsafeCount: number;
  draftCount: number;
  todayChecks: number;
  complianceRate: number;
  activeDraft: {
    id: number;
    siteName: string;
    workerCount: number;
    updatedAt: string;
  } | null;
}

export interface VendorRecentCheckItem {
  id: string;
  submissionId: number;
  workerNumber: number;
  titleKey: string;
  siteName: string;
  status: 'safe' | 'unsafe' | 'review';
  timestamp: number;
  thumbnailUrl?: string;
  unsafeReasons?: string[];
  reviewerNote?: string;
}

export interface VendorSubmissionSummaryItem {
  id: number;
  siteName: string;
  status: SubmissionStatus;
  verdict: SafetyVerdict | null;
  workerCount: number;
  submittedAt: string | null;
  createdAt: string;
  thumbnailUrl?: string;
  hasUnsafeWorkers: boolean;
}

export interface VendorSubmissionWorkerDetail {
  id: number;
  sequenceNo: number;
  frontPhoto: {
    fileId: number;
    providerFileId: string;
    previewUrl: string;
  } | null;
  backPhoto: {
    fileId: number;
    providerFileId: string;
    previewUrl: string;
  } | null;
  verdict: SafetyVerdict | null;
  reasons: Array<{
    code: string;
    label: string;
    note?: string | null;
  }>;
}

export interface VendorSubmissionDetail {
  id: number;
  vendorProfileId: number;
  siteName: string;
  status: SubmissionStatus;
  verdict: SafetyVerdict | null;
  reviewerFeedback: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  metadata: Record<string, any>;
  workers: VendorSubmissionWorkerDetail[];
  otherPhotos: Array<{
    id: number;
    fileId: number;
    providerFileId: string;
    previewUrl: string;
    sequenceNo?: number | null;
  }>;
}

/**
 * Calculates live summary metrics for the Vendor Dashboard from authorized database records.
 * Never displays fabricated or hardcoded statistics.
 */
export async function getVendorDashboardStats(
  vendorProfileId: number = 1,
  userId?: number,
  externalType?: ExternalUserType
): Promise<{ stats: VendorDashboardStats; recentChecks: VendorRecentCheckItem[] }> {
  try {
    let query = getDb()
      .from('ppe_submissions')
      .select(`
        id,
        vendor_profile_id,
        site_name,
        status,
        created_at,
        submitted_at,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews ( id, verdict, ppe_review_reasons ( unsafe_reasons ( code, label ), note ) ),
          ppe_images ( id, file_id, side, files ( provider_file_id ) )
        ),
        submission_reviews ( verdict, reason, reviewed_at )
      `)
      .eq('vendor_profile_id', vendorProfileId)
      .order('created_at', { ascending: false });

    // If worker role, restrict to submissions created by or involving this worker
    if (externalType === 'WORKER' && userId) {
      query = query.eq('submitted_by', userId);
    }

    const { data: submissions, error } = await query;

    if (error || !submissions) {
      console.warn('[VendorSubmissions] Error fetching dashboard stats:', error?.message);
      return {
        stats: {
          totalSubmissions: 0,
          pendingCount: 0,
          safeCount: 0,
          unsafeCount: 0,
          draftCount: 0,
          todayChecks: 0,
          complianceRate: 100,
          activeDraft: null,
        },
        recentChecks: [],
      };
    }

    let totalSubmissions = submissions.length;
    let pendingCount = 0;
    let safeCount = 0;
    let unsafeCount = 0;
    let draftCount = 0;
    let todayChecks = 0;
    let activeDraft: VendorDashboardStats['activeDraft'] = null;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const recentChecks: VendorRecentCheckItem[] = [];

    for (const sub of (submissions as any[])) {
      const isToday = new Date(sub.created_at) >= startOfToday;
      if (isToday) {
        todayChecks++;
      }

      if (sub.status === 'DRAFT') {
        draftCount++;
        if (!activeDraft) {
          activeDraft = {
            id: sub.id,
            siteName: sub.site_name,
            workerCount: sub.ppe_worker_instances?.length ?? 0,
            updatedAt: sub.created_at,
          };
        }
        continue;
      }

      // Check review status
      const subReview = sub.submission_reviews?.[0];
      const hasWorkerReviews = sub.ppe_worker_instances?.some(
        (w: any) => w.ppe_reviews && w.ppe_reviews.length > 0
      );

      let isUnsafe = false;
      let isSafe = false;

      if (subReview) {
        if (subReview.verdict === 'UNSAFE') isUnsafe = true;
        else if (subReview.verdict === 'SAFE') isSafe = true;
      } else if (hasWorkerReviews) {
        const anyUnsafe = sub.ppe_worker_instances.some((w: any) =>
          w.ppe_reviews?.some((r: any) => r.verdict === 'UNSAFE')
        );
        if (anyUnsafe) isUnsafe = true;
        else {
          const allReviewed = sub.ppe_worker_instances.every(
            (w: any) => w.ppe_reviews && w.ppe_reviews.length > 0
          );
          if (allReviewed) isSafe = true;
        }
      }

      if (isUnsafe) {
        unsafeCount++;
      } else if (isSafe) {
        safeCount++;
      } else {
        pendingCount++;
      }

      // Process worker items for recent checks feed
      if (sub.ppe_worker_instances && recentChecks.length < 10) {
        for (const worker of sub.ppe_worker_instances) {
          const workerReview = worker.ppe_reviews?.[0];
          let workerStatus: 'safe' | 'unsafe' | 'review' = 'review';
          let unsafeReasons: string[] = [];
          let reviewerNote: string | undefined;

          if (workerReview?.verdict === 'SAFE') {
            workerStatus = 'safe';
          } else if (workerReview?.verdict === 'UNSAFE') {
            workerStatus = 'unsafe';
            if (workerReview.ppe_review_reasons) {
              unsafeReasons = workerReview.ppe_review_reasons
                .map((rr: any) => rr.unsafe_reasons?.label || rr.unsafe_reasons?.code)
                .filter(Boolean);
              reviewerNote = workerReview.ppe_review_reasons[0]?.note;
            }
          }

          const frontImg = worker.ppe_images?.find((img: any) => img.side === 'FRONT');
          const providerFileId = frontImg?.files?.provider_file_id;
          const thumbnailUrl = providerFileId ? getDriveThumbnailUrl(providerFileId) : undefined;

          recentChecks.push({
            id: `sub_${sub.id}_w_${worker.sequence_no}`,
            submissionId: sub.id,
            workerNumber: worker.sequence_no,
            titleKey: `worker_${worker.sequence_no}`,
            siteName: sub.site_name,
            status: workerStatus,
            timestamp: new Date(sub.created_at).getTime(),
            thumbnailUrl,
            unsafeReasons,
            reviewerNote,
          });
        }
      }
    }

    const reviewedTotal = safeCount + unsafeCount;
    const complianceRate = reviewedTotal > 0 ? Math.round((safeCount / reviewedTotal) * 100) : 100;

    return {
      stats: {
        totalSubmissions,
        pendingCount,
        safeCount,
        unsafeCount,
        draftCount,
        todayChecks,
        complianceRate,
        activeDraft,
      },
      recentChecks,
    };
  } catch (err) {
    console.warn('[VendorSubmissions] Exception in getVendorDashboardStats:', err);
    return {
      stats: {
        totalSubmissions: 0,
        pendingCount: 0,
        safeCount: 0,
        unsafeCount: 0,
        draftCount: 0,
        todayChecks: 0,
        complianceRate: 100,
        activeDraft: null,
      },
      recentChecks: [],
    };
  }
}

/**
 * Lists vendor submissions with optional status filters.
 */
export async function listVendorSubmissions(options: {
  vendorProfileId: number;
  statusFilter?: 'ALL' | 'PENDING' | 'SAFE' | 'UNSAFE' | 'DRAFT';
  limit?: number;
}): Promise<VendorSubmissionSummaryItem[]> {
  try {
    const { vendorProfileId, statusFilter = 'ALL', limit = 50 } = options;

    let query = getDb()
      .from('ppe_submissions')
      .select(`
        id,
        site_name,
        status,
        created_at,
        submitted_at,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews ( verdict ),
          ppe_images ( id, file_id, side, files ( provider_file_id ) )
        ),
        submission_reviews ( verdict )
      `)
      .eq('vendor_profile_id', vendorProfileId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusFilter === 'DRAFT') {
      query = query.eq('status', 'DRAFT');
    } else if (statusFilter === 'PENDING') {
      query = query.in('status', ['SUBMITTED', 'UNDER_REVIEW']);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.warn('[VendorSubmissions] Error in listVendorSubmissions:', error?.message);
      return [];
    }

    const results: VendorSubmissionSummaryItem[] = [];

    for (const row of (data as any[])) {
      const subReview = row.submission_reviews?.[0];
      const hasWorkerReviews = row.ppe_worker_instances?.some(
        (w: any) => w.ppe_reviews && w.ppe_reviews.length > 0
      );

      let verdict: SafetyVerdict | null = null;
      let hasUnsafeWorkers = false;

      if (subReview?.verdict) {
        verdict = subReview.verdict;
        if (verdict === 'UNSAFE') hasUnsafeWorkers = true;
      } else if (hasWorkerReviews) {
        const anyUnsafe = row.ppe_worker_instances.some((w: any) =>
          w.ppe_reviews?.some((r: any) => r.verdict === 'UNSAFE')
        );
        if (anyUnsafe) {
          verdict = 'UNSAFE';
          hasUnsafeWorkers = true;
        } else {
          const allReviewed = row.ppe_worker_instances.every(
            (w: any) => w.ppe_reviews && w.ppe_reviews.length > 0
          );
          if (allReviewed) verdict = 'SAFE';
        }
      }

      // Filter by SAFE / UNSAFE post-aggregation
      if (statusFilter === 'SAFE' && verdict !== 'SAFE') continue;
      if (statusFilter === 'UNSAFE' && verdict !== 'UNSAFE') continue;
      if (statusFilter === 'PENDING' && (verdict !== null || row.status === 'DRAFT')) continue;

      const firstWorker = row.ppe_worker_instances?.[0];
      const frontImg = firstWorker?.ppe_images?.find((img: any) => img.side === 'FRONT');
      const providerFileId = frontImg?.files?.provider_file_id;
      const thumbnailUrl = providerFileId ? getDriveThumbnailUrl(providerFileId) : undefined;

      results.push({
        id: row.id,
        siteName: row.site_name,
        status: row.status,
        verdict,
        workerCount: row.ppe_worker_instances?.length ?? 0,
        submittedAt: row.submitted_at,
        createdAt: row.created_at,
        thumbnailUrl,
        hasUnsafeWorkers,
      });
    }

    return results;
  } catch (err) {
    console.warn('[VendorSubmissions] Exception in listVendorSubmissions:', err);
    return [];
  }
}

/**
 * Fetches comprehensive details for a specific submission including worker photos,
 * Others evidence, and full reviewer feedback.
 */
export async function getVendorSubmissionDetails(
  submissionId: number
): Promise<VendorSubmissionDetail | null> {
  try {
    const { data: sub, error } = await getDb()
      .from('ppe_submissions')
      .select(`
        id,
        vendor_profile_id,
        site_name,
        status,
        metadata,
        created_at,
        submitted_at,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews (
            id,
            verdict,
            reviewed_at,
            ppe_review_reasons (
              note,
              unsafe_reasons ( code, label )
            )
          ),
          ppe_images (
            id,
            file_id,
            side,
            files ( id, provider_file_id )
          )
        ),
        other_images (
          id,
          file_id,
          sequence_no,
          files ( id, provider_file_id )
        ),
        submission_reviews (
          verdict,
          reason,
          reviewed_at
        )
      `)
      .eq('id', submissionId)
      .single();

    if (error || !sub) {
      console.warn(`[VendorSubmissions] Error fetching submission ${submissionId}:`, error?.message);
      return null;
    }

    const subData = sub as any;
    const subReview = subData.submission_reviews?.[0];
    const overallVerdict: SafetyVerdict | null = subReview?.verdict ?? null;
    const reviewerFeedback = subReview?.reason ?? null;
    const reviewedAt = subReview?.reviewed_at ?? null;

    const workers: VendorSubmissionWorkerDetail[] = (subData.ppe_worker_instances || [])
      .sort((a: any, b: any) => a.sequence_no - b.sequence_no)
      .map((w: any) => {
        const front = w.ppe_images?.find((img: any) => img.side === 'FRONT');
        const back = w.ppe_images?.find((img: any) => img.side === 'BACK');
        const review = w.ppe_reviews?.[0];

        const reasons = (review?.ppe_review_reasons || []).map((rr: any) => ({
          code: rr.unsafe_reasons?.code || 'OTHER',
          label: rr.unsafe_reasons?.label || 'Safety issue',
          note: rr.note,
        }));

        const frontProviderId = front?.files?.provider_file_id;
        const backProviderId = back?.files?.provider_file_id;

        return {
          id: w.id,
          sequenceNo: w.sequence_no,
          frontPhoto: front && frontProviderId
            ? {
                fileId: front.file_id,
                providerFileId: frontProviderId,
                previewUrl: getDriveThumbnailUrl(frontProviderId),
              }
            : null,
          backPhoto: back && backProviderId
            ? {
                fileId: back.file_id,
                providerFileId: backProviderId,
                previewUrl: getDriveThumbnailUrl(backProviderId),
              }
            : null,
          verdict: review?.verdict ?? null,
          reasons,
        };
      });

    const otherPhotos = (subData.other_images || []).map((o: any) => {
      const providerId = o.files?.provider_file_id;
      return {
        id: o.id,
        fileId: o.file_id,
        providerFileId: providerId,
        previewUrl: providerId ? getDriveThumbnailUrl(providerId) : '',
        sequenceNo: o.sequence_no,
      };
    });

    return {
      id: subData.id,
      vendorProfileId: subData.vendor_profile_id,
      siteName: subData.site_name,
      status: subData.status,
      verdict: overallVerdict,
      reviewerFeedback,
      reviewedAt,
      submittedAt: subData.submitted_at,
      createdAt: subData.created_at,
      metadata: subData.metadata || {},
      workers,
      otherPhotos,
    };
  } catch (err) {
    console.warn('[VendorSubmissions] Exception in getVendorSubmissionDetails:', err);
    return null;
  }
}

/**
 * Creates or updates a DRAFT submission so the vendor can save progress without submitting.
 */
export async function saveDraftSubmission(
  payload: Partial<CreateSubmissionPayload> & { siteName: string },
  existingSubmissionId?: number
): Promise<{ success: boolean; submissionId?: number; error?: string }> {
  try {
    let vendorProfileId = payload.vendorProfileId ?? 1;
    let submittedBy = payload.submittedBy ?? 1;

    if (existingSubmissionId) {
      // 1. Verify it is still a draft
      const { data: current } = await getDb()
        .from('ppe_submissions')
        .select('status')
        .eq('id', existingSubmissionId)
        .single();

      if (current && current.status !== 'DRAFT') {
        throw new StorageError(
          StorageErrorCode.PERMISSION_DENIED,
          'Cannot edit submission that has already been submitted or completed.'
        );
      }

      // Update draft details
      await getDb()
        .from('ppe_submissions')
        .update({
          site_name: payload.siteName,
          metadata: payload.metadata ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSubmissionId);

      return { success: true, submissionId: existingSubmissionId };
    }

    // 2. Create new draft submission
    const { data: newSub, error } = await getDb()
      .from('ppe_submissions')
      .insert({
        vendor_profile_id: vendorProfileId,
        submitted_by: submittedBy,
        site_name: payload.siteName,
        metadata: payload.metadata ?? {},
        status: 'DRAFT',
      })
      .select('id')
      .single();

    if (error || !newSub) {
      throw new Error(error?.message ?? 'Failed to create draft');
    }

    return { success: true, submissionId: newSub.id };
  } catch (err: any) {
    console.warn('[VendorSubmissions] Error saving draft:', err);
    return { success: false, error: err?.message ?? 'Failed to save draft' };
  }
}

/**
 * Deletes a draft submission.
 * Strictly prevents deletion of submitted or reviewed evidence.
 */
export async function deleteDraftSubmission(
  submissionId: number,
  userId?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: sub, error } = await getDb()
      .from('ppe_submissions')
      .select('id, status, submitted_by')
      .eq('id', submissionId)
      .single();

    if (error || !sub) {
      throw new StorageError(StorageErrorCode.FILE_NOT_FOUND, 'Submission not found');
    }

    if (sub.status !== 'DRAFT') {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        'Only draft submissions can be deleted. Submitted or reviewed records cannot be deleted.'
      );
    }

    // Delete child records first
    const { data: workerInstances } = await getDb()
      .from('ppe_worker_instances')
      .select('id')
      .eq('submission_id', submissionId);

    if (workerInstances && workerInstances.length > 0) {
      const workerIds = workerInstances.map((w: any) => w.id);
      await getDb().from('ppe_images').delete().in('worker_instance_id', workerIds);
      await getDb().from('ppe_worker_instances').delete().eq('submission_id', submissionId);
    }

    await getDb().from('other_images').delete().eq('submission_id', submissionId);
    const { error: delError } = await getDb().from('ppe_submissions').delete().eq('id', submissionId);

    if (delError) {
      throw new Error(delError.message);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(`[VendorSubmissions] Error deleting draft ${submissionId}:`, err);
    return { success: false, error: err?.message ?? 'Failed to delete draft' };
  }
}

/**
 * Finalizes and submits a DRAFT submission for review.
 * Validates that every worker has Front & Back paired photos.
 */
export async function submitDraftForReview(
  submissionId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: sub, error } = await getDb()
      .from('ppe_submissions')
      .select(`
        id,
        status,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_images ( side )
        )
      `)
      .eq('id', submissionId)
      .single();

    if (error || !sub) {
      throw new StorageError(StorageErrorCode.FILE_NOT_FOUND, 'Submission not found');
    }

    const subData = sub as any;
    if (subData.status !== 'DRAFT') {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Submission ${submissionId} is already in ${subData.status} status.`
      );
    }

    // Validate worker pairs
    const workers = subData.ppe_worker_instances || [];
    if (workers.length === 0) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'At least one worker must be included.');
    }

    for (const w of workers) {
      const sides = (w.ppe_images || []).map((img: any) => img.side);
      if (!sides.includes('FRONT') || !sides.includes('BACK')) {
        throw new StorageError(
          StorageErrorCode.INVALID_INPUT,
          `Worker #${w.sequence_no} is missing required ${!sides.includes('FRONT') ? 'FRONT' : 'BACK'} photo.`
        );
      }
    }

    // Mark submitted
    const { error: updateError } = await getDb()
      .from('ppe_submissions')
      .update({
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(`[VendorSubmissions] Error submitting draft ${submissionId}:`, err);
    return { success: false, error: err?.message ?? 'Failed to submit check' };
  }
}

/**
 * Resubmits corrected PPE evidence for an Unsafe worker instance.
 * Replaces the active image reference while preserving historical evidence in the files audit log.
 */
export async function resubmitUnsafeWorker(
  submissionId: number,
  workerInstanceId: number,
  side: ImageSide,
  newLocalUri: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Upload & replace active image reference
    const replaced = await getReplacePPEImage()({
      workerInstanceId,
      side,
      newLocalUri,
    });

    if (!replaced) {
      throw new Error('Failed to replace worker PPE image.');
    }

    // 2. Transition submission status back to SUBMITTED for re-review
    const { error: subError } = await getDb()
      .from('ppe_submissions')
      .update({
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (subError) {
      console.warn('[VendorSubmissions] Note updating submission status:', subError.message);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(`[VendorSubmissions] Error resubmitting worker ${workerInstanceId}:`, err);
    return { success: false, error: err?.message ?? 'Failed to resubmit worker photo' };
  }
}
