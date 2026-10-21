type SignatureReview = {
  id: string;
  status: string;
  isDraft?: boolean;
  draftReviewerId?: number;
  timestamp: number;
  workers: number;
  photos: number;
  location?: string;
  vendor?: string;
  teamLead?: string;
  unsafeReasons?: string[];
  otherReasonText?: string;
  workerReviews?: Array<{
    sequenceNo: number;
    status: string;
    unsafeReasons?: string[];
    otherReasonText?: string;
    reviewedAt?: number;
    frontDriveId?: string | null;
    backDriveId?: string | null;
    frontUri?: string | null;
    backUri?: string | null;
  }>;
};

export function computeReviewsSignature(items: SignatureReview[]): string {
  return items
    .map((review) => `${review.id}:${review.status}:${review.isDraft ? 1 : 0}:${review.draftReviewerId || ""}:${review.timestamp}:${review.workers}:${review.photos}:${review.location || ""}:${review.vendor || ""}:${review.teamLead || ""}:${(review.unsafeReasons || []).join(",")}:${review.otherReasonText || ""}:${(review.workerReviews || []).map((worker) => `${worker.sequenceNo}-${worker.status}-${(worker.unsafeReasons || []).join(",")}-${worker.otherReasonText || ""}-${worker.reviewedAt || ""}-${worker.frontDriveId || worker.frontUri || ""}-${worker.backDriveId || worker.backUri || ""}`).join(";")}`)
    .join("|");
}
