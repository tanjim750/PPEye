import type { ImageSide, StorageProvider, SubmissionStatus } from '../../types/database.types';
import type { StoredPPEImage, WorkerImagePairResult } from './ppe-images.types';
import type { StoredOtherImage } from './other-images.types';

export type ValidationIssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type ValidationIssueCode =
  | 'WORKER_MISSING_FRONT'
  | 'WORKER_MISSING_BACK'
  | 'WORKER_EMPTY_PAIR'
  | 'WORKER_MULTIPLE_FRONT'
  | 'WORKER_MULTIPLE_BACK'
  | 'NO_WORKERS_PROVIDED'
  | 'INVALID_FILE_URI'
  | 'SUBMISSION_NOT_FOUND'
  | 'UPLOAD_PARTIAL_FAILURE'
  | 'STORAGE_UNAVAILABLE'
  | 'OPTIONAL_OTHERS_EMPTY';

export interface SubmissionImageValidationIssue {
  severity: ValidationIssueSeverity;
  code: ValidationIssueCode;
  message: string;
  workerInstanceId?: number;
  sequenceNo?: number;
  side?: ImageSide;
  index?: number;
}

export interface ValidateSubmissionImagesResult {
  isValid: boolean;
  hasWarnings: boolean;
  errors: SubmissionImageValidationIssue[];
  warnings: SubmissionImageValidationIssue[];
  issues: SubmissionImageValidationIssue[];
  summary: {
    totalWorkers: number;
    validWorkers: number;
    incompleteWorkers: number;
    otherPhotosCount: number;
  };
}

export interface WorkerPhotoInput {
  workerInstanceId?: number;
  sequenceNo: number;
  frontLocalUri?: string | null;
  backLocalUri?: string | null;
}

export interface OtherPhotoInput {
  localUri: string;
  sequenceNo?: number;
}

export interface ValidateSubmissionImagesInput {
  submissionId?: number;
  workers?: WorkerPhotoInput[];
  otherImages?: (string | OtherPhotoInput)[];
}

export interface UploadSubmissionImagesInput {
  submissionId: number;
  workers: WorkerPhotoInput[];
  otherImages?: (string | OtherPhotoInput)[];
  userId?: number;
  siteName?: string;
  folderId?: string;
  markCompleteOnSuccess?: boolean;
  targetSubmissionStatus?: SubmissionStatus;
  onProgress?: (progress: SubmissionUploadProgress) => void;
}

export interface WorkerImageUploadSummary {
  workerInstanceId: number;
  sequenceNo: number;
  front: StoredPPEImage | null;
  back: StoredPPEImage | null;
  isComplete: boolean;
  error?: string;
}

export interface UploadSubmissionImagesResult {
  submissionId: number;
  isComplete: boolean;
  submissionStatusUpdated: boolean;
  newStatus?: SubmissionStatus;
  workers: WorkerImageUploadSummary[];
  otherImages: StoredOtherImage[];
  errors: SubmissionImageValidationIssue[];
  totalPhotosUploaded: number;
  failedPhotosCount: number;
}

export interface SubmissionWorkerImages {
  workerInstanceId: number;
  sequenceNo: number;
  front: StoredPPEImage | null;
  back: StoredPPEImage | null;
  isComplete: boolean;
}

export interface GetSubmissionImagesResult {
  submissionId: number;
  siteName?: string;
  status?: SubmissionStatus;
  workers: SubmissionWorkerImages[];
  otherImages: StoredOtherImage[];
  summary: {
    totalWorkers: number;
    completeWorkers: number;
    incompleteWorkers: number;
    totalPPEPhotos: number;
    totalOtherPhotos: number;
    isFullyPersisted: boolean;
  };
}

export interface RetryFailedUploadsInput {
  submissionId: number;
  workers?: WorkerPhotoInput[];
  otherImages?: (string | OtherPhotoInput)[];
  userId?: number;
  siteName?: string;
  folderId?: string;
  markCompleteOnSuccess?: boolean;
  targetSubmissionStatus?: SubmissionStatus;
  onProgress?: (progress: SubmissionUploadProgress) => void;
}

export type SubmissionUploadStage =
  | 'idle'
  | 'validating'
  | 'uploading_workers'
  | 'uploading_others'
  | 'persisting_relations'
  | 'completed'
  | 'failed';

export interface SubmissionWorkerProgress {
  sequenceNo: number;
  frontStatus: 'pending' | 'uploading' | 'success' | 'failed' | 'skipped';
  backStatus: 'pending' | 'uploading' | 'success' | 'failed' | 'skipped';
}

export interface SubmissionUploadProgress {
  submissionId: number;
  state: 'IDLE' | 'QUEUED' | 'UPLOADING' | 'PERSISTING' | 'COMPLETED' | 'FAILED' | 'PARTIAL_SUCCESS';
  percent: number;
  stage: SubmissionUploadStage;
  completedPhotos: number;
  totalPhotos: number;
  workers: SubmissionWorkerProgress[];
}
