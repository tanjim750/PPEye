/**
 * PPEye Supabase Database Service Unit Test Suite
 *
 * Tests FilesRepository, SubmissionsRepository, ImageLinksRepository, and ReviewsRepository
 * using an in-memory mock client to ensure complete isolation from remote networks.
 */

import assert from 'assert';
import { setDbClientOverride } from '../client';
import { DatabaseError, toDatabaseError } from '../database.errors';
import { FilesRepository } from '../repositories/files.repository';
import { ImageLinksRepository } from '../repositories/image-links.repository';
import { ReviewsRepository } from '../repositories/reviews.repository';
import { SubmissionsRepository } from '../repositories/submissions.repository';

export async function runDatabaseServiceTests(): Promise<{ passed: number; failed: number; total: number }> {
  console.log('\n--- PPEye Supabase Database Service Test Suite ---');
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`    ${err?.message ?? err}`);
      failed++;
    }
  }

  // In-memory data store for mocking Supabase DB
  let filesTable: any[] = [];
  let submissionsTable: any[] = [];
  let workerInstancesTable: any[] = [];
  let ppeImagesTable: any[] = [];
  let otherImagesTable: any[] = [];
  let usersTable: any[] = [];
  let submissionReviewsTable: any[] = [];
  let ppeReviewsTable: any[] = [];
  let unsafeReasonsTable: any[] = [];
  let autoIncId = 100;

  function resetMockDb() {
    filesTable = [];
    submissionsTable = [];
    workerInstancesTable = [];
    ppeImagesTable = [];
    otherImagesTable = [];
    usersTable = [];
    submissionReviewsTable = [];
    ppeReviewsTable = [];
    unsafeReasonsTable = [
      { id: 1, code: 'HELMET_MISSING', label: 'Safety helmet missing', category: 'HEAD', is_active: true },
      { id: 2, code: 'VEST_MISSING', label: 'High-vis vest missing', category: 'TORSO', is_active: true },
      { id: 3, code: 'DEPRECATED_REASON', label: 'Old reason', category: null, is_active: false },
    ];
    autoIncId = 100;
  }

  function createMockDb() {
    return {
      from: (tableName: string) => {
        let filters: Array<(row: any) => boolean> = [];
        let orderFn: ((a: any, b: any) => number) | null = null;
        let limitCount: number | null = null;
        let rangeSpan: [number, number] | null = null;

        const builder: any = {
          select: (_cols?: string) => builder,
          insert: (payload: any) => {
            const items = Array.isArray(payload) ? payload : [payload];
            let insertError: any = null;
            const inserted = items.map((item) => {
              const row = { id: ++autoIncId, ...item };
              if (tableName === 'files') {
                const dup = filesTable.find(
                  (f) => f.storage_provider === row.storage_provider && f.provider_file_id === row.provider_file_id
                );
                if (dup) {
                  insertError = new Error('duplicate key value violates unique constraint "uq_files_provider_file"');
                  insertError.code = '23505';
                  return null;
                }
                filesTable.push(row);
              } else if (tableName === 'ppe_submissions') {
                submissionsTable.push(row);
              } else if (tableName === 'ppe_worker_instances') {
                workerInstancesTable.push(row);
              } else if (tableName === 'ppe_images') {
                ppeImagesTable.push(row);
              } else if (tableName === 'other_images') {
                otherImagesTable.push(row);
              }
              return row;
            });

            return {
              select: () => ({
                single: async () => ({ data: insertError ? null : inserted[0], error: insertError }),
                maybeSingle: async () => ({ data: insertError ? null : inserted[0], error: insertError }),
                then: (resolve: any) => resolve({ data: insertError ? null : inserted, error: insertError }),
              }),
              then: (resolve: any) => resolve({ data: insertError ? null : inserted, error: insertError }),
            };
          },
          upsert: (payload: any, options?: { onConflict?: string }) => {
            const item = Array.isArray(payload) ? payload[0] : payload;
            let existingIdx = -1;
            if (tableName === 'files') {
              existingIdx = filesTable.findIndex(
                (f) => f.storage_provider === item.storage_provider && f.provider_file_id === item.provider_file_id
              );
            }

            let row: any;
            if (existingIdx >= 0) {
              row = { ...filesTable[existingIdx], ...item, updated_at: new Date().toISOString() };
              filesTable[existingIdx] = row;
            } else {
              row = { id: ++autoIncId, ...item };
              if (tableName === 'files') filesTable.push(row);
            }

            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          },
          update: (updates: any) => {
            return {
              eq: (col: string, val: any) => {
                const targetTable =
                  tableName === 'files'
                    ? filesTable
                    : tableName === 'ppe_submissions'
                    ? submissionsTable
                    : tableName === 'ppe_images'
                    ? ppeImagesTable
                    : [];

                let matched: any = null;
                for (let i = 0; i < targetTable.length; i++) {
                  if (targetTable[i][col] === val) {
                    targetTable[i] = { ...targetTable[i], ...updates };
                    matched = targetTable[i];
                  }
                }
                return {
                  select: () => ({
                    single: async () => ({ data: matched, error: null }),
                  }),
                  then: (resolve: any) => resolve({ data: matched, error: null }),
                };
              },
            };
          },
          delete: () => {
            return {
              eq: (col: string, val: any) => {
                if (tableName === 'files') {
                  filesTable = filesTable.filter((f) => f[col] !== val);
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          eq: (col: string, val: any) => {
            filters.push((row: any) => row[col] === val);
            return builder;
          },
          in: (col: string, vals: any[]) => {
            filters.push((row: any) => vals.includes(row[col]));
            return builder;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            const asc = opts?.ascending !== false;
            orderFn = (a: any, b: any) => {
              if (a[col] < b[col]) return asc ? -1 : 1;
              if (a[col] > b[col]) return asc ? 1 : -1;
              return 0;
            };
            return builder;
          },
          limit: (n: number) => {
            limitCount = n;
            return builder;
          },
          range: (from: number, to: number) => {
            rangeSpan = [from, to];
            return builder;
          },
          maybeSingle: async () => {
            const table = getTable(tableName);
            let results = table.filter((row: any) => filters.every((f) => f(row)));
            return { data: results[0] ?? null, error: null };
          },
          single: async () => {
            const table = getTable(tableName);
            let results = table.filter((row: any) => filters.every((f) => f(row)));
            if (results.length === 0) {
              const err: any = new Error('JSON object requested, multiple (or no) rows returned');
              err.code = 'PGRST116';
              return { data: null, error: err };
            }
            return { data: results[0], error: null };
          },
          then: (resolve: any) => {
            const table = getTable(tableName);
            let results = table.filter((row: any) => filters.every((f) => f(row)));
            if (orderFn) results = [...results].sort(orderFn);
            if (rangeSpan) results = results.slice(rangeSpan[0], rangeSpan[1] + 1);
            else if (limitCount !== null) results = results.slice(0, limitCount);
            resolve({ data: results, error: null });
          },
        };

        function getTable(name: string): any[] {
          if (name === 'files') return filesTable;
          if (name === 'ppe_submissions') return submissionsTable;
          if (name === 'ppe_worker_instances') return workerInstancesTable;
          if (name === 'ppe_images') return ppeImagesTable;
          if (name === 'other_images') return otherImagesTable;
          if (name === 'users') return usersTable;
          if (name === 'submission_reviews') return submissionReviewsTable;
          if (name === 'ppe_reviews') return ppeReviewsTable;
          if (name === 'unsafe_reasons') return unsafeReasonsTable;
          return [];
        }

        return builder;
      },
    };
  }

  // Setup test instances
  resetMockDb();
  setDbClientOverride(createMockDb());

  const filesRepo = new FilesRepository();
  const submissionsRepo = new SubmissionsRepository();
  const imageLinksRepo = new ImageLinksRepository();
  const reviewsRepo = new ReviewsRepository();

  // =========================================================================
  // 1. FilesRepository Tests
  // =========================================================================
  console.log('\n• Suite: FilesRepository');

  await test('createFileRecord creates file with default SUPABASE provider and canonical provider_file_id', async () => {
    resetMockDb();
    const file = await filesRepo.createFileRecord({
      provider_file_id: 'submissions/100/workers/1_front_1729510000.jpg',
      file_name: '1_front_1729510000.jpg',
      size_bytes: 450000,
      mime_type: 'image/jpeg',
      created_by: 10,
    });

    assert.strictEqual(file.storage_provider, 'SUPABASE');
    assert.strictEqual(file.provider_file_id, 'submissions/100/workers/1_front_1729510000.jpg');
    assert.strictEqual(file.size_bytes, 450000);
  });

  await test('createFileRecord rejects invalid inputs with VALIDATION_ERROR', async () => {
    await assert.rejects(
      () => filesRepo.createFileRecord({ provider_file_id: '', file_name: 'test.jpg' }),
      (err: any) => err instanceof DatabaseError && err.code === 'VALIDATION_ERROR'
    );
    await assert.rejects(
      () => filesRepo.createFileRecord({ provider_file_id: 'path.jpg', file_name: '' }),
      (err: any) => err instanceof DatabaseError && err.code === 'VALIDATION_ERROR'
    );
    await assert.rejects(
      () => filesRepo.createFileRecord({ provider_file_id: 'path.jpg', file_name: 'test.jpg', size_bytes: -10 }),
      (err: any) => err instanceof DatabaseError && err.code === 'VALIDATION_ERROR'
    );
  });

  await test('createFileRecord handles duplicates gracefully onConflict = ignore', async () => {
    const file1 = await filesRepo.createFileRecord({
      provider_file_id: 'submissions/100/workers/1_front_dup.jpg',
      file_name: '1_front_dup.jpg',
      size_bytes: 1000,
    });

    const file2 = await filesRepo.createFileRecord({
      provider_file_id: 'submissions/100/workers/1_front_dup.jpg',
      file_name: '1_front_dup.jpg',
      size_bytes: 2000,
      onConflict: 'ignore',
    });

    assert.strictEqual(file1.id, file2.id, 'Should return existing record on conflict');
  });

  await test('createFileRecord throws CONFLICT on duplicate when onConflict = error', async () => {
    await assert.rejects(
      () =>
        filesRepo.createFileRecord({
          provider_file_id: 'submissions/100/workers/1_front_dup.jpg',
          file_name: '1_front_dup.jpg',
          onConflict: 'error',
        }),
      (err: any) => err instanceof DatabaseError && err.code === 'CONFLICT'
    );
  });

  await test('getFileRecordById and getFileRecordByProviderId return expected records', async () => {
    const file = await filesRepo.createFileRecord({
      provider_file_id: 'submissions/200/workers/2_front.jpg',
      file_name: '2_front.jpg',
    });

    const byId = await filesRepo.getFileRecordById(file.id);
    assert.strictEqual(byId?.id, file.id);

    const byProvider = await filesRepo.getFileRecordByProviderId('submissions/200/workers/2_front.jpg', 'SUPABASE');
    assert.strictEqual(byProvider?.id, file.id);

    const missing = await filesRepo.getFileRecordById(999999);
    assert.strictEqual(missing, null);
  });

  await test('getFilesByIds returns batch of records', async () => {
    const f1 = await filesRepo.createFileRecord({ provider_file_id: 'batch_1.jpg', file_name: 'b1.jpg' });
    const f2 = await filesRepo.createFileRecord({ provider_file_id: 'batch_2.jpg', file_name: 'b2.jpg' });

    const batch = await filesRepo.getFilesByIds([f1.id, f2.id, 999999]);
    assert.strictEqual(batch.length, 2);
  });

  await test('isFileReferenced detects references across users, ppe_images, other_images', async () => {
    const file = await filesRepo.createFileRecord({ provider_file_id: 'ref_test.jpg', file_name: 'ref.jpg' });
    assert.strictEqual(await filesRepo.isFileReferenced(file.id), false);

    // Reference in ppe_images
    ppeImagesTable.push({ id: 1, worker_instance_id: 10, file_id: file.id, side: 'FRONT' });
    assert.strictEqual(await filesRepo.isFileReferenced(file.id), true);

    // Clean up
    ppeImagesTable = [];
    assert.strictEqual(await filesRepo.isFileReferenced(file.id), false);
  });

  await test('deleteFileRecord prevents deleting referenced files unless force = true', async () => {
    const file = await filesRepo.createFileRecord({ provider_file_id: 'del_test.jpg', file_name: 'del.jpg' });
    otherImagesTable.push({ id: 1, submission_id: 10, file_id: file.id, sequence_no: 1 });

    await assert.rejects(
      () => filesRepo.deleteFileRecord(file.id),
      (err: any) => err instanceof DatabaseError && err.code === 'CONFLICT'
    );

    // With force: true, deletion succeeds if database permits it
    const deleted = await filesRepo.deleteFileRecord(file.id, { force: true });
    assert.strictEqual(deleted, true);
    assert.strictEqual(await filesRepo.getFileRecordById(file.id), null);
  });

  await test('deleteFileRecord never suppresses database RLS or constraint errors even with force = true', async () => {
    // Override db to simulate a database-level RLS rejection (42501)
    const rejectingDb = {
      from: (tbl: string) => ({
        delete: () => ({
          eq: () =>
            Promise.resolve({
              error: { code: '42501', message: 'violates row-level security policy for table "files"' },
            }),
        }),
      }),
    };
    setDbClientOverride(rejectingDb);

    await assert.rejects(
      () => filesRepo.deleteFileRecord(999, { force: true }),
      (err: any) => err instanceof DatabaseError && err.code === 'PERMISSION_DENIED'
    );

    // Restore standard mock DB
    setDbClientOverride(createMockDb());
  });

  // =========================================================================
  // 2. SubmissionsRepository Tests
  // =========================================================================
  console.log('\n• Suite: SubmissionsRepository');

  await test('createSubmissionHeader creates submission and pre-creates worker instances', async () => {
    resetMockDb();
    const result = await submissionsRepo.createSubmissionHeader(
      {
        vendor_profile_id: 1,
        site_name: 'North Tower',
        metadata: { inspectionType: 'STANDARD' },
        status: 'SUBMITTED',
        submitted_by: 12,
      },
      3
    );

    assert.strictEqual(result.submission.vendor_profile_id, 1);
    assert.strictEqual(result.submission.site_name, 'North Tower');
    assert.strictEqual(result.submission.status, 'SUBMITTED');
    assert.strictEqual(result.workerInstances.length, 3);
    assert.strictEqual(result.workerInstances[0].sequence_no, 1);
    assert.strictEqual(result.workerInstances[2].sequence_no, 3);
  });

  await test('listSubmissionsByVendor filters submissions by vendor profile and status', async () => {
    const subs = await submissionsRepo.listSubmissionsByVendor(1);
    assert.strictEqual(subs.length, 1);

    const empty = await submissionsRepo.listSubmissionsByVendor(999);
    assert.strictEqual(empty.length, 0);
  });

  await test('updateSubmissionStatus updates status and records timestamp', async () => {
    const sub = submissionsTable[0];
    const updated = await submissionsRepo.updateSubmissionStatus(sub.id, 'UNDER_REVIEW');
    assert.strictEqual(updated, true);
    assert.strictEqual(submissionsTable[0].status, 'UNDER_REVIEW');
  });

  // =========================================================================
  // 3. ImageLinksRepository Tests
  // =========================================================================
  console.log('\n• Suite: ImageLinksRepository');

  await test('linkPPEWorkerImage links worker front and back photos', async () => {
    resetMockDb();
    const linkFront = await imageLinksRepo.linkPPEWorkerImage(50, 101, 'FRONT');
    assert.strictEqual(linkFront.worker_instance_id, 50);
    assert.strictEqual(linkFront.file_id, 101);
    assert.strictEqual(linkFront.side, 'FRONT');

    const linkBack = await imageLinksRepo.linkPPEWorkerImage(50, 102, 'BACK');
    assert.strictEqual(linkBack.worker_instance_id, 50);
    assert.strictEqual(linkBack.file_id, 102);
    assert.strictEqual(linkBack.side, 'BACK');

    const images = await imageLinksRepo.getWorkerImages(50);
    assert.strictEqual(images.front?.file_id, 101);
    assert.strictEqual(images.back?.file_id, 102);
  });

  await test('replacePPEWorkerImage updates file_id on resubmission', async () => {
    // Worker 50 front image resubmitted with file 105
    const replaced = await imageLinksRepo.replacePPEWorkerImage(50, 'FRONT', 105);
    assert.strictEqual(replaced.file_id, 105);

    const images = await imageLinksRepo.getWorkerImages(50);
    assert.strictEqual(images.front?.file_id, 105, 'Active pointer updated to replacement photo');
    assert.strictEqual(images.back?.file_id, 102, 'Back photo unchanged');
  });

  await test('linkOtherImage links site evidence photo to submission', async () => {
    const other = await imageLinksRepo.linkOtherImage(20, 201, 1);
    assert.strictEqual(other.submission_id, 20);
    assert.strictEqual(other.file_id, 201);
    assert.strictEqual(other.sequence_no, 1);

    const others = await imageLinksRepo.getSubmissionOtherImages(20);
    assert.strictEqual(others.length, 1);
    assert.strictEqual(others[0].file_id, 201);
  });

  // =========================================================================
  // 4. ReviewsRepository Tests
  // =========================================================================
  console.log('\n• Suite: ReviewsRepository');

  await test('listUnsafeReasons returns active reasons only', async () => {
    const reasons = await reviewsRepo.listUnsafeReasons();
    assert.strictEqual(reasons.length, 2, 'Should exclude inactive reasons');
    assert.strictEqual(reasons[0].code, 'HELMET_MISSING');
  });

  await test('getSubmissionReview returns submission review outcome', async () => {
    submissionReviewsTable.push({
      id: 1,
      submission_id: 88,
      reviewer_id: 5,
      status: 'ACTION_REQUIRED',
      verdict: 'UNSAFE',
      reason: 'Helmet not fastened',
      reviewed_at: new Date().toISOString(),
    });

    const rev = await reviewsRepo.getSubmissionReview(88);
    assert.strictEqual(rev?.status, 'ACTION_REQUIRED');
    assert.strictEqual(rev?.verdict, 'UNSAFE');
  });

  // =========================================================================
  // 5. DatabaseError Normalization
  // =========================================================================
  console.log('\n• Suite: DatabaseError Normalization');

  await test('toDatabaseError maps PostgreSQL codes to DatabaseErrorCode', () => {
    const conflict = toDatabaseError({ code: '23505', message: 'duplicate key' });
    assert.strictEqual(conflict.code, 'CONFLICT');

    const perm = toDatabaseError({ code: '42501', message: 'permission denied' });
    assert.strictEqual(perm.code, 'PERMISSION_DENIED');

    const notFound = toDatabaseError({ code: 'PGRST116', message: 'no rows returned' });
    assert.strictEqual(notFound.code, 'NOT_FOUND');

    const fkey = toDatabaseError({ code: '23503', message: 'foreign key violation' });
    assert.strictEqual(fkey.code, 'VALIDATION_ERROR');
  });

  // Reset mock override
  setDbClientOverride(null);

  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total: passed + failed };
}
