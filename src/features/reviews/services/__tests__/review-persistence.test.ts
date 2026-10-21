import {
  persistCompletedSubmissionReview,
  persistReviewerDraft,
  PersistableWorkerVerdict,
} from '@/features/reviews/services/reviewPersistence';

type Row = Record<string, any>;

function createReviewDb() {
  const state = {
    submission: {
      id: 1,
      status: 'SUBMITTED',
      metadata: { existing: 'kept' } as Row,
      ppe_worker_instances: [
        { id: 101, sequence_no: 1 },
        { id: 102, sequence_no: 2 },
      ],
    },
    reasons: [
      { id: 11, code: 'HELMET', is_active: true },
      { id: 12, code: 'OTHER', is_active: true },
    ],
    ppeReviews: [] as Row[],
    ppeReviewReasons: [] as Row[],
    submissionReviews: [] as Row[],
    failTable: '' as string,
    failOperation: '' as string,
  };
  let nextReviewId = 1;
  let nextReasonId = 1;
  let nextSubmissionReviewId = 1;

  class Query {
    private operation = 'select';
    private payload: any;
    private selection = '';
    private values: Record<string, any> = {};

    constructor(private table: string) {}

    select(columns = '') {
      this.selection = columns;
      return this;
    }

    eq(column: string, value: any) {
      this.values[column] = value;
      return this;
    }

    order() { return this; }

    limit() { return this; }

    maybeSingle() {
      return this.execute(true);
    }

    single() {
      return this.execute(false);
    }

    insert(payload: any) {
      this.operation = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload: any) {
      this.operation = 'update';
      this.payload = payload;
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    then(resolve: (value: any) => any, reject?: (reason: any) => any) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }

    private execute(maybeSingle = false): any {
      if (state.failTable === this.table && this.operation !== 'select' && (!state.failOperation || state.failOperation === this.operation)) {
        return { data: null, error: { message: `forced ${this.table} failure` } };
      }
      if (this.operation === 'select') {
        if (this.table === 'ppe_submissions') {
          const data = this.selection.includes('ppe_worker_instances')
            ? { status: state.submission.status, metadata: state.submission.metadata, ppe_worker_instances: state.submission.ppe_worker_instances }
            : { status: state.submission.status, metadata: state.submission.metadata };
          return { data, error: null };
        }
        if (this.table === 'unsafe_reasons') return { data: state.reasons, error: null };
        if (this.table === 'ppe_reviews') {
          const data = state.ppeReviews.filter((row) => row.worker_instance_id === this.values.worker_instance_id).at(-1) || null;
          return { data, error: null };
        }
        if (this.table === 'ppe_review_reasons') {
          return { data: state.ppeReviewReasons.filter((row) => row.ppe_review_id === this.values.ppe_review_id), error: null };
        }
        if (this.table === 'submission_reviews') {
          const data = state.submissionReviews.filter((row) => row.submission_id === this.values.submission_id).at(-1) || null;
          return { data, error: null };
        }
        return { data: null, error: null };
      }
      if (this.operation === 'insert') {
        if (this.table === 'ppe_reviews') {
          const row = { ...(this.payload as Row), id: nextReviewId++ };
          state.ppeReviews.push(row);
          return { data: this.selection ? { id: row.id } : null, error: null };
        }
        if (this.table === 'ppe_review_reasons') {
          state.ppeReviewReasons.push(...(Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({ ...row, id: nextReasonId++ })));
        }
        if (this.table === 'submission_reviews') {
          state.submissionReviews.push({ ...this.payload, id: nextSubmissionReviewId++ });
        }
        return { data: null, error: null };
      }
      if (this.operation === 'update' && this.table !== 'ppe_submissions') {
        const rows = this.table === 'ppe_reviews'
          ? state.ppeReviews
          : this.table === 'ppe_review_reasons'
            ? state.ppeReviewReasons
            : this.table === 'submission_reviews'
              ? state.submissionReviews
              : [];
        const matches = rows.filter((row: Row) => Object.entries(this.values).every(([key, value]) => row[key] === value));
        matches.forEach((row: Row) => Object.assign(row, this.payload));
        return { data: this.selection ? matches[0] || null : null, error: null };
      }
      if (this.operation === 'delete' && this.table === 'ppe_review_reasons') {
        const removed = state.ppeReviewReasons.filter((row) => Object.entries(this.values).every(([key, value]) => row[key] === value));
        state.ppeReviewReasons = state.ppeReviewReasons.filter((row) => !removed.includes(row));
        return { data: null, error: null };
      }
      if (this.operation === 'update' && this.table === 'ppe_submissions') {
        Object.assign(state.submission, this.payload);
        return { data: { id: state.submission.id }, error: null };
      }
      return { data: maybeSingle ? null : [], error: null };
    }
  }

  return {
    state,
    db: { from: (table: string) => new Query(table) },
  };
}

export async function runReviewPersistenceTests() {
  const { state, db } = createReviewDb();
  const verdicts: PersistableWorkerVerdict[] = [
      { sequenceNo: 1, status: 'safe', frontDriveId: 'front-a', backDriveId: 'back-a' },
      { sequenceNo: 2, status: 'unsafe', unsafeReasons: ['helmet', 'other'], otherReasonText: 'Helmet strap is open' },
  ];
    const result = await persistCompletedSubmissionReview(db, 1, 7, verdicts);
    if (!result.success) throw new Error(`Expected review completion, received: ${result.error}`);
    if (state.ppeReviews.length !== 2) throw new Error('Expected one ppe_reviews row per worker.');
    if (state.ppeReviewReasons.length !== 2) throw new Error('Expected relational unsafe reasons for the unsafe worker.');
    if (state.ppeReviewReasons[0].note !== null || state.ppeReviewReasons[1].note !== 'Helmet strap is open') {
      throw new Error('Expected the Other reason note to be stored on its relational reason row.');
    }
    if (state.submissionReviews.length !== 1 || state.submissionReviews[0].verdict !== 'UNSAFE') {
      throw new Error('Expected one overall unsafe submission review.');
    }
    if (state.submission.status !== 'COMPLETED') throw new Error('Expected the submission status to become COMPLETED.');
    if (state.submission.metadata.existing !== 'kept' || state.submission.metadata.reviewResult !== 'unsafe' || state.submission.metadata.reviewDraft !== null) {
      throw new Error('Expected the metadata mirror to be merged and the draft cleared.');
    }

    const draftDb = createReviewDb();
    const draft = await persistReviewerDraft(draftDb.db, 1, 7, [verdicts[0]]);
    if (!draft.success) throw new Error(`Expected draft save, received: ${draft.error}`);
    if (draftDb.state.submission.status !== 'UNDER_REVIEW' || draftDb.state.submission.metadata.reviewDraft?.reviewerId !== 7) {
      throw new Error('Expected reviewer draft owner, progress, and verdicts to persist.');
    }

    const retryDb = createReviewDb();
    retryDb.state.failTable = 'ppe_review_reasons';
    retryDb.state.failOperation = 'insert';
    const failed = await persistCompletedSubmissionReview(retryDb.db, 1, 7, verdicts);
    if (failed.success || !failed.error?.includes('forced ppe_review_reasons failure')) {
      throw new Error('Expected relational write failure to be surfaced to the caller.');
    }
    if (retryDb.state.submission.status === 'COMPLETED') {
      throw new Error('A failed reason write must not mark the submission completed.');
    }
    retryDb.state.failTable = '';
    retryDb.state.failOperation = '';
    const retried = await persistCompletedSubmissionReview(retryDb.db, 1, 7, verdicts);
    if (!retried.success) throw new Error(`Expected retry to complete, received: ${retried.error}`);
    if (retryDb.state.ppeReviews.length !== 2 || retryDb.state.ppeReviewReasons.length !== 2 || retryDb.state.submissionReviews.length !== 1) {
      throw new Error('Retry after partial failure must update existing verdict/reason rows without creating duplicates.');
    }
    if (retryDb.state.submission.status !== 'COMPLETED') throw new Error('Expected successful retry to mark the submission complete.');
    console.log('Review Persistence Test Result: 4/4 passed (0 failed)');
    return { passed: 4, failed: 0, total: 4 };
}
