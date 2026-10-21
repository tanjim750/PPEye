/**
 * PPEye Vendor-Side Workflow & Authorization Test Suite
 *
 * Verifies:
 * 1. Vendor Role Hierarchy & Permissions (PROJECT_MANAGER, TEAM_LEADER, WORKER)
 * 2. Vendor Dashboard Statistics & Metric Aggregation (Pending, Safe, Unsafe, Drafts, Compliance %)
 * 3. Role-Based Submissions Access & Worker Isolation
 * 4. Submission Listing with Status Filters (ALL, PENDING, SAFE, UNSAFE, DRAFT)
 * 5. Full Submission Details Inspection (Workers, FRONT/BACK Photos, Reviewer Verdicts, Unsafe Reasons)
 * 6. Draft Submission Lifecycle (Save, Update, Delete with Child Cleanup, Rejection of Submitted/Reviewed Edits)
 * 7. Draft Finalization & Review Submission (Strict FRONT/BACK Pair Enforcement)
 * 8. Unsafe Worker Evidence Resubmission (Active Reference Replacement & SUBMITTED Transition)
 * 9. Vendor Team Management & Security Constraints (Phone Validation, Internal User Blocking, Duplicate Guards)
 */

import { getVendorPermissions } from '../vendorRole.service';
import {
  getVendorDashboardStats,
  listVendorSubmissions,
  getVendorSubmissionDetails,
  saveDraftSubmission,
  deleteDraftSubmission,
  submitDraftForReview,
  resubmitUnsafeWorker,
  setVendorSubmissionsSupabaseOverride,
  setVendorSubmissionsReplaceImageMock,
  latestCurrentReview,
  mapCurrentWorkerReviewStatus,
} from '../vendorSubmissions.service';
import {
  getVendorTeamMembers,
  addVendorTeamMember,
  removeVendorTeamMember,
  setVendorTeamSupabaseOverride,
} from '../vendorTeam.service';
import { StorageErrorCode } from '../../storage/storage.errors';
import { createRefCountedSubscription } from '../../realtime/refCountedSubscription';
import { computeReviewsSignature } from '../../../features/reviews/services/reviewSignature';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function assertAsyncThrows(
  promiseFn: () => Promise<any>,
  expectedCode?: string,
  message?: string
): Promise<void> {
  let threw = false;
  try {
    await promiseFn();
  } catch (err: any) {
    threw = true;
    if (expectedCode) {
      assert(
        err?.code === expectedCode,
        `Expected error code '${expectedCode}', received '${err?.code}' (${err?.message}): ${message}`
      );
    }
  }
  assert(threw, `Expected async function to throw, but it succeeded: ${message}`);
}

// ---------------------------------------------------------------------------
// In-Memory Database Simulation
// ---------------------------------------------------------------------------

interface MockSubmission {
  id: number;
  vendor_profile_id: number;
  submitted_by: number;
  site_name: string;
  metadata: any;
  status: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MockWorkerInstance {
  id: number;
  submission_id: number;
  sequence_no: number;
  created_at: string;
}

interface MockPPEImage {
  id: number;
  worker_instance_id: number;
  file_id: number;
  side: 'FRONT' | 'BACK';
  created_at: string;
}

interface MockOtherImage {
  id: number;
  submission_id: number;
  file_id: number;
  sequence_no: number;
  created_at: string;
}

interface MockFileRow {
  id: number;
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
}

interface MockSubmissionReview {
  id: number;
  submission_id: number;
  verdict: 'SAFE' | 'UNSAFE';
  reason: string | null;
  reviewed_at: string;
}

interface MockPpeReview {
  id: number;
  worker_instance_id: number;
  verdict: 'SAFE' | 'UNSAFE';
  reviewed_at: string;
}

interface MockPpeReviewReason {
  id: number;
  ppe_review_id: number;
  unsafe_reason_id: number;
  note: string | null;
}

interface MockUser {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  category: 'INTERNAL' | 'EXTERNAL';
  designation: string | null;
  external_type: 'PROJECT_MANAGER' | 'TEAM_LEADER' | 'WORKER' | null;
  is_active: boolean;
}

interface MockVendorMember {
  id: number;
  vendor_profile_id: number;
  user_id: number;
  created_at: string;
}

export async function runVendorTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.stack || err?.message || err}`);
      failed++;
    }
  }

  await test('A resubmitted image invalidates older worker verdicts and current metadata/relation verdicts map to UI states', () => {
    const oldReviewWorker = { ppe_reviews: [{ verdict: 'UNSAFE', reviewed_at: '2026-10-01T00:00:00.000Z' }], ppe_images: [{ created_at: '2026-10-02T00:00:00.000Z' }] };
    assert(latestCurrentReview(oldReviewWorker) === null, 'A photo newer than review is pending re-review');
    assert(mapCurrentWorkerReviewStatus(oldReviewWorker) === 'review', 'Stale verdict maps to review');
    const currentWorker = { ppe_reviews: [{ verdict: 'SAFE', reviewed_at: '2026-10-02T00:00:00.000Z' }], ppe_images: [{ created_at: '2026-10-01T00:00:00.000Z' }] };
    assert(mapCurrentWorkerReviewStatus(currentWorker) === 'safe', 'Current relational SAFE verdict maps to safe');
    assert(mapCurrentWorkerReviewStatus({ ppe_reviews: [], ppe_images: currentWorker.ppe_images }, { status: 'unsafe', reviewedAt: Date.parse('2026-10-03T00:00:00.000Z'), unsafeReasons: ['helmet'] }) === 'unsafe', 'Current metadata fallback verdict maps to unsafe');
    assert(mapCurrentWorkerReviewStatus({ ppe_reviews: [{ verdict: 'UNSAFE', reviewed_at: '2026-10-03T00:00:00.000Z' }], ppe_images: [{ created_at: '2026-10-02T00:00:00.000Z' }] }) === 'unsafe', 'Current relational UNSAFE verdict maps to unsafe');
  });

  await test('Review sync signature changes with verdict/photo state and shared Realtime subscribers deduplicate', () => {
    const base = [{ id: '12', status: 'waiting', timestamp: 1, workers: 1, photos: 2, workerReviews: [{ sequenceNo: 1, status: 'safe', frontDriveId: 'front-a' }] }];
    assert(computeReviewsSignature(base) === computeReviewsSignature(base), 'Identical review state has identical signature');
    assert(computeReviewsSignature(base) !== computeReviewsSignature([{ ...base[0], workerReviews: [{ sequenceNo: 1, status: 'unsafe', frontDriveId: 'front-a' }] }]), 'Verdict change changes signature');
    assert(computeReviewsSignature(base) !== computeReviewsSignature([{ ...base[0], workerReviews: [{ sequenceNo: 1, status: 'safe', frontDriveId: 'front-b' }] }]), 'Photo reference change changes signature');
    let starts = 0;
    let stops = 0;
    const shared = createRefCountedSubscription(() => { starts += 1; return () => { stops += 1; }; });
    const releaseFirst = shared.acquire();
    const releaseSecond = shared.acquire();
    assert(starts === 1 && shared.count === 2, 'Concurrent consumers share one realtime start');
    releaseFirst();
    assert(stops === 0 && shared.count === 1, 'Channel remains while one consumer exists');
    releaseSecond();
    assert(stops === 1 && shared.count === 0, 'Channel cleans up when the last consumer leaves');
  });

  // State containers
  let submissions: MockSubmission[] = [];
  let workerInstances: MockWorkerInstance[] = [];
  let ppeImages: MockPPEImage[] = [];
  let otherImages: MockOtherImage[] = [];
  let files: MockFileRow[] = [];
  let submissionReviews: MockSubmissionReview[] = [];
  let ppeReviews: MockPpeReview[] = [];
  let ppeReviewReasons: MockPpeReviewReason[] = [];
  let users: MockUser[] = [];
  let vendorMembers: MockVendorMember[] = [];

  let nextSubmissionId = 100;
  let nextWorkerInstanceId = 200;
  let nextPPEImageId = 300;
  let nextOtherImageId = 400;
  let nextFileId = 500;
  let nextUserId = 600;
  let nextMemberId = 700;
  let failSubmissionStatusUpdate = false;

  function resetState() {
    submissions = [
      {
        id: 1,
        vendor_profile_id: 1,
        submitted_by: 10,
        site_name: 'Metro Site North',
        metadata: { workerCount: 1 },
        status: 'SUBMITTED',
        submitted_at: '2026-10-15T09:00:00.000Z',
        created_at: '2026-10-15T08:50:00.000Z',
        updated_at: '2026-10-15T09:00:00.000Z',
      },
      {
        id: 2,
        vendor_profile_id: 1,
        submitted_by: 10,
        site_name: 'Central Tower East',
        metadata: { workerCount: 1 },
        status: 'SUBMITTED',
        submitted_at: '2026-10-16T11:00:00.000Z',
        created_at: '2026-10-16T10:45:00.000Z',
        updated_at: '2026-10-16T11:00:00.000Z',
      },
      {
        id: 3,
        vendor_profile_id: 1,
        submitted_by: 10,
        site_name: 'Gazipur Substation',
        metadata: { workerCount: 1 },
        status: 'DRAFT',
        submitted_at: null,
        created_at: '2026-10-17T08:00:00.000Z',
        updated_at: '2026-10-17T08:05:00.000Z',
      },
      {
        id: 4,
        vendor_profile_id: 2, // Belongs to a different vendor!
        submitted_by: 99,
        site_name: 'Competitor Site',
        metadata: { workerCount: 1 },
        status: 'SUBMITTED',
        submitted_at: '2026-10-17T09:00:00.000Z',
        created_at: '2026-10-17T09:00:00.000Z',
        updated_at: '2026-10-17T09:00:00.000Z',
      },
    ];

    workerInstances = [
      { id: 11, submission_id: 1, sequence_no: 1, created_at: '2026-10-15T08:55:00.000Z' },
      { id: 12, submission_id: 2, sequence_no: 1, created_at: '2026-10-16T10:50:00.000Z' },
      { id: 13, submission_id: 3, sequence_no: 1, created_at: '2026-10-17T08:02:00.000Z' },
    ];

    files = [
      { id: 21, provider_file_id: 'drive_front_1', file_name: 'w1_front.jpg', mime_type: 'image/jpeg' },
      { id: 22, provider_file_id: 'drive_back_1', file_name: 'w1_back.jpg', mime_type: 'image/jpeg' },
      { id: 23, provider_file_id: 'drive_front_2', file_name: 'w2_front.jpg', mime_type: 'image/jpeg' },
      { id: 24, provider_file_id: 'drive_back_2', file_name: 'w2_back.jpg', mime_type: 'image/jpeg' },
      { id: 25, provider_file_id: 'drive_front_3', file_name: 'w3_front.jpg', mime_type: 'image/jpeg' },
      { id: 26, provider_file_id: 'drive_back_3', file_name: 'w3_back.jpg', mime_type: 'image/jpeg' },
    ];

    ppeImages = [
      { id: 31, worker_instance_id: 11, file_id: 21, side: 'FRONT', created_at: '2026-10-15T08:56:00.000Z' },
      { id: 32, worker_instance_id: 11, file_id: 22, side: 'BACK', created_at: '2026-10-15T08:57:00.000Z' },
      { id: 33, worker_instance_id: 12, file_id: 23, side: 'FRONT', created_at: '2026-10-16T10:51:00.000Z' },
      { id: 34, worker_instance_id: 12, file_id: 24, side: 'BACK', created_at: '2026-10-16T10:52:00.000Z' },
      { id: 35, worker_instance_id: 13, file_id: 25, side: 'FRONT', created_at: '2026-10-17T08:03:00.000Z' },
      // Worker 13 in draft 3 does NOT have a BACK image yet!
    ];

    otherImages = [];

    submissionReviews = [
      {
        id: 41,
        submission_id: 1,
        verdict: 'SAFE',
        reason: 'All PPE compliant and properly worn.',
        reviewed_at: '2026-10-15T09:30:00.000Z',
      },
      {
        id: 42,
        submission_id: 2,
        verdict: 'UNSAFE',
        reason: 'Missing safety helmet chin strap and boots unlaced.',
        reviewed_at: '2026-10-16T11:30:00.000Z',
      },
    ];

    ppeReviews = [
      { id: 51, worker_instance_id: 11, verdict: 'SAFE', reviewed_at: '2026-10-15T09:28:00.000Z' },
      { id: 52, worker_instance_id: 12, verdict: 'UNSAFE', reviewed_at: '2026-10-16T11:28:00.000Z' },
    ];

    ppeReviewReasons = [
      { id: 61, ppe_review_id: 52, unsafe_reason_id: 101, note: 'Helmet chin strap loose' },
    ];

    users = [
      {
        id: 10,
        name: 'Tariq PM',
        phone: '+8801700000001',
        email: 'tariq@vendor.com',
        category: 'EXTERNAL',
        designation: 'Project Manager',
        external_type: 'PROJECT_MANAGER',
        is_active: true,
      },
      {
        id: 11,
        name: 'Kabir Lead',
        phone: '+8801700000002',
        email: 'kabir@vendor.com',
        category: 'EXTERNAL',
        designation: 'Team Leader',
        external_type: 'TEAM_LEADER',
        is_active: true,
      },
      {
        id: 12,
        name: 'Hassan Worker',
        phone: '+8801700000003',
        email: null,
        category: 'EXTERNAL',
        designation: 'Rigger',
        external_type: 'WORKER',
        is_active: true,
      },
      {
        id: 99,
        name: 'Mahmud Reviewer',
        phone: '+8801700000099',
        email: 'mahmud@internal.com',
        category: 'INTERNAL',
        designation: 'EHS Reviewer',
        external_type: null,
        is_active: true,
      },
    ];

    vendorMembers = [
      { id: 1, vendor_profile_id: 1, user_id: 10, created_at: '2026-10-01T00:00:00.000Z' },
      { id: 2, vendor_profile_id: 1, user_id: 11, created_at: '2026-10-02T00:00:00.000Z' },
      { id: 3, vendor_profile_id: 1, user_id: 12, created_at: '2026-10-03T00:00:00.000Z' },
    ];

    nextSubmissionId = 100;
    nextWorkerInstanceId = 200;
    nextPPEImageId = 300;
    nextOtherImageId = 400;
    nextFileId = 500;
    nextUserId = 600;
    nextMemberId = 700;
    failSubmissionStatusUpdate = false;
  }

  function createMockSupabase(): any {
    return {
      from: (table: string) => {
        let filters: Array<(item: any) => boolean> = [];
        let limitCount: number | null = null;

        const chain: any = {
          select: (columns?: string) => chain,
          eq: (column: string, value: any) => {
            filters.push((item: any) => item[column] === value);
            return chain;
          },
          in: (column: string, values: any[]) => {
            filters.push((item: any) => values.includes(item[column]));
            return chain;
          },
          order: (column: string, opts?: { ascending?: boolean }) => chain,
          limit: (n: number) => {
            limitCount = n;
            return chain;
          },
          maybeSingle: async () => {
            let list = getTableData(table);
            let matched = list.filter((item) => filters.every((f) => f(item)));
            if (matched.length === 0) return { data: null, error: null };
            return { data: enrichRow(table, matched[0]), error: null };
          },
          single: async () => {
            let list = getTableData(table);
            let matched = list.filter((item) => filters.every((f) => f(item)));
            if (matched.length === 0) return { data: null, error: { message: 'Row not found' } };
            return { data: enrichRow(table, matched[0]), error: null };
          },
          insert: (payload: any) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            const insertedRows: any[] = [];

            for (const r of rows) {
              if (table === 'ppe_submissions') {
                const newRow: MockSubmission = {
                  id: ++nextSubmissionId,
                  vendor_profile_id: r.vendor_profile_id ?? 1,
                  submitted_by: r.submitted_by ?? 1,
                  site_name: r.site_name,
                  metadata: r.metadata ?? {},
                  status: r.status ?? 'DRAFT',
                  submitted_at: r.submitted_at ?? null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                submissions.push(newRow);
                insertedRows.push(newRow);
              } else if (table === 'users') {
                const newRow: MockUser = {
                  id: ++nextUserId,
                  name: r.name,
                  phone: r.phone,
                  email: r.email ?? null,
                  category: r.category ?? 'EXTERNAL',
                  designation: r.designation ?? null,
                  external_type: r.external_type ?? 'WORKER',
                  is_active: r.is_active ?? true,
                };
                users.push(newRow);
                insertedRows.push(newRow);
              } else if (table === 'vendor_members') {
                // Check unique constraint (vendor_profile_id, user_id)
                const exists = vendorMembers.some(
                  (vm) => vm.vendor_profile_id === r.vendor_profile_id && vm.user_id === r.user_id
                );
                if (exists) {
                  return {
                    select: () => ({
                      single: async () => ({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                      }),
                    }),
                  };
                }
                const newRow: MockVendorMember = {
                  id: ++nextMemberId,
                  vendor_profile_id: r.vendor_profile_id,
                  user_id: r.user_id,
                  created_at: new Date().toISOString(),
                };
                vendorMembers.push(newRow);
                insertedRows.push(newRow);
              }
            }

            return {
              select: () => ({
                single: async () => ({ data: insertedRows[0], error: null }),
              }),
            };
          },
          update: (fields: any) => {
            const updateFilters: Array<(item: any) => boolean> = [];
            const updateChain: any = {
              eq: (col: string, val: any) => {
                updateFilters.push((item: any) => item[col] === val);
                return updateChain;
              },
              then: (resolve: (val: any) => void) => {
                if (table === 'ppe_submissions' && fields.status === 'SUBMITTED' && failSubmissionStatusUpdate) {
                  resolve({ error: { message: 'forced status update failure' } });
                  return;
                }
                let list = getTableData(table);
                for (const item of list) {
                  if (updateFilters.every((f) => f(item))) {
                    Object.assign(item, fields);
                  }
                }
                resolve({ error: null });
              },
            };
            return updateChain;
          },
          delete: () => {
            const deleteFilters: Array<(item: any) => boolean> = [];
            const deleteChain: any = {
              eq: (col: string, val: any) => {
                deleteFilters.push((item: any) => item[col] === val);
                return deleteChain;
              },
              in: (col: string, vals: any[]) => {
                deleteFilters.push((item: any) => vals.includes(item[col]));
                return deleteChain;
              },
              then: (resolve: (val: any) => void) => {
                deleteFromTable(table, (item) => deleteFilters.every((f) => f(item)));
                resolve({ error: null });
              },
            };
            return deleteChain;
          },
          then: (resolve: (val: any) => void) => {
            let list = getTableData(table);
            let matched = list.filter((item) => filters.every((f) => f(item)));
            if (limitCount !== null) {
              matched = matched.slice(0, limitCount);
            }
            const enriched = matched.map((row) => enrichRow(table, row));
            resolve({ data: enriched, error: null });
          },
        };

        return chain;
      },
    };
  }

  function getTableData(table: string): any[] {
    if (table === 'ppe_submissions') return submissions;
    if (table === 'ppe_worker_instances') return workerInstances;
    if (table === 'ppe_images') return ppeImages;
    if (table === 'other_images') return otherImages;
    if (table === 'files') return files;
    if (table === 'users') return users;
    if (table === 'vendor_members') return vendorMembers;
    return [];
  }

  function deleteFromTable(table: string, predicate: (item: any) => boolean) {
    if (table === 'ppe_submissions') submissions = submissions.filter((s) => !predicate(s));
    else if (table === 'ppe_worker_instances') workerInstances = workerInstances.filter((w) => !predicate(w));
    else if (table === 'ppe_images') ppeImages = ppeImages.filter((p) => !predicate(p));
    else if (table === 'other_images') otherImages = otherImages.filter((o) => !predicate(o));
    else if (table === 'vendor_members') vendorMembers = vendorMembers.filter((vm) => !predicate(vm));
  }

  function enrichRow(table: string, row: any): any {
    if (table === 'ppe_submissions') {
      const wInstances = workerInstances
        .filter((w) => w.submission_id === row.id)
        .map((w) => {
          const wImgs = ppeImages
            .filter((img) => img.worker_instance_id === w.id)
            .map((img) => ({
              ...img,
              files: files.find((f) => f.id === img.file_id) || null,
            }));

          const wReviews = ppeReviews
            .filter((r) => r.worker_instance_id === w.id)
            .map((r) => ({
              ...r,
              ppe_review_reasons: ppeReviewReasons
                .filter((rr) => rr.ppe_review_id === r.id)
                .map((rr) => ({
                  note: rr.note,
                  unsafe_reasons: { code: 'NO_CHIN_STRAP', label: 'Helmet chin strap loose' },
                })),
            }));

          return {
            ...w,
            ppe_images: wImgs,
            ppe_reviews: wReviews,
          };
        });

      const reviews = submissionReviews.filter((r) => r.submission_id === row.id);
      const oImgs = otherImages
        .filter((o) => o.submission_id === row.id)
        .map((o) => ({
          ...o,
          files: files.find((f) => f.id === o.file_id) || null,
        }));

      return {
        ...row,
        ppe_worker_instances: wInstances,
        submission_reviews: reviews,
        other_images: oImgs,
      };
    }

    if (table === 'vendor_members') {
      const u = users.find((user) => user.id === row.user_id) || null;
      return {
        ...row,
        users: u,
      };
    }

    return { ...row };
  }

  console.log('\n========================================');
  console.log('PPEye Vendor-Side Architecture & Security Tests');
  console.log('========================================\n');

  // =========================================================================
  // 1. Vendor Role Hierarchy & Permissions
  // =========================================================================
  console.log('• Suite 1: Vendor Role Hierarchy & Boundary Enforcement');

  await test('Project Manager has broad vendor view, create, draft, feedback, and team management capabilities', () => {
    const pmPerms = getVendorPermissions('PROJECT_MANAGER');
    assert(pmPerms.canViewVendorSubmissions === true, 'PM can view vendor submissions');
    assert(pmPerms.canCreateSubmission === true, 'PM can create submissions');
    assert(pmPerms.canSaveDraft === true, 'PM can save drafts');
    assert(pmPerms.canDeleteDraft === true, 'PM can delete drafts');
    assert(pmPerms.canViewFeedback === true, 'PM can view review feedback');
    assert(pmPerms.canResubmitUnsafe === true, 'PM can resubmit unsafe checks');
    assert(pmPerms.canManageTeamMembers === true, 'PM can manage vendor team members');
    assert(pmPerms.canViewProfile === true, 'PM can view profile');
    assert(pmPerms.canEditProfile === true, 'PM can edit profile');
  });

  await test('Team Leader has submission capabilities but CANNOT manage team members', () => {
    const tlPerms = getVendorPermissions('TEAM_LEADER');
    assert(tlPerms.canViewVendorSubmissions === true, 'Team Leader can view submissions');
    assert(tlPerms.canCreateSubmission === true, 'Team Leader can create submissions');
    assert(tlPerms.canSaveDraft === true, 'Team Leader can save drafts');
    assert(tlPerms.canDeleteDraft === true, 'Team Leader can delete drafts');
    assert(tlPerms.canViewFeedback === true, 'Team Leader can view feedback');
    assert(tlPerms.canResubmitUnsafe === true, 'Team Leader can resubmit unsafe checks');
    assert(tlPerms.canManageTeamMembers === false, 'Team Leader CANNOT manage team members');
  });

  await test('Worker has strict data isolation: CANNOT view vendor submissions or manage team', () => {
    const workerPerms = getVendorPermissions('WORKER');
    assert(workerPerms.canViewVendorSubmissions === false, 'Worker CANNOT view blanket vendor submissions');
    assert(workerPerms.canCreateSubmission === false, 'Worker CANNOT create submissions by default');
    assert(workerPerms.canSaveDraft === false, 'Worker CANNOT save drafts');
    assert(workerPerms.canDeleteDraft === false, 'Worker CANNOT delete drafts');
    assert(workerPerms.canViewFeedback === false, 'Worker CANNOT view broad feedback');
    assert(workerPerms.canManageTeamMembers === false, 'Worker CANNOT manage team members');
    assert(workerPerms.canViewProfile === true, 'Worker can view profile');
    assert(workerPerms.canEditProfile === true, 'Worker can edit profile');
  });

  // =========================================================================
  // 2. Vendor Dashboard Statistics & Isolation
  // =========================================================================
  console.log('\n• Suite 2: Vendor Dashboard Statistics & Multi-Tenant Isolation');

  await test('Calculates accurate metrics for authorized vendor profile (Safe, Unsafe, Drafts, Compliance %)', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    const result = await getVendorDashboardStats(1, 10, 'PROJECT_MANAGER');
    const { stats, recentChecks } = result;

    // Submissions for vendor 1:
    // Sub 1: SUBMITTED, review SAFE
    // Sub 2: SUBMITTED, review UNSAFE
    // Sub 3: DRAFT
    // Sub 4: Belongs to vendor 2 (must be excluded!)
    assert(stats.totalSubmissions === 3, `Expected 3 vendor submissions, got ${stats.totalSubmissions}`);
    assert(stats.safeCount === 1, `Expected 1 safe submission, got ${stats.safeCount}`);
    assert(stats.unsafeCount === 1, `Expected 1 unsafe submission, got ${stats.unsafeCount}`);
    assert(stats.draftCount === 1, `Expected 1 draft submission, got ${stats.draftCount}`);
    assert(stats.complianceRate === 50, `Expected 50% compliance rate, got ${stats.complianceRate}%`);
    assert(stats.activeDraft !== null, 'Active draft found');
    assert(stats.activeDraft?.id === 3, 'Active draft has ID 3');

    // Recent checks feed
    assert(recentChecks.length > 0, 'Recent checks returned');
    const unsafeCheck = recentChecks.find((c) => c.status === 'unsafe');
    assert(unsafeCheck !== undefined, 'Unsafe check found in recent checks');
    assert(unsafeCheck?.submissionId === 2, 'Unsafe check corresponds to submission 2');
    assert(
      Array.isArray(unsafeCheck?.unsafeReasons) && unsafeCheck!.unsafeReasons!.length > 0,
      'Unsafe check includes specific violation reason'
    );
  });

  await test('Strict Vendor Isolation: Vendor 2 data is never returned to Vendor 1', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    const resVendor2 = await getVendorDashboardStats(2, 99, 'PROJECT_MANAGER');
    assert(resVendor2.stats.totalSubmissions === 1, 'Vendor 2 only sees their single submission');
    assert(resVendor2.stats.safeCount === 0, 'Vendor 2 has 0 safe submissions');
  });

  // =========================================================================
  // 3. Submissions Filtering & Inspection
  // =========================================================================
  console.log('\n• Suite 3: Submissions Listing & Detailed Inspection');

  await test('listVendorSubmissions correctly filters by status tabs (SAFE, UNSAFE, DRAFT)', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    const all = await listVendorSubmissions({ vendorProfileId: 1, statusFilter: 'ALL' });
    assert(all.length === 3, `All filter returned ${all.length} items`);

    const safeOnly = await listVendorSubmissions({ vendorProfileId: 1, statusFilter: 'SAFE' });
    assert(safeOnly.length === 1 && safeOnly[0].id === 1, 'SAFE filter returned submission 1');

    const unsafeOnly = await listVendorSubmissions({ vendorProfileId: 1, statusFilter: 'UNSAFE' });
    assert(unsafeOnly.length === 1 && unsafeOnly[0].id === 2, 'UNSAFE filter returned submission 2');

    const draftsOnly = await listVendorSubmissions({ vendorProfileId: 1, statusFilter: 'DRAFT' });
    assert(draftsOnly.length === 1 && draftsOnly[0].id === 3, 'DRAFT filter returned submission 3');
  });

  await test('getVendorSubmissionDetails returns complete inspection photos and reviewer findings', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    const details = await getVendorSubmissionDetails(2);
    assert(details !== null, 'Submission 2 details retrieved');
    assert(details?.siteName === 'Central Tower East', 'Site name matches');
    assert(details?.verdict === 'UNSAFE', 'Review verdict is UNSAFE');
    assert(details?.reviewerFeedback !== null, 'Reviewer feedback is populated');
    assert(details?.workers.length === 1, '1 worker instance present');

    const worker = details!.workers[0];
    assert(worker.sequenceNo === 1, 'Worker sequence number is 1');
    assert(worker.frontPhoto?.providerFileId === 'drive_front_2', 'Front photo matches');
    assert(worker.backPhoto?.providerFileId === 'drive_back_2', 'Back photo matches');
    assert(worker.verdict === 'UNSAFE', 'Worker verdict is UNSAFE');
    assert(worker.reasons.length === 1, 'Worker has recorded unsafe reason');
  });

  // =========================================================================
  // 4. Draft Lifecycle & Guard Enforcement
  // =========================================================================
  console.log('\n• Suite 4: Draft Management & Deletion Safety');

  await test('saveDraftSubmission creates a new draft or updates an existing draft', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    // 1. Create new draft
    const createRes = await saveDraftSubmission({
      vendorProfileId: 1,
      submittedBy: 10,
      siteName: 'New Substation 4',
      metadata: { workerCount: 2 },
    });
    assert(createRes.success === true, 'Draft created successfully');
    assert(typeof createRes.submissionId === 'number', 'Created submission has numeric ID');

    // 2. Update existing draft
    const updateRes = await saveDraftSubmission(
      {
        vendorProfileId: 1,
        submittedBy: 10,
        siteName: 'Updated Substation 4 Name',
      },
      createRes.submissionId
    );
    assert(updateRes.success === true, 'Draft updated successfully');

    const updatedSub = submissions.find((s) => s.id === createRes.submissionId);
    assert(updatedSub?.site_name === 'Updated Substation 4 Name', 'Draft site name updated in DB');
  });

  await test('saveDraftSubmission rejects modifying non-draft records (PERMISSION_DENIED)', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    // Submission 1 is already SUBMITTED
    const res = await saveDraftSubmission(
      {
        vendorProfileId: 1,
        submittedBy: 10,
        siteName: 'Illegal Modification',
      },
      1
    );
    assert(res.success === false, 'Cannot edit already submitted record');
    assert(res.error?.includes('already been submitted') === true, 'Error message warns about submission status');
  });

  await test('deleteDraftSubmission deletes draft and cascades cleanup of child worker records', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    // Submission 3 is a DRAFT
    const delRes = await deleteDraftSubmission(3, 10);
    assert(delRes.success === true, 'Draft deleted successfully');
    assert(!submissions.some((s) => s.id === 3), 'Draft removed from submissions');
    assert(!workerInstances.some((w) => w.submission_id === 3), 'Child worker instance cascade deleted');
  });

  await test('deleteDraftSubmission strictly prevents deleting SUBMITTED or REVIEWED records', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    // Submission 1 is SUBMITTED & SAFE
    const delRes = await deleteDraftSubmission(1, 10);
    assert(delRes.success === false, 'Deletion of submitted record blocked');
    assert(
      delRes.error?.includes('Only draft submissions can be deleted') === true,
      'Error message clarifies deletion guard'
    );
    assert(submissions.some((s) => s.id === 1), 'Record remains untouched in DB');
  });

  // =========================================================================
  // 5. Draft Submission & Pair Validation
  // =========================================================================
  console.log('\n• Suite 5: Submission Finalization & Pair Validation');

  await test('submitDraftForReview validates that every worker has FRONT and BACK photos', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    // Draft 3 has Worker 13 with ONLY a FRONT photo
    const res = await submitDraftForReview(3);
    assert(res.success === false, 'Draft submission rejected due to missing BACK photo');
    assert(res.error?.includes('missing required BACK photo') === true, 'Identifies missing BACK photo');

    // Add required BACK photo to satisfy validation
    ppeImages.push({
      id: ++nextPPEImageId,
      worker_instance_id: 13,
      file_id: 26,
      side: 'BACK',
      created_at: new Date().toISOString(),
    });

    const resAfterBack = await submitDraftForReview(3);
    assert(resAfterBack.success === true, 'Submission succeeds once paired');
    const sub3 = submissions.find((s) => s.id === 3);
    assert(sub3?.status === 'SUBMITTED', 'Status updated to SUBMITTED');
    assert(sub3?.submitted_at !== null, 'Submitted timestamp recorded');
  });

  // =========================================================================
  // 6. Unsafe Evidence Resubmission
  // =========================================================================
  console.log('\n• Suite 6: Corrected Evidence Resubmission');

  await test('resubmitUnsafeWorker replaces photo reference and resets status to SUBMITTED', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    // Mock replacePPEImage
    const replaceTracker = { called: false };
    setVendorSubmissionsReplaceImageMock(async (params: any) => {
      replaceTracker.called = true;
      assert(params.workerInstanceId === 12, 'Correct worker instance targeted');
      assert(params.side === 'FRONT', 'Correct side targeted');
      return {
        id: 99,
        workerInstanceId: params.workerInstanceId,
        fileId: 999,
        side: params.side,
        createdAt: new Date().toISOString(),
      } as any;
    });

    // Worker 12 in submission 2 was marked UNSAFE
    const res = await resubmitUnsafeWorker(2, 12, 'FRONT', 'file:///cache/corrected_helmet.jpg');
    assert(res.success === true, 'Resubmission successful');
    assert(replaceTracker.called === true, 'Replacement engine executed');

    const sub2 = submissions.find((s) => s.id === 2);
    assert(sub2?.status === 'SUBMITTED', 'Submission transitioned to SUBMITTED for re-review');

    // Reset mock
    setVendorSubmissionsReplaceImageMock(null);
  });

  await test('resubmitUnsafeWorker reports a failed submission status transition', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());
    setVendorSubmissionsReplaceImageMock(async (params: any) => ({
      id: 109,
      workerInstanceId: params.workerInstanceId,
      fileId: 1009,
      side: params.side,
      createdAt: new Date().toISOString(),
    }) as any);
    failSubmissionStatusUpdate = true;

    const result = await resubmitUnsafeWorker(2, 12, 'FRONT', 'file:///cache/replacement.jpg');
    assert(result.success === false, 'A photo replacement alone is not reported as a successful resubmission');
    assert(Boolean(result.error?.includes('forced status update failure')), 'Status update failure is returned to the caller');
    setVendorSubmissionsReplaceImageMock(null);
    failSubmissionStatusUpdate = false;
  });

  // =========================================================================
  // 7. Vendor Team Management & Security Constraints
  // =========================================================================
  console.log('\n• Suite 7: Vendor Team Management & Security Constraints');

  await test('getVendorTeamMembers lists all team members belonging to vendor', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    const members = await getVendorTeamMembers(1);
    assert(members.length === 3, `Expected 3 team members, got ${members.length}`);
    assert(members.some((m) => m.name === 'Tariq PM'), 'Tariq PM present');
    assert(members.some((m) => m.name === 'Kabir Lead'), 'Kabir Lead present');
    assert(members.some((m) => m.name === 'Hassan Worker'), 'Hassan Worker present');
  });

  await test('addVendorTeamMember rejects missing required name and phone', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    const noName = await addVendorTeamMember(1, {
      name: '',
      phone: '+8801711111111',
      email: 'salim@example.com',
      externalType: 'WORKER',
    });
    assert(noName.success === false, 'Empty name rejected');
    assert(noName.error?.includes('Name is required') === true, 'Error message indicates name required');

    const noPhone = await addVendorTeamMember(1, {
      name: 'Salim',
      phone: '',
      email: 'salim@example.com',
      externalType: 'WORKER',
    });
    assert(noPhone.success === false, 'Empty phone rejected');
    assert(noPhone.error?.includes('Phone number is required') === true, 'Error message indicates phone required');
    const noEmail = await addVendorTeamMember(1, { name: 'Salim', phone: '+8801711111111', email: '', externalType: 'WORKER' });
    assert(noEmail.success === false && noEmail.error?.includes('valid sign-in email') === true, 'A sign-in email is required');
  });

  await test('addVendorTeamMember blocks unauthorized creation of internal accounts', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    const res = await addVendorTeamMember(1, {
      name: 'Hacker',
      phone: '+8801799999999',
      email: 'hacker@example.com',
      externalType: 'INTERNAL_ADMIN' as any,
    });
    assert(res.success === false, 'Creation of internal account strictly blocked');
    assert(
      res.error?.includes('can only register Team Leaders or Workers') === true,
      'Error explains vendor role restriction'
    );
  });

  await test('addVendorTeamMember creates external user and prevents duplicate vendor membership', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    // 1. Add new worker
    const addRes = await addVendorTeamMember(1, {
      name: 'Rahim Rigger',
      phone: '+8801755555555',
      email: 'rahim.rigger@example.com',
      externalType: 'WORKER',
      designation: 'Certified Tower Climber',
    });
    assert(addRes.success === true, 'New worker added successfully');
    assert(typeof addRes.memberId === 'number', 'Member ID assigned');

    const memberList = await getVendorTeamMembers(1);
    assert(memberList.length === 4, 'Team members increased to 4');
    assert(memberList.some((m) => m.phone === '+8801755555555'), 'New worker present in member list');

    // 2. Attempt duplicate addition of same user to same vendor
    const dupRes = await addVendorTeamMember(1, {
      name: 'Rahim Rigger',
      phone: '+8801755555555',
      email: 'rahim.rigger@example.com',
      externalType: 'WORKER',
    });
    assert(dupRes.success === false, 'Duplicate addition rejected');
    assert(dupRes.error?.includes('already a member') === true, 'Error informs of existing membership');
  });

  await test('removeVendorTeamMember safely removes membership link', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    const removeRes = await removeVendorTeamMember(1, 12);
    assert(removeRes.success === true, 'Removal successful');

    const memberList = await getVendorTeamMembers(1);
    assert(!memberList.some((m) => m.userId === 12), 'User 12 removed from vendor team');
  });

  console.log('\n• Suite 8: Confirmed Bug Regression Tests');

  await test('Regression (BUG-SEC-01): addVendorTeamMember blocks linking internal EHS Reviewers to vendor teams', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    // Attempt to link internal reviewer Mahmud (+8801700000099) into Vendor 1 team
    const res = await addVendorTeamMember(1, {
      name: 'Mahmud Reviewer',
      phone: '+8801700000099',
      email: 'mahmud@internal.com',
      externalType: 'WORKER',
    });

    assert(res.success === false, 'Internal staff attachment must be blocked');
    assert(
      res.error?.includes('Internal staff (EHS Reviewers / Admins) cannot be added') === true,
      `Blocked with clear security error: ${res.error}`
    );
  });

  await test('Regression (BUG-TEAM-01): removeVendorTeamMember isolates vendor organizations and respects profileId', async () => {
    resetState();
    setVendorTeamSupabaseOverride(createMockSupabase());

    // Verify user 12 is in vendor 1
    const beforeList = await getVendorTeamMembers(1);
    assert(beforeList.some((m) => m.userId === 12), 'User 12 initially present in vendor 1');

    // Attempt removal with wrong vendorProfileId 999
    const wrongVendorRes = await removeVendorTeamMember(999, 12);
    assert(wrongVendorRes.success === true, 'Call completes');

    // User 12 must still be present in vendor 1 because vendorProfileId 999 did not match
    const afterWrongList = await getVendorTeamMembers(1);
    assert(afterWrongList.some((m) => m.userId === 12), 'User 12 preserved when vendorProfileId does not match');

    // Now remove with correct vendorProfileId 1
    const correctRes = await removeVendorTeamMember(1, 12);
    assert(correctRes.success === true, 'Removal with correct profileId succeeds');

    const finalList = await getVendorTeamMembers(1);
    assert(!finalList.some((m) => m.userId === 12), 'User 12 successfully removed from vendor 1');
  });

  await test('Regression (BUG-SUB-02): resubmitUnsafeWorker transitions submission status to SUBMITTED', async () => {
    resetState();
    setVendorSubmissionsSupabaseOverride(createMockSupabase());

    const tracker = { called: false };
    setVendorSubmissionsReplaceImageMock(async (params: any) => {
      tracker.called = true;
      assert(params.workerInstanceId === 12, 'Targeted worker instance ID is passed');
      assert(params.side === 'FRONT', 'Front side is passed');
      return {
        id: 101,
        workerInstanceId: params.workerInstanceId,
        fileId: 1001,
        side: params.side,
        createdAt: new Date().toISOString(),
      } as any;
    });

    // Submission 2 is initially UNSAFE
    const res = await resubmitUnsafeWorker(2, 12, 'FRONT', 'file:///cache/corrected_front.jpg');
    assert(res.success === true, 'Resubmission succeeds');
    assert(tracker.called === true, 'Replace active image mock was called');

    const details = await getVendorSubmissionDetails(2);
    assert(details?.status === 'SUBMITTED', 'Submission transitioned back to SUBMITTED for reviewer re-evaluation');
  });


  // Summary
  console.log('\n========================================');
  console.log(`Vendor Test Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  return { passed, failed, total: passed + failed };
}

// Auto-run if executed directly
if ((require as any).main === module) {
  runVendorTests().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}
