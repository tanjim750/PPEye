import { StorageError, StorageErrorCode } from './storage.errors';

export type UploadTaskState =
  | 'QUEUED'
  | 'UPLOADING'
  | 'PERSISTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface UploadProgress {
  state: UploadTaskState;
  percent: number;
  stage: 'queued' | 'storage_upload' | 'db_persistence' | 'completed' | 'failed' | 'cancelled';
  bytesUploaded?: number;
  totalBytes?: number;
}

export interface UploadTask<TResult = any> {
  id: string;
  key?: string;
  state: UploadTaskState;
  progress: UploadProgress;
  attempt: number;
  maxRetries: number;
  driveFileId?: string;
  fileRecordId?: number;
  error?: Error;
  result?: TResult;
  abortController?: AbortController;
  cancellationType?: 'queued' | 'transport';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface UploadTaskExecutionContext<TResult = any> {
  task: UploadTask<TResult>;
  signal: AbortSignal;
  updateProgress: (progress: Partial<UploadProgress>) => void;
  setDriveFileId: (id: string) => void;
  setFileRecordId: (id: number) => void;
}

export type UploadTaskExecutor<TResult = any> = (
  context: UploadTaskExecutionContext<TResult>
) => Promise<TResult>;

export interface EnqueueUploadOptions<TResult = any> {
  id?: string;
  key?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onProgress?: (progress: UploadProgress) => void;
  executor: UploadTaskExecutor<TResult>;
}

export interface RetryDelayOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface UploadQueueConfig {
  concurrency?: number;
  defaultMaxRetries?: number;
  defaultBaseDelayMs?: number;
  defaultMaxDelayMs?: number;
}
