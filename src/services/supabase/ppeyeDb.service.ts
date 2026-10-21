import { supabase } from "@/services/supabase/client";
import type {
  Database,
  SafetyVerdict,
  StorageProvider,
  SubmissionStatus,
} from "@/types/database.types";

export type PPESubmissionRow =
  Database["public"]["Tables"]["ppe_submissions"]["Row"];
export type PPEWorkerInstanceRow =
  Database["public"]["Tables"]["ppe_worker_instances"]["Row"];
export type PPEImageRow = Database["public"]["Tables"]["ppe_images"]["Row"];
export type OtherImageRow = Database["public"]["Tables"]["other_images"]["Row"];
export type UnsafeReasonRow =
  Database["public"]["Tables"]["unsafe_reasons"]["Row"];
export type VendorProfileRow =
  Database["public"]["Tables"]["vendor_profiles"]["Row"];
export type UserRow = Database["public"]["Tables"]["users"]["Row"];

export interface CreateWorkerPhotoPayload {
  sequenceNo: number;
  /** Google Drive file ID for the front image */
  frontDriveFileId?: string | null;
  /** Google Drive file ID for the back image */
  backDriveFileId?: string | null;
  /** Local image URI (used if Drive ID not yet generated) */
  frontUri?: string | null;
  /** Local image URI (used if Drive ID not yet generated) */
  backUri?: string | null;
}

export type OtherPhotoPayload =
  | string
  | { driveFileId: string; fileName?: string };

export interface CreateSubmissionPayload {
  siteName: string;
  vendorProfileId?: number;
  submittedBy?: number;
  metadata?: Record<string, any>;
  workers: CreateWorkerPhotoPayload[];
  otherPhotos?: OtherPhotoPayload[];
}

export interface SubmitWorkerReviewPayload {
  workerInstanceId: number;
  reviewerId: number;
  verdict: SafetyVerdict;
  note?: string | null;
  unsafeReasonIds?: number[];
}

/**
 * Fetch all active unsafe violation reasons from database catalog.
 */
export async function getUnsafeReasons(): Promise<UnsafeReasonRow[]> {
  try {
    const { data, error } = await supabase
      .from("unsafe_reasons")
      .select("*")
      .eq("is_active", true)
      .order("id", { ascending: true });

    if (error) {
      console.warn("[PPEye DB] Error fetching unsafe reasons:", error.message);
      return [];
    }

    return data ?? [];
  } catch (err) {
    console.warn("[PPEye DB] Exception fetching unsafe reasons:", err);
    return [];
  }
}

/**
 * Fetch all active vendor profiles.
 */
export async function getVendorProfiles(): Promise<VendorProfileRow[]> {
  try {
    const { data, error } = await supabase
      .from("vendor_profiles")
      .select("*")
      .order("vendor_name", { ascending: true });

    if (error) {
      console.warn("[PPEye DB] Error fetching vendor profiles:", error.message);
      return [];
    }

    return data ?? [];
  } catch (err) {
    console.warn("[PPEye DB] Exception fetching vendor profiles:", err);
    return [];
  }
}

/**
 * Helper to register a file record in the files table.
 * Supabase does NOT store the binary image. Only the Google Drive file ID is saved!
 */
async function registerFile(
  providerFileId: string,
  fileName: string,
  createdBy: number,
  storageProvider: StorageProvider = "GOOGLE_DRIVE",
): Promise<number | null> {
  // Reject local device URIs - only real Google Drive IDs are allowed!
  if (
    !providerFileId ||
    providerFileId.startsWith("file://") ||
    providerFileId.startsWith("ph://")
  ) {
    console.warn(
      "[PPEye DB] Refused to register local URI as Drive ID in database:",
      providerFileId,
    );
    return null;
  }

  try {
    const payload: any = {
      storage_provider: storageProvider,
      file_name: fileName,
      provider_file_id: providerFileId,
      mime_type: "image/jpeg",
      created_by: createdBy,
    };

    const { data, error } = await supabase
      .from("files")
      .insert(payload)
      .select("id")
      .single();

    if (error || !data) {
      console.warn("[PPEye DB] Error registering file:", error?.message);
      return null;
    }

    return data.id;
  } catch (err) {
    console.warn("[PPEye DB] Exception registering file:", err);
    return null;
  }
}

export interface CreateSubmissionHeaderPayload {
  vendorProfileId?: number;
  submittedBy?: number;
  siteName: string;
  metadata?: any;
  workerSequenceNumbers?: number[];
}

/**
 * Creates the parent PPE submission row and returns its new submission ID.
 * Pre-creates all worker instances immediately so realtime UI shows all workers in 0 milliseconds.
 */
export async function createPPESubmissionHeader(
  payload: CreateSubmissionHeaderPayload,
): Promise<{
  success: boolean;
  submissionId?: number;
  submittedBy?: number;
  error?: string;
}> {
  try {
    let vendorProfileId = payload.vendorProfileId;
    let submittedBy = payload.submittedBy;

    // Resilient fallback: If vendorProfileId or submittedBy is missing (e.g. testing in dev mode or demo user),
    // automatically resolve valid IDs from Supabase so data is always persisted to the database.
    if (!vendorProfileId || !submittedBy) {
      if (!vendorProfileId) {
        const { data: firstVendor } = await supabase
          .from("vendor_profiles")
          .select("id")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstVendor?.id) vendorProfileId = firstVendor.id;
      }
      if (!submittedBy) {
        const { data: firstUser } = await supabase
          .from("users")
          .select("id")
          .eq("category", "EXTERNAL")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstUser?.id) {
          submittedBy = firstUser.id;
        } else {
          const { data: anyUser } = await supabase
            .from("users")
            .select("id")
            .order("id", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (anyUser?.id) submittedBy = anyUser.id;
        }
      }
    }

    if (!vendorProfileId || !submittedBy) {
      console.warn(
        "[PPEye DB] Skipping submission: No registered user or vendor profile found in database.",
      );
      return {
        success: false,
        error: "No registered user or vendor profile found in database",
      };
    }

    const { data: submission, error: submissionError } = await supabase
      .from("ppe_submissions")
      .insert({
        vendor_profile_id: vendorProfileId,
        submitted_by: submittedBy,
        site_name: payload.siteName,
        metadata: payload.metadata ?? {},
        status: "SUBMITTED",
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (submissionError || !submission) {
      console.warn(
        "[PPEye DB] Error creating ppe_submission:",
        submissionError?.message,
      );
      return {
        success: false,
        error: submissionError?.message ?? "Failed to create submission",
      };
    }

    // Pre-create worker instances so all workers are immediately present in DB (< 150ms)
    if (
      payload.workerSequenceNumbers &&
      payload.workerSequenceNumbers.length > 0
    ) {
      const instancesToInsert = payload.workerSequenceNumbers.map((seq) => ({
        submission_id: submission.id,
        sequence_no: seq,
      }));
      const { error: instErr } = await supabase
        .from("ppe_worker_instances")
        .insert(instancesToInsert);
      if (instErr) {
        console.warn(
          "[PPEye DB] Warning pre-creating worker instances:",
          instErr.message,
        );
      }
    }

    return { success: true, submissionId: submission.id, submittedBy };
  } catch (err: any) {
    console.warn("[PPEye DB] Exception creating ppe_submission header:", err);
    return { success: false, error: err?.message };
  }
}

/**
 * Attaches worker photos and other photos with Google Drive file IDs to a specific submission.
 */
export async function attachPhotosToPPESubmission(params: {
  submissionId: number;
  submittedBy: number;
  workers: CreateWorkerPhotoPayload[];
  otherPhotos?: (string | { driveFileId: string; fileName?: string })[];
}): Promise<{ success: boolean; error?: string }> {
  const { submissionId, submittedBy, workers, otherPhotos = [] } = params;
  try {
    for (const worker of workers) {
      let workerInstanceId: number | null = null;

      // Check if instance was already pre-created
      const { data: existingInst } = await supabase
        .from("ppe_worker_instances")
        .select("id")
        .eq("submission_id", submissionId)
        .eq("sequence_no", worker.sequenceNo)
        .maybeSingle();

      if (existingInst?.id) {
        workerInstanceId = existingInst.id;
      } else {
        const { data: newInst, error: workerError } = await supabase
          .from("ppe_worker_instances")
          .insert({
            submission_id: submissionId,
            sequence_no: worker.sequenceNo,
          })
          .select("id")
          .single();

        if (workerError || !newInst) {
          console.warn(
            "[PPEye DB] Error inserting ppe_worker_instance:",
            workerError?.message,
          );
          continue;
        }
        workerInstanceId = newInst.id;
      }

      if (!workerInstanceId) {
        continue;
      }

      // Front image - store Google Drive file ID
      const frontDriveId = worker.frontDriveFileId;
      if (frontDriveId && !frontDriveId.startsWith("file://")) {
        const fileId = await registerFile(
          frontDriveId,
          `submission_${submissionId}_worker_${worker.sequenceNo}_front.jpg`,
          submittedBy,
          "GOOGLE_DRIVE",
        );
        if (fileId) {
          await supabase.from("ppe_images").insert({
            worker_instance_id: workerInstanceId,
            file_id: fileId,
            side: "FRONT",
          });
        }
      }

      // Back image - store Google Drive file ID
      const backDriveId = worker.backDriveFileId;
      if (backDriveId && !backDriveId.startsWith("file://")) {
        const fileId = await registerFile(
          backDriveId,
          `submission_${submissionId}_worker_${worker.sequenceNo}_back.jpg`,
          submittedBy,
          "GOOGLE_DRIVE",
        );
        if (fileId) {
          await supabase.from("ppe_images").insert({
            worker_instance_id: workerInstanceId,
            file_id: fileId,
            side: "BACK",
          });
        }
      }
    }

    // Insert other photos if provided (storing Google Drive file IDs)
    if (otherPhotos && otherPhotos.length > 0) {
      for (let idx = 0; idx < otherPhotos.length; idx++) {
        const item = otherPhotos[idx];
        const driveId = typeof item === "string" ? item : item.driveFileId;
        const fileName =
          typeof item === "object" && item.fileName
            ? item.fileName
            : `submission_${submissionId}_other_${idx + 1}.jpg`;

        const fileId = await registerFile(
          driveId,
          fileName,
          submittedBy,
          "GOOGLE_DRIVE",
        );
        if (fileId) {
          await supabase.from("other_images").insert({
            submission_id: submissionId,
            file_id: fileId,
            sequence_no: idx + 1,
          });
        }
      }
    }

    return { success: true };
  } catch (err: any) {
    console.warn("[PPEye DB] Exception attaching photos to submission:", err);
    return { success: false, error: err?.message };
  }
}

/**
 * Creates a complete PPE submission including worker instances and photos.
 * Photo records store the Google Drive File ID referencing the 'files' table.
 */
export async function createPPESubmission(
  payload: CreateSubmissionPayload,
): Promise<{ success: boolean; submissionId?: number; error?: string }> {
  try {
    const headerRes = await createPPESubmissionHeader({
      vendorProfileId: payload.vendorProfileId,
      submittedBy: payload.submittedBy,
      siteName: payload.siteName,
      metadata: payload.metadata,
    });

    if (!headerRes.success || !headerRes.submissionId) {
      return { success: false, error: headerRes.error };
    }

    await attachPhotosToPPESubmission({
      submissionId: headerRes.submissionId,
      submittedBy: headerRes.submittedBy!,
      workers: payload.workers,
      otherPhotos: payload.otherPhotos,
    });

    return { success: true, submissionId: headerRes.submissionId };
  } catch (err: any) {
    console.warn("[PPEye DB] Exception creating PPE submission:", err);
    return { success: false, error: err?.message };
  }
}

/**
 * Fetch all PPE submissions with joined vendor profile and worker instances.
 */
export async function listPPESubmissions(filters?: {
  vendorProfileId?: number;
  status?: SubmissionStatus;
}) {
  try {
    let query = supabase
      .from("ppe_submissions")
      .select(
        `
        *,
        vendor_profiles ( id, vendor_name, project_name ),
        ppe_worker_instances (
          id,
          sequence_no,
          created_at,
          ppe_images ( id, file_id, side )
        ),
        other_images ( id, file_id, sequence_no )
      `,
      )
      .order("created_at", { ascending: false });

    if (filters?.vendorProfileId) {
      query = query.eq("vendor_profile_id", filters.vendorProfileId);
    }

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;

    if (error) {
      console.warn("[PPEye DB] Error listing ppe_submissions:", error.message);
      return [];
    }

    return data ?? [];
  } catch (err) {
    console.warn("[PPEye DB] Exception listing ppe_submissions:", err);
    return [];
  }
}

/**
 * Submit an EHS reviewer's verdict for a worker instance.
 */
export async function submitWorkerReview(
  payload: SubmitWorkerReviewPayload,
): Promise<{ success: boolean; reviewId?: number; error?: string }> {
  try {
    const reviewerId = payload.reviewerId;
    if (!Number.isFinite(reviewerId) || reviewerId <= 0) return { success: false, error: "A valid reviewer user ID is required." };
    if (payload.verdict === "UNSAFE" && !payload.unsafeReasonIds?.length) return { success: false, error: "Unsafe reviews require at least one reason." };

    // 1. Insert review row
    const { data: review, error: reviewError } = await supabase
      .from("ppe_reviews")
      .insert({
        worker_instance_id: payload.workerInstanceId,
        reviewer_id: reviewerId,
        verdict: payload.verdict,
      })
      .select()
      .single();

    if (reviewError || !review) {
      console.warn(
        "[PPEye DB] Error inserting ppe_reviews:",
        reviewError?.message,
      );
      return {
        success: false,
        error: reviewError?.message ?? "Failed to submit review",
      };
    }

    // 2. Insert unsafe reasons if verdict is UNSAFE
    if (
      payload.verdict === "UNSAFE" &&
      payload.unsafeReasonIds &&
      payload.unsafeReasonIds.length > 0
    ) {
      const reasonRows = payload.unsafeReasonIds.map((reasonId) => ({
        ppe_review_id: review.id,
        unsafe_reason_id: reasonId,
        note: payload.note ?? null,
      }));

      const { error: reasonsError } = await supabase
        .from("ppe_review_reasons")
        .insert(reasonRows);
      if (reasonsError) {
        console.warn(
          "[PPEye DB] Error inserting ppe_review_reasons:",
          reasonsError.message,
        );
        return { success: false, error: reasonsError.message };
      }
    }

    return { success: true, reviewId: review.id };
  } catch (err: any) {
    console.warn("[PPEye DB] Exception in submitWorkerReview:", err);
    return { success: false, error: err?.message ?? "Unknown database error" };
  }
}
