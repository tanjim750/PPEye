import { StorageError, StorageErrorCode } from './storage.errors';
import type {
  EnqueueUploadOptions,
  RetryDelayOptions,
  UploadProgress,
  UploadQueueConfig,
  UploadTask,
  UploadTaskExecutionContext,
  UploadTaskState,
} from './upload-queue.types';

export * from './upload-queue.types';

let injectedDriveDeleter: ((fileId: string) => Promise<boolean>) | null = null;

export function setQueueDriveDeleterMock(deleter: ((fileId: string) => Promise<boolean>) | null): void {
  injectedDriveDeleter = deleter;
}

function getDriveDeleter() {
  if (injectedDriveDeleter) {
    return injectedDriveDeleter;
  }
  return async (fileId: string) => {
    try {
      const { deleteFile } = require('../google-drive/files');
      return await deleteFile(fileId);
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Error Classification & Delay Calculation
// ---------------------------------------------------------------------------

/**
 * Determines whether an error is transient and retryable.
 *
 * Retryable:
 * - Network timeouts, connection resets, DNS failures.
 * - HTTP 429 (Rate limiting).
 * - HTTP 500, 502, 503, 504 (Transient server outages).
 * - StorageErrorCode.NETWORK_ERROR, StorageErrorCode.PROVIDER_UNAVAILABLE.
 *
 * Non-retryable:
 * - HTTP 400 (Bad request), 401 (Auth required), 403 (Permission denied), 404 (Not found), 409 (Conflict).
 * - StorageErrorCode.INVALID_INPUT, StorageErrorCode.PERMISSION_DENIED, StorageErrorCode.AUTHENTICATION_REQUIRED.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // 1. Check StorageError codes
  if (error instanceof StorageError) {
    if (
      error.code === StorageErrorCode.NETWORK_ERROR ||
      error.code === StorageErrorCode.PROVIDER_UNAVAILABLE
    ) {
      return true;
    }
    if (
      error.code === StorageErrorCode.INVALID_INPUT ||
      error.code === StorageErrorCode.PERMISSION_DENIED ||
      error.code === StorageErrorCode.AUTHENTICATION_REQUIRED ||
      error.code === StorageErrorCode.FILE_NOT_FOUND
    ) {
      return false;
    }
    // Inspect underlying cause or details
    if (error.details) {
      return isRetryableError(error.details);
    }
  }

  // 2. Check HTTP status code
  const status =
    (error as any)?.status ??
    (error as any)?.statusCode ??
    (error as any)?.response?.status;

  if (typeof status === 'number') {
    if (status === 429) return true;
    if (status >= 500 && status <= 504) return true;
    if (status >= 400 && status < 500) return false;
  }

  // 3. Check error name and message
  const errObj = error as any;
  const msg = String(errObj?.message ?? errObj).toLowerCase();
  const name = String(errObj?.name ?? '').toLowerCase();

  if (
    name === 'aborterror' ||
    msg.includes('aborted') ||
    msg.includes('canceled') ||
    msg.includes('cancelled')
  ) {
    return false;
  }

  if (
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('connection reset') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504')
  ) {
    return true;
  }

  return false;
}

/**
 * Calculates retry delay using bounded exponential backoff with jitter.
 * Respects Retry-After header / property where available.
 */
export function calculateRetryDelay(
  attempt: number,
  error?: unknown,
  options?: RetryDelayOptions
): number {
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const useJitter = options?.jitter ?? true;

  // 1. Check for Retry-After specification in error
  const retryAfter =
    (error as any)?.retryAfter ??
    (error as any)?.response?.headers?.['retry-after'] ??
    (error as any)?.headers?.get?.('retry-after');

  if (retryAfter !== undefined && retryAfter !== null) {
    let retryAfterMs = 0;
    if (typeof retryAfter === 'number') {
      retryAfterMs = retryAfter < 1000 ? retryAfter * 1000 : retryAfter;
    } else if (typeof retryAfter === 'string') {
      const parsedNum = Number(retryAfter);
      if (!isNaN(parsedNum)) {
        retryAfterMs = parsedNum < 1000 ? parsedNum * 1000 : parsedNum;
      } else {
        const parsedDate = Date.parse(retryAfter);
        if (!isNaN(parsedDate)) {
          retryAfterMs = Math.max(0, parsedDate - Date.now());
        }
      }
    }
    if (retryAfterMs > 0) {
      return Math.min(maxDelayMs, retryAfterMs);
    }
  }

  // 2. Bounded exponential backoff: base * 2^attempt
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));

  // 3. Jitter: full randomized jitter to prevent thundering herds
  if (useJitter) {
    const jitterAmount = Math.random() * (exponentialDelay * 0.5);
    return Math.min(maxDelayMs, Math.floor(exponentialDelay + jitterAmount));
  }

  return exponentialDelay;
}

// ---------------------------------------------------------------------------
// 2. UploadQueue Class
// ---------------------------------------------------------------------------

export class UploadQueue {
  private concurrency: number;
  private defaultMaxRetries: number;
  private defaultBaseDelayMs: number;
  private defaultMaxDelayMs: number;

  private activeCount: number = 0;
  private queue: Array<UploadTask<any>> = [];
  private taskMap: Map<string, UploadTask<any>> = new Map();
  private keyMap: Map<string, UploadTask<any>> = new Map();
  private resolvers: Map<string, Array<{ resolve: (val: any) => void; reject: (err: any) => void }>> = new Map();
  private taskOptionsMap: Map<string, EnqueueUploadOptions<any>> = new Map();
  private progressListeners: Map<string, Array<(p: UploadProgress) => void>> = new Map();

  constructor(config?: UploadQueueConfig) {
    this.concurrency = config?.concurrency ?? 2;
    this.defaultMaxRetries = config?.defaultMaxRetries ?? 3;
    this.defaultBaseDelayMs = config?.defaultBaseDelayMs ?? 1000;
    this.defaultMaxDelayMs = config?.defaultMaxDelayMs ?? 30000;
  }

  private addResolver(taskId: string, resolve: (val: any) => void, reject: (err: any) => void): void {
    let list = this.resolvers.get(taskId);
    if (!list) {
      list = [];
      this.resolvers.set(taskId, list);
    }
    list.push({ resolve, reject });
  }

  private resolveTask(taskId: string, result: any): void {
    const list = this.resolvers.get(taskId) || [];
    this.resolvers.delete(taskId);
    for (const r of list) {
      r.resolve(result);
    }
  }

  private rejectTask(taskId: string, error: any): void {
    const list = this.resolvers.get(taskId) || [];
    this.resolvers.delete(taskId);
    for (const r of list) {
      r.reject(error);
    }
  }

  private addProgressListener(taskId: string, cb: (p: UploadProgress) => void): void {
    let list = this.progressListeners.get(taskId);
    if (!list) {
      list = [];
      this.progressListeners.set(taskId, list);
    }
    list.push(cb);
  }

  private notifyProgress(taskId: string, progress: UploadProgress): void {
    const list = this.progressListeners.get(taskId);
    if (list) {
      for (const cb of list) {
        try {
          cb(progress);
        } catch {}
      }
    }
  }

  public setConcurrency(concurrency: number): void {
    if (concurrency > 0) {
      this.concurrency = concurrency;
      this.processQueue();
    }
  }

  public getConcurrency(): number {
    return this.concurrency;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Enqueues an upload task with retry and deduplication protection.
   */
  public enqueue<TResult = any>(options: EnqueueUploadOptions<TResult>): Promise<TResult> {
    const key = options.key;

    // Deduplication: if an active or queued task with this key exists, return its promise
    if (key && this.keyMap.has(key)) {
      const existingTask = this.keyMap.get(key)!;
      if (
        existingTask.state === 'QUEUED' ||
        existingTask.state === 'UPLOADING' ||
        existingTask.state === 'PERSISTING'
      ) {
        if (options.onProgress) {
          this.addProgressListener(existingTask.id, options.onProgress);
          options.onProgress(existingTask.progress);
        }
        return new Promise<TResult>((resolve, reject) => {
          this.addResolver(existingTask.id, resolve, reject);
        });
      }
    }

    const taskId = options.id ?? `upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const task: UploadTask<TResult> = {
      id: taskId,
      key,
      state: 'QUEUED',
      progress: {
        state: 'QUEUED',
        percent: 0,
        stage: 'queued',
      },
      attempt: 0,
      maxRetries: options.maxRetries ?? this.defaultMaxRetries,
      createdAt: Date.now(),
      abortController: new AbortController(),
    };

    this.taskMap.set(taskId, task);
    this.taskOptionsMap.set(taskId, options);
    if (options.onProgress) {
      this.addProgressListener(taskId, options.onProgress);
    }
    if (key) {
      this.keyMap.set(key, task);
    }

    const promise = new Promise<TResult>((resolve, reject) => {
      this.addResolver(taskId, resolve, reject);
    });

    // Notify initial progress
    this.notifyProgress(taskId, task.progress);

    this.queue.push(task);
    this.processQueue();

    return promise;
  }

  /**
   * Cancels a pending upload.
   * Distinguishes queued cancellation from in-flight transport cancellation.
   */
  public cancel(uploadId: string): boolean {
    const task = this.taskMap.get(uploadId);
    if (!task) return false;

    // If already in terminal state, cancellation is a no-op
    if (
      task.state === 'COMPLETED' ||
      task.state === 'FAILED' ||
      task.state === 'CANCELLED'
    ) {
      return false;
    }

    if (task.state === 'QUEUED') {
      // 1. Queued cancellation: removed before execution
      task.state = 'CANCELLED';
      task.cancellationType = 'queued';
      task.progress = {
        state: 'CANCELLED',
        percent: 0,
        stage: 'cancelled',
      };
      this.queue = this.queue.filter((t) => t.id !== uploadId);
      this.notifyProgress(uploadId, task.progress);
      this.rejectTask(uploadId, new StorageError(StorageErrorCode.UPLOAD_FAILED, 'Upload cancelled while queued.'));
      return true;
    }

    // 2. Transport cancellation: in-flight request aborted
    task.state = 'CANCELLED';
    task.cancellationType = 'transport';
    task.progress = {
      state: 'CANCELLED',
      percent: task.progress.percent,
      stage: 'cancelled',
    };
    task.abortController?.abort();
    this.notifyProgress(uploadId, task.progress);

    // If a Drive file was created but never registered in database, clean it up
    if (task.driveFileId && !task.fileRecordId) {
      const deleter = getDriveDeleter();
      deleter(task.driveFileId).catch(() => {});
    }

    this.rejectTask(uploadId, new StorageError(StorageErrorCode.UPLOAD_FAILED, 'Upload cancelled during transport.'));
    return true;
  }

  public getStatus(uploadId: string): UploadTask | null {
    return this.taskMap.get(uploadId) ?? null;
  }

  public clearCompleted(): number {
    let clearedCount = 0;
    for (const [id, task] of Array.from(this.taskMap.entries())) {
      if (task.state === 'COMPLETED' || task.state === 'CANCELLED') {
        this.taskMap.delete(id);
        this.taskOptionsMap.delete(id);
        this.progressListeners.delete(id);
        if (task.key && this.keyMap.get(task.key) === task) {
          this.keyMap.delete(task.key);
        }
        this.resolvers.delete(id);
        clearedCount++;
      }
    }
    return clearedCount;
  }

  /**
   * Reconciles or cleans up orphaned Drive files from failed/cancelled tasks.
   */
  public async cleanupOrphaned(): Promise<number> {
    let cleaned = 0;
    const deleter = getDriveDeleter();

    for (const task of Array.from(this.taskMap.values())) {
      if (
        (task.state === 'FAILED' || task.state === 'CANCELLED') &&
        task.driveFileId &&
        !task.fileRecordId
      ) {
        try {
          await deleter(task.driveFileId);
          task.driveFileId = undefined;
          cleaned++;
        } catch {}
      }
    }

    return cleaned;
  }

  /**
   * Internal queue runner respecting concurrency limit.
   */
  private processQueue(): void {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    if (task.state === 'CANCELLED') {
      this.processQueue();
      return;
    }

    const options = this.taskOptionsMap.get(task.id);
    if (!options) {
      this.processQueue();
      return;
    }

    this.activeCount++;
    task.state = 'UPLOADING';
    task.startedAt = Date.now();
    task.progress = {
      state: 'UPLOADING',
      percent: 25,
      stage: 'storage_upload',
    };

    this.notifyProgress(task.id, task.progress);

    this.executeTaskWithRetry(task, options)
      .finally(() => {
        this.activeCount--;
        this.processQueue();
      });
  }

  /**
   * Executes a task with consistency recovery: preserves driveFileId and fileRecordId across retries.
   */
  private async executeTaskWithRetry(
    task: UploadTask<any>,
    options: EnqueueUploadOptions<any>
  ): Promise<void> {
    while (task.attempt <= task.maxRetries) {
      if (task.state === 'CANCELLED') {
        return;
      }

      try {
        const context: UploadTaskExecutionContext<any> = {
          task,
          signal: task.abortController!.signal,
          updateProgress: (p) => {
            task.progress = {
              ...task.progress,
              ...p,
            };
            if (p.state) {
              task.state = p.state;
            }
            this.notifyProgress(task.id, task.progress);
          },
          setDriveFileId: (id: string) => {
            task.driveFileId = id;
            context.updateProgress({ stage: 'storage_upload', percent: 50 });
          },
          setFileRecordId: (id: number) => {
            task.fileRecordId = id;
            context.updateProgress({ state: 'PERSISTING', stage: 'db_persistence', percent: 85 });
          },
        };

        const result = await options.executor(context);

        // Success: transition to COMPLETED
        task.state = 'COMPLETED';
        task.result = result;
        task.completedAt = Date.now();
        task.progress = {
          state: 'COMPLETED',
          percent: 100,
          stage: 'completed',
        };

        this.notifyProgress(task.id, task.progress);
        this.resolveTask(task.id, result);
        return;
      } catch (err: any) {
        if ((task.state as UploadTaskState) === 'CANCELLED') {
          return;
        }

        task.error = err;
        const retryable = isRetryableError(err);

        if (!retryable || task.attempt >= task.maxRetries) {
          // Terminal failure
          task.state = 'FAILED';
          task.completedAt = Date.now();
          task.progress = {
            state: 'FAILED',
            percent: task.progress.percent,
            stage: 'failed',
          };

          this.notifyProgress(task.id, task.progress);

          // Clean up orphaned Drive file if Supabase persistence never completed
          if (task.driveFileId && !task.fileRecordId) {
            const deleter = getDriveDeleter();
            deleter(task.driveFileId).catch(() => {});
          }

          this.rejectTask(task.id, err);
          return;
        }

        // Retryable: backoff delay before next attempt
        task.attempt++;
        const delayMs = calculateRetryDelay(task.attempt, err, {
          baseDelayMs: options.baseDelayMs ?? this.defaultBaseDelayMs,
          maxDelayMs: options.maxDelayMs ?? this.defaultMaxDelayMs,
        });

        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Module-Level Convenience Functions
// ---------------------------------------------------------------------------

export const defaultUploadQueue = new UploadQueue({ concurrency: 2 });

/**
 * Schedules an upload task with retry and consistency recovery through the default queue.
 */
export function uploadWithRetry<TResult = any>(
  options: EnqueueUploadOptions<TResult>
): Promise<TResult> {
  return defaultUploadQueue.enqueue(options);
}

/**
 * Cancels a pending or in-flight upload by ID.
 */
export function cancelPendingUpload(uploadId: string): boolean {
  return defaultUploadQueue.cancel(uploadId);
}

/**
 * Retrieves the status and progress of an upload task.
 */
export function getUploadStatus(uploadId: string): UploadTask | null {
  return defaultUploadQueue.getStatus(uploadId);
}

/**
 * Clears completed or cancelled uploads from history.
 */
export function clearCompletedUploads(): number {
  return defaultUploadQueue.clearCompleted();
}

/**
 * Sweeps and cleans up orphaned storage files from failed uploads.
 */
export function cleanupOrphanedUploads(): Promise<number> {
  return defaultUploadQueue.cleanupOrphaned();
}
