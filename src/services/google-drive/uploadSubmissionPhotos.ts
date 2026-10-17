import { uploadFileToDrive } from './upload';
import type { CreateWorkerPhotoPayload } from '@/services/supabase/ppeyeDb.service';

export interface LocalWorkerToUpload {
  sequenceNo: number;
  frontUri?: string | null;
  backUri?: string | null;
}

export interface UploadSubmissionPhotosParams {
  siteName: string;
  workers: LocalWorkerToUpload[];
  otherPhotos?: string[];
  folderId?: string;
  submissionId?: number;
}

export interface UploadedSubmissionPhotosResult {
  workers: CreateWorkerPhotoPayload[];
  otherPhotos: string[];
}

/**
 * Uploads all worker front/back photos and additional site photos to Google Drive.
 * Returns the mapped payloads containing Google Drive File IDs for Supabase insertion.
 */
export async function uploadSubmissionPhotosToDrive(
  params: UploadSubmissionPhotosParams
): Promise<UploadedSubmissionPhotosResult> {
  const { siteName, workers, otherPhotos = [], folderId, submissionId } = params;
  const sanitizedSite = siteName.replace(/[^a-zA-Z0-9_-]/g, '_');

  // 1. Upload worker photos (front & back)
  const uploadedWorkers: CreateWorkerPhotoPayload[] = await Promise.all(
    workers.map(async (worker) => {
      let frontDriveFileId: string | null = null;
      let backDriveFileId: string | null = null;

      const frontFileName = submissionId
        ? `submission_${submissionId}_worker_${worker.sequenceNo}_front.jpg`
        : `${sanitizedSite}_w${worker.sequenceNo}_front.jpg`;

      const backFileName = submissionId
        ? `submission_${submissionId}_worker_${worker.sequenceNo}_back.jpg`
        : `${sanitizedSite}_w${worker.sequenceNo}_back.jpg`;

      if (worker.frontUri) {
        try {
          const frontRes = await uploadFileToDrive({
            localUri: worker.frontUri,
            fileName: frontFileName,
            folderId,
          });
          frontDriveFileId = frontRes.fileId;
        } catch (err) {
          console.warn(`[Drive Upload] Error uploading worker ${worker.sequenceNo} front photo:`, err);
        }
      }

      if (worker.backUri) {
        try {
          const backRes = await uploadFileToDrive({
            localUri: worker.backUri,
            fileName: backFileName,
            folderId,
          });
          backDriveFileId = backRes.fileId;
        } catch (err) {
          console.warn(`[Drive Upload] Error uploading worker ${worker.sequenceNo} back photo:`, err);
        }
      }

      return {
        sequenceNo: worker.sequenceNo,
        frontDriveFileId,
        backDriveFileId,
        frontUri: worker.frontUri,
        backUri: worker.backUri,
      };
    })
  );

  // 2. Upload additional/other photos
  const uploadedOtherPhotos: string[] = await Promise.all(
    otherPhotos.map(async (uri, index) => {
      try {
        const otherFileName = submissionId
          ? `submission_${submissionId}_other_${index + 1}.jpg`
          : `${sanitizedSite}_other_${index + 1}.jpg`;

        const otherRes = await uploadFileToDrive({
          localUri: uri,
          fileName: otherFileName,
          folderId,
        });
        return otherRes.fileId;
      } catch (err) {
        console.warn(`[Drive Upload] Error uploading other photo ${index + 1}:`, err);
        return uri;
      }
    })
  );

  return {
    workers: uploadedWorkers,
    otherPhotos: uploadedOtherPhotos,
  };
}
