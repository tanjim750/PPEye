import { getDriveThumbnailUrl } from "@/services/google-drive/files";
import { replacePPEImage } from "@/services/storage/ppe-images";
import {
  StorageError,
  StorageErrorCode,
} from "@/services/storage/storage.errors";
import type { CreateSubmissionPayload } from "@/services/supabase/ppeyeDb.service";
import type {
  ExternalUserType,
  ImageSide,
  SafetyVerdict,
  SubmissionStatus,
} from "@/types/database.types";

export function latestCurrentReview(worker: any, metadataReview?: any): any | null {
  const latestPhotoAt = Math.max(0, ...(worker.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime()));
  const latest = [...(worker.ppe_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at || 0).getTime() - new Date(a.reviewed_at || 0).getTime())[0];
  if (latest && new Date(latest.reviewed_at || 0).getTime() >= latestPhotoAt) return latest;
  if (metadataReview && Number(metadataReview.reviewedAt || 0) >= latestPhotoAt) {
    return { verdict: metadataReview.status === 'safe' ? 'SAFE' : 'UNSAFE', reviewed_at: new Date(Number(metadataReview.reviewedAt)).toISOString(), ppe_review_reasons: (metadataReview.unsafeReasons || []).map((code: string) => ({ unsafe_reasons: { code, label: code }, note: metadataReview.otherReasonText })) };
  }
  return null;
}

export function mapCurrentWorkerReviewStatus(worker: any, metadataReview?: any): "safe" | "unsafe" | "review" {
  const review = latestCurrentReview(worker, metadataReview);
  if (!review) return "review";
  return review.verdict === "SAFE" ? "safe" : "unsafe";
}

let supabaseOverride: any = null;
let replacePPEImageOverride: typeof replacePPEImage | null = null;

export function setVendorSubmissionsSupabaseOverride(client: any): void {
  supabaseOverride = client;
}

export function setVendorSubmissionsReplaceImageMock(
  mock: typeof replacePPEImage | null,
): void {
  replacePPEImageOverride = mock;
}

function getDb(): any {
  if (supabaseOverride) {
    return supabaseOverride;
  }
  return require("@/services/supabase/client").supabase;
}

function resolvePreviewUrl(
  providerFileId?: string | null,
  storageProvider?: string | null
): string {
  if (!providerFileId || !providerFileId.trim()) return "";
  const clean = providerFileId.trim();
  if (
    clean.startsWith("http://") ||
    clean.startsWith("https://") ||
    clean.startsWith("file://")
  ) {
    return clean;
  }
  const isSupabase =
    storageProvider === "SUPABASE" ||
    clean.startsWith("submissions/") ||
    clean.startsWith("users/") ||
    clean.includes("/");

  if (isSupabase) {
    const { getCachedImageUriSync } = require("@/utils/image");
    const cached = getCachedImageUriSync(clean);
    if (cached) return cached;
    return clean;
  }

  return getDriveThumbnailUrl(clean);
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
  status: "safe" | "unsafe" | "review";
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
  vendorProfileId: number,
  userId?: number,
  externalType?: ExternalUserType,
): Promise<{
  stats: VendorDashboardStats;
  recentChecks: VendorRecentCheckItem[];
}> {
  try {
    let query = getDb()
      .from("ppe_submissions")
      .select(
        `
        id,
        vendor_profile_id,
        site_name,
        status,
        metadata,
        created_at,
        updated_at,
        submitted_at,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews ( id, verdict, reviewed_at, ppe_review_reasons ( unsafe_reasons ( code, label ), note ) ),
          ppe_images ( id, file_id, side, created_at, files ( id, file_name, provider_file_id ) )
        ),
        submission_reviews ( verdict, reason, reviewed_at )
      `,
      )
      .eq("vendor_profile_id", vendorProfileId)
      .order("created_at", { ascending: false });

    // If worker role, restrict to submissions created by or involving this worker
    if (externalType === "WORKER" && userId) {
      query = query.eq("submitted_by", userId);
    }

    const { data: submissions, error } = await query;

    if (error || !submissions) {
      console.warn(
        "[VendorSubmissions] Error fetching dashboard stats:",
        error?.message,
      );
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
    let activeDraft: VendorDashboardStats["activeDraft"] = null;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const recentChecks: VendorRecentCheckItem[] = [];

    for (const sub of submissions as any[]) {
      const isToday = new Date(sub.created_at) >= startOfToday;
      if (isToday) {
        todayChecks++;
      }

      if (sub.status === "DRAFT") {
        draftCount++;
        if (!activeDraft) {
          activeDraft = {
            id: sub.id,
            siteName: sub.site_name,
            workerCount: sub.ppe_worker_instances?.length ?? 0,
            updatedAt: sub.updated_at || sub.created_at,
          };
        }
        continue;
      }

      // Check review status
      const subReview = [...(sub.submission_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at || 0).getTime() - new Date(a.reviewed_at || 0).getTime())[0];
      const currentWorkerReviews = (sub.ppe_worker_instances || []).map((worker: any) => latestCurrentReview(worker, (sub.metadata?.workerReviews || []).find((item: any) => Number(item.sequenceNo) === Number(worker.sequence_no))));
      const hasWorkerReviews = currentWorkerReviews.some(Boolean);

      let isUnsafe = false;
      let isSafe = false;

      if (currentWorkerReviews.length && currentWorkerReviews.every(Boolean)) {
        isUnsafe = currentWorkerReviews.some((review: any) => review.verdict === "UNSAFE");
        isSafe = !isUnsafe;
      } else if (subReview) {
        const latestPhotoAt = Math.max(0, ...(sub.ppe_worker_instances || []).flatMap((worker: any) => (worker.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime())));
        if (new Date(subReview.reviewed_at || 0).getTime() >= latestPhotoAt) {
          isUnsafe = subReview.verdict === "UNSAFE";
          isSafe = subReview.verdict === "SAFE";
        }
      } else if (hasWorkerReviews) {
        const anyUnsafe = currentWorkerReviews.some((review: any) => review?.verdict === "UNSAFE");
        if (anyUnsafe) isUnsafe = true;
        else {
          const allReviewed = currentWorkerReviews.every(Boolean);
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
          if (recentChecks.length >= 10) break;
          const workerReview = latestCurrentReview(worker, (sub.metadata?.workerReviews || []).find((item: any) => Number(item.sequenceNo) === Number(worker.sequence_no)));
          let workerStatus: "safe" | "unsafe" | "review" = "review";
          let unsafeReasons: string[] = [];
          let reviewerNote: string | undefined;

          if (workerReview?.verdict === "SAFE") {
            workerStatus = "safe";
          } else if (workerReview?.verdict === "UNSAFE") {
            workerStatus = "unsafe";
            if (workerReview.ppe_review_reasons) {
              unsafeReasons = workerReview.ppe_review_reasons
                .map(
                  (rr: any) =>
                    rr.unsafe_reasons?.label || rr.unsafe_reasons?.code,
                )
                .filter(Boolean);
              reviewerNote = workerReview.ppe_review_reasons[0]?.note;
            }
          }

          const frontImg = [...(worker.ppe_images || [])]
            .filter((img: any) => img.side === "FRONT")
            .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          const providerFileId = frontImg?.files?.provider_file_id;
          const thumbnailUrl = providerFileId
            ? resolvePreviewUrl(providerFileId, frontImg?.files?.storage_provider)
            : undefined;

          recentChecks.push({
            id: `sub_${sub.id}_w_${worker.sequence_no}`,
            submissionId: sub.id,
            workerNumber: worker.sequence_no,
            titleKey: `worker_${worker.sequence_no}`,
            siteName: sub.site_name,
            status: workerStatus,
            timestamp: Math.max(
              new Date(sub.created_at).getTime(),
              ...((worker.ppe_images || []).map((img: any) => new Date(img.created_at || 0).getTime())),
              workerReview?.reviewed_at ? new Date(workerReview.reviewed_at).getTime() : 0,
            ),
            thumbnailUrl,
            unsafeReasons,
            reviewerNote,
          });
        }
      }
    }

    const reviewedTotal = safeCount + unsafeCount;
    const complianceRate =
      reviewedTotal > 0 ? Math.round((safeCount / reviewedTotal) * 100) : 100;

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
    console.warn(
      "[VendorSubmissions] Exception in getVendorDashboardStats:",
      err,
    );
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
  statusFilter?: "ALL" | "PENDING" | "SAFE" | "UNSAFE" | "DRAFT";
  limit?: number;
}): Promise<VendorSubmissionSummaryItem[]> {
  try {
    const { vendorProfileId, statusFilter = "ALL", limit = 50 } = options;

    let query = getDb()
      .from("ppe_submissions")
      .select(
        `
        id,
        site_name,
        status,
        metadata,
        created_at,
        submitted_at,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_reviews ( verdict, reviewed_at ),
        ppe_images ( id, file_id, side, created_at, files ( id, file_name, provider_file_id ) )
        ),
        submission_reviews ( verdict, reviewed_at )
      `,
      )
      .eq("vendor_profile_id", vendorProfileId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusFilter === "DRAFT") {
      query = query.eq("status", "DRAFT");
    } else if (statusFilter === "PENDING") {
      query = query.in("status", ["SUBMITTED", "UNDER_REVIEW"]);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.warn(
        "[VendorSubmissions] Error in listVendorSubmissions:",
        error?.message,
      );
      return [];
    }

    const results: VendorSubmissionSummaryItem[] = [];

    for (const row of data as any[]) {
      const subReview = [...(row.submission_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at || 0).getTime() - new Date(a.reviewed_at || 0).getTime())[0];
      const workerReviews = (row.ppe_worker_instances || []).map((worker: any) => latestCurrentReview(worker, (row.metadata?.workerReviews || []).find((item: any) => Number(item.sequenceNo) === Number(worker.sequence_no))));
      const allWorkersCurrent = workerReviews.length > 0 && workerReviews.every(Boolean);
      const hasWorkerReviews = workerReviews.some(Boolean);

      let verdict: SafetyVerdict | null = null;
      let hasUnsafeWorkers = false;

      if (allWorkersCurrent) {
        hasUnsafeWorkers = workerReviews.some((review: any) => review.verdict === "UNSAFE");
        verdict = hasUnsafeWorkers ? "UNSAFE" : "SAFE";
      } else if (subReview?.verdict) {
        const latestPhotoAt = Math.max(0, ...(row.ppe_worker_instances || []).flatMap((worker: any) => (worker.ppe_images || []).map((image: any) => new Date(image.created_at || 0).getTime())));
        if (new Date(subReview.reviewed_at || 0).getTime() >= latestPhotoAt) {
          verdict = subReview.verdict;
          if (verdict === "UNSAFE") hasUnsafeWorkers = true;
        }
      } else if (hasWorkerReviews) {
        const anyUnsafe = workerReviews.some((review: any) => review?.verdict === "UNSAFE");
        if (anyUnsafe) {
          verdict = "UNSAFE";
          hasUnsafeWorkers = true;
        } else {
          const allReviewed = workerReviews.every(Boolean);
          if (allReviewed) verdict = "SAFE";
        }
      }

      // Filter by SAFE / UNSAFE post-aggregation
      if (statusFilter === "SAFE" && verdict !== "SAFE") continue;
      if (statusFilter === "UNSAFE" && verdict !== "UNSAFE") continue;
      if (
        statusFilter === "PENDING" &&
        (verdict !== null || row.status === "DRAFT")
      )
        continue;

      const firstWorker = row.ppe_worker_instances?.[0];
      const frontImg = firstWorker?.ppe_images?.find(
        (img: any) => img.side === "FRONT",
      );
      const providerFileId = frontImg?.files?.provider_file_id;
      const thumbnailUrl = providerFileId
        ? resolvePreviewUrl(providerFileId, frontImg?.files?.storage_provider)
        : undefined;

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
    console.warn(
      "[VendorSubmissions] Exception in listVendorSubmissions:",
      err,
    );
    return [];
  }
}

/**
 * Fetches comprehensive details for a specific submission including worker photos,
 * Others evidence, and full reviewer feedback.
 */
export async function getVendorSubmissionDetails(
  submissionId: number,
): Promise<VendorSubmissionDetail | null> {
  try {
    const { data: sub, error } = await getDb()
      .from("ppe_submissions")
      .select(
        `
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
            created_at,
            files ( id, file_name, provider_file_id )
          )
        ),
        other_images (
          id,
          file_id,
          sequence_no,
          files ( id, file_name, provider_file_id )
        ),
        submission_reviews (
          verdict,
          reason,
          reviewed_at
        )
      `,
      )
      .eq("id", submissionId)
      .single();

    if (error || !sub) {
      console.warn(
        `[VendorSubmissions] Error fetching submission ${submissionId}:`,
        error?.message,
      );
      return null;
    }

    const subData = sub as any;
    const subReview = [...(subData.submission_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime())[0];
    const metadataWorkers = Array.isArray(subData.metadata?.workerReviews) ? subData.metadata.workerReviews : [];

    const workers: VendorSubmissionWorkerDetail[] = (
      subData.ppe_worker_instances || []
    )
      .sort((a: any, b: any) => a.sequence_no - b.sequence_no)
      .map((w: any) => {
        const front = w.ppe_images?.find((img: any) => img.side === "FRONT");
        const back = w.ppe_images?.find((img: any) => img.side === "BACK");
        const review = [...(w.ppe_reviews || [])].sort((a: any, b: any) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime())[0];
        const newestPhotoAt = Math.max(0, ...(w.ppe_images || []).map((img: any) => new Date(img.created_at || 0).getTime()));
        const metadataReview = metadataWorkers.find((item: any) => Number(item.sequenceNo) === Number(w.sequence_no));
        const relationCurrent = Boolean(review && new Date(review.reviewed_at).getTime() >= newestPhotoAt);
        const metadataCurrent = Boolean(metadataReview && Number(metadataReview.reviewedAt || 0) >= newestPhotoAt);
        const currentReview = relationCurrent ? review : metadataCurrent ? metadataReview : null;

        const reasons = (relationCurrent ? (review?.ppe_review_reasons || []) : metadataCurrent ? (metadataReview?.unsafeReasons || []).map((code: string) => ({ unsafe_reasons: { code, label: code }, note: metadataReview?.otherReasonText })) : []).map((rr: any) => ({
          code: rr.unsafe_reasons?.code || "OTHER",
          label: rr.unsafe_reasons?.label || "Safety issue",
          note: rr.note,
        }));

        const frontProviderId = front?.files?.provider_file_id;
        const backProviderId = back?.files?.provider_file_id;

        return {
          id: w.id,
          sequenceNo: w.sequence_no,
          frontPhoto:
            front && frontProviderId
              ? {
                  fileId: front.file_id,
                  providerFileId: frontProviderId,
                  previewUrl: resolvePreviewUrl(frontProviderId, front?.files?.storage_provider),
                }
              : null,
          backPhoto:
            back && backProviderId
              ? {
                  fileId: back.file_id,
                  providerFileId: backProviderId,
                  previewUrl: resolvePreviewUrl(backProviderId, back?.files?.storage_provider),
                }
              : null,
          verdict: (currentReview?.verdict || (currentReview?.status === "safe" ? "SAFE" : currentReview?.status === "unsafe" ? "UNSAFE" : null)) ?? null,
          reasons,
        };
      });

    const anyUnsafe = workers.some((worker) => worker.verdict === "UNSAFE");
    const allCurrent = workers.length > 0 && workers.every((worker) => worker.verdict === "SAFE" || worker.verdict === "UNSAFE");
    const overallVerdict: SafetyVerdict | null = allCurrent ? (anyUnsafe ? "UNSAFE" : "SAFE") : null;
    const reviewerFeedback = allCurrent ? (subReview?.reason ?? (workers.flatMap((worker) => worker.reasons.map((reason) => reason.note).filter(Boolean)).join("; ") || null)) : null;
    const reviewedAt = allCurrent ? (subReview?.reviewed_at ?? null) : null;

    const otherPhotos = (subData.other_images || []).map((o: any) => {
      const providerId = o.files?.provider_file_id;
      return {
        id: o.id,
        fileId: o.file_id,
        providerFileId: providerId,
        previewUrl: resolvePreviewUrl(providerId, o.files?.storage_provider),
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
    console.warn(
      "[VendorSubmissions] Exception in getVendorSubmissionDetails:",
      err,
    );
    return null;
  }
}

/**
 * Creates or updates a DRAFT submission so the vendor can save progress without submitting.
 */
export async function saveDraftSubmission(
  payload: Partial<CreateSubmissionPayload> & { siteName: string },
  existingSubmissionId?: number,
): Promise<{ success: boolean; submissionId?: number; error?: string }> {
  try {
    const vendorProfileId = payload.vendorProfileId;
    const submittedBy = payload.submittedBy;
    if (!vendorProfileId || !submittedBy) {
      throw new Error('Vendor profile and submitting user are required to save a draft.');
    }

    if (existingSubmissionId) {
      // 1. Verify it is still a draft
      const { data: current } = await getDb()
        .from("ppe_submissions")
        .select("status")
        .eq("id", existingSubmissionId)
        .single();

      if (current && current.status !== "DRAFT") {
        throw new StorageError(
          StorageErrorCode.PERMISSION_DENIED,
          "Cannot edit submission that has already been submitted or completed.",
        );
      }

      // Update draft details
      await getDb()
        .from("ppe_submissions")
        .update({
          site_name: payload.siteName,
          metadata: payload.metadata ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSubmissionId);

      return { success: true, submissionId: existingSubmissionId };
    }

    // 2. Create new draft submission
    const { data: newSub, error } = await getDb()
      .from("ppe_submissions")
      .insert({
        vendor_profile_id: vendorProfileId,
        submitted_by: submittedBy,
        site_name: payload.siteName,
        metadata: payload.metadata ?? {},
        status: "DRAFT",
      })
      .select("id")
      .single();

    if (error || !newSub) {
      throw new Error(error?.message ?? "Failed to create draft");
    }

    return { success: true, submissionId: newSub.id };
  } catch (err: any) {
    console.warn("[VendorSubmissions] Error saving draft:", err);
    return { success: false, error: err?.message ?? "Failed to save draft" };
  }
}

/**
 * Deletes a draft submission.
 * Strictly prevents deletion of submitted or reviewed evidence.
 */
export async function deleteDraftSubmission(
  submissionId: number,
  userId?: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: sub, error } = await getDb()
      .from("ppe_submissions")
      .select("id, status, submitted_by")
      .eq("id", submissionId)
      .single();

    if (error || !sub) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        "Submission not found",
      );
    }

    if (sub.status !== "DRAFT") {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        "Only draft submissions can be deleted. Submitted or reviewed records cannot be deleted.",
      );
    }

    // Delete child records first
    const { data: workerInstances } = await getDb()
      .from("ppe_worker_instances")
      .select("id")
      .eq("submission_id", submissionId);

    if (workerInstances && workerInstances.length > 0) {
      const workerIds = workerInstances.map((w: any) => w.id);
      await getDb()
        .from("ppe_images")
        .delete()
        .in("worker_instance_id", workerIds);
      await getDb()
        .from("ppe_worker_instances")
        .delete()
        .eq("submission_id", submissionId);
    }

    await getDb()
      .from("other_images")
      .delete()
      .eq("submission_id", submissionId);
    const { error: delError } = await getDb()
      .from("ppe_submissions")
      .delete()
      .eq("id", submissionId);

    if (delError) {
      throw new Error(delError.message);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(
      `[VendorSubmissions] Error deleting draft ${submissionId}:`,
      err,
    );
    return { success: false, error: err?.message ?? "Failed to delete draft" };
  }
}

/**
 * Finalizes and submits a DRAFT submission for review.
 * Validates that every worker has Front & Back paired photos.
 */
export async function submitDraftForReview(
  submissionId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: sub, error } = await getDb()
      .from("ppe_submissions")
      .select(
        `
        id,
        status,
        ppe_worker_instances (
          id,
          sequence_no,
          ppe_images ( side )
        )
      `,
      )
      .eq("id", submissionId)
      .single();

    if (error || !sub) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        "Submission not found",
      );
    }

    const subData = sub as any;
    if (subData.status !== "DRAFT") {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        `Submission ${submissionId} is already in ${subData.status} status.`,
      );
    }

    // Validate worker pairs
    const workers = subData.ppe_worker_instances || [];
    if (workers.length === 0) {
      throw new StorageError(
        StorageErrorCode.INVALID_INPUT,
        "At least one worker must be included.",
      );
    }

    for (const w of workers) {
      const sides = (w.ppe_images || []).map((img: any) => img.side);
      if (!sides.includes("FRONT") || !sides.includes("BACK")) {
        throw new StorageError(
          StorageErrorCode.INVALID_INPUT,
          `Worker #${w.sequence_no} is missing required ${!sides.includes("FRONT") ? "FRONT" : "BACK"} photo.`,
        );
      }
    }

    // Mark submitted
    const { error: updateError } = await getDb()
      .from("ppe_submissions")
      .update({
        status: "SUBMITTED",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(
      `[VendorSubmissions] Error submitting draft ${submissionId}:`,
      err,
    );
    return { success: false, error: err?.message ?? "Failed to submit check" };
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
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Upload & replace active image reference
    if (replacePPEImageOverride) {
      const replaced = await replacePPEImageOverride({
        workerInstanceId,
        side,
        newLocalUri,
      });

      if (!replaced) {
        throw new Error("Failed to replace worker PPE image.");
      }
    } else {
      const db = getDb();
      const { data: inst } = await db
        .from("ppe_worker_instances")
        .select("sequence_no")
        .eq("id", workerInstanceId)
        .maybeSingle();

      const sequenceNo = inst?.sequence_no ?? 1;

      const { submissionCoordinator } = require("@/services/submission-coordination/submission-coordinator");
      const coordRes = await submissionCoordinator.replaceWorkerEvidence({
        submissionId,
        workerInstanceId,
        workerSequenceNo: sequenceNo,
        side,
        localUri: newLocalUri,
        cleanOldImage: false, // preserve audit trail
      });

      if (
        coordRes.status !== "COMPLETE_SUCCESS" &&
        coordRes.status !== "REPLACEMENT_SUCCESS_CLEANUP_DEFERRED"
      ) {
        throw coordRes.error || new Error("Failed to replace worker PPE image.");
      }
    }

    // 2. Transition submission status back to SUBMITTED for re-review
    const { error: subError } = await getDb()
      .from("ppe_submissions")
      .update({
        status: "SUBMITTED",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (subError) {
      throw new Error(`The replacement photo was saved, but the submission could not be returned for review: ${subError.message}`);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(
      `[VendorSubmissions] Error resubmitting worker ${workerInstanceId}:`,
      err,
    );
    return {
      success: false,
      error: err?.message ?? "Failed to resubmit worker photo",
    };
  }
}
