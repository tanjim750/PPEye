import { OtherCapturePhoto, PPECaptureSide, PPEWorkerCapture } from '@/features/capture/types';

type PendingSubmissionReviewTarget = {
  side?: PPECaptureSide;
  workerNumber: number;
};

let pendingCaptureReview: PPEWorkerCapture[] | null = null;
let pendingOtherCaptureReview: OtherCapturePhoto[] | null = null;
let pendingCaptureTarget: PendingSubmissionReviewTarget | null = null;
let pendingReviewSite: string | null = null;

export function setPendingSubmissionReviewCaptures(captures: PPEWorkerCapture[]) {
  pendingCaptureReview = captures.map((capture) => ({ ...capture }));
}

export function setPendingSubmissionReviewOtherPhotos(photos: OtherCapturePhoto[]) {
  pendingOtherCaptureReview = photos.map((photo) => ({ ...photo }));
}

export function setPendingSubmissionReviewTarget(target: PendingSubmissionReviewTarget | null) {
  pendingCaptureTarget = target ? { ...target } : null;
}

export function getPendingSubmissionReviewCaptures() {
  return pendingCaptureReview?.map((capture) => ({ ...capture })) ?? null;
}

export function getPendingSubmissionReviewOtherPhotos() {
  return pendingOtherCaptureReview?.map((photo) => ({ ...photo })) ?? null;
}

export function getPendingSubmissionReviewTarget() {
  return pendingCaptureTarget ? { ...pendingCaptureTarget } : null;
}

let lastKnownSite = 'Gazipur-ER-102 - Tower Sector 3';

export function setPendingSubmissionReviewSite(site: string) {
  const nextSite = site.trim();

  pendingReviewSite = nextSite || null;
  if (nextSite) {
    lastKnownSite = nextSite;
  }
}

export function getPendingSubmissionReviewSite() {
  return pendingReviewSite || lastKnownSite;
}

export function clearPendingSubmissionReviewCaptures() {
  pendingCaptureReview = null;
  pendingOtherCaptureReview = null;
  pendingCaptureTarget = null;
  pendingReviewSite = null;
}
