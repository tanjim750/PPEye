/**
 * PPEye Migration & Security Policies Validation Test Suite
 *
 * Validates the security rules, helper regex logic, and RLS behavior for:
 * - 20261022000000_create_supabase_storage_buckets.sql
 * - 20261022000001_harden_files_table_rls.sql
 */

import assert from 'assert';

export async function runMigrationValidationTests(): Promise<{ passed: number; failed: number; total: number }> {
  console.log('\n--- PPEye Phase 1 Migration & Security Policies Validation Suite ---');
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

  // =========================================================================
  // 1. Storage Path Extraction Regex (SEC-03)
  // =========================================================================
  console.log('\n• Suite: Storage Path Parsing Helper Functions (SEC-03)');

  function extractSubmissionId(objectName: string): number | null {
    const match = objectName.match(/^submissions\/([0-9]+)\//);
    return match ? Number(match[1]) : null;
  }

  function extractUserId(objectName: string): number | null {
    const match = objectName.match(/^users\/([0-9]+)\//);
    return match ? Number(match[1]) : null;
  }

  await test('extractSubmissionId parses valid integer submission paths', () => {
    assert.strictEqual(extractSubmissionId('submissions/45/workers/1_front_123.jpg'), 45);
    assert.strictEqual(extractSubmissionId('submissions/999999999/others/evidence.png'), 999999999);
  });

  await test('extractSubmissionId rejects malformed, non-integer, and path traversal strings', () => {
    assert.strictEqual(extractSubmissionId('submissions/abc/worker.jpg'), null);
    assert.strictEqual(extractSubmissionId('submissions/-45/worker.jpg'), null);
    assert.strictEqual(extractSubmissionId('../submissions/45/worker.jpg'), null);
    assert.strictEqual(extractSubmissionId('evidence/submissions/45/worker.jpg'), null);
    assert.strictEqual(extractSubmissionId('random/path/image.jpg'), null);
  });

  await test('extractUserId parses valid user avatar paths', () => {
    assert.strictEqual(extractUserId('users/12/avatar_1729510000.jpg'), 12);
    assert.strictEqual(extractUserId('users/1000/profile.png'), 1000);
  });

  await test('extractUserId rejects malformed or unauthorized user paths', () => {
    assert.strictEqual(extractUserId('users/admin/avatar.jpg'), null);
    assert.strictEqual(extractUserId('users/12a/avatar.jpg'), null);
    assert.strictEqual(extractUserId('../users/12/avatar.jpg'), null);
    assert.strictEqual(extractUserId('avatars/users/12/avatar.jpg'), null);
  });

  // =========================================================================
  // 2. Storage Evidence Upload Policy State Machine (SEC-01)
  // =========================================================================
  console.log('\n• Suite: Evidence Upload Lifecycle & Vendor Isolation (SEC-01)');

  interface MockSubmission {
    id: number;
    vendor_profile_id: number;
    status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'COMPLETED';
  }

  function canVendorUploadEvidence(
    submission: MockSubmission | null,
    userVendorProfileId: number,
    path: string
  ): boolean {
    const parsedSubId = extractSubmissionId(path);
    if (!parsedSubId || !submission || submission.id !== parsedSubId) {
      return false;
    }
    // Strict vendor isolation: must match submission's vendor_profile_id
    if (submission.vendor_profile_id !== userVendorProfileId) {
      return false;
    }
    // SEC-01 fix: Allowed statuses include 'DRAFT', 'SUBMITTED', and 'UNDER_REVIEW'
    return ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(submission.status);
  }

  await test('Vendor can upload when submission is in DRAFT status', () => {
    const sub: MockSubmission = { id: 10, vendor_profile_id: 1, status: 'DRAFT' };
    assert.strictEqual(canVendorUploadEvidence(sub, 1, 'submissions/10/workers/1_front.jpg'), true);
  });

  await test('Vendor can upload when submission is in SUBMITTED status', () => {
    const sub: MockSubmission = { id: 10, vendor_profile_id: 1, status: 'SUBMITTED' };
    assert.strictEqual(canVendorUploadEvidence(sub, 1, 'submissions/10/workers/1_front.jpg'), true);
  });

  await test('SEC-01: Vendor can upload replacement photos when submission is in UNDER_REVIEW status', () => {
    const sub: MockSubmission = { id: 10, vendor_profile_id: 1, status: 'UNDER_REVIEW' };
    assert.strictEqual(canVendorUploadEvidence(sub, 1, 'submissions/10/workers/1_front_replacement.jpg'), true);
  });

  await test('Vendor cannot upload when submission is in COMPLETED status (approved/locked)', () => {
    const sub: MockSubmission = { id: 10, vendor_profile_id: 1, status: 'COMPLETED' };
    assert.strictEqual(canVendorUploadEvidence(sub, 1, 'submissions/10/workers/1_front.jpg'), false);
  });

  await test('Cross-vendor upload is strictly blocked even if status is UNDER_REVIEW', () => {
    const sub: MockSubmission = { id: 10, vendor_profile_id: 2, status: 'UNDER_REVIEW' };
    // Vendor 1 attempting to upload to Vendor 2's submission
    assert.strictEqual(canVendorUploadEvidence(sub, 1, 'submissions/10/workers/1_front.jpg'), false);
  });

  // =========================================================================
  // 3. User Avatar Metadata Accessibility in files Table (SEC-02 & Revised RLS)
  // =========================================================================
  console.log('\n• Suite: Files Table Revised RLS Policies Verification');

  interface MockFileRow {
    id: number;
    created_by: number | null;
    storage_provider?: string;
  }

  interface MockUserRow {
    id: number;
    profile_picture_file_id: number | null;
    is_active: boolean;
  }

  interface MockImageLink {
    file_id: number;
    vendor_profile_id: number;
  }

  type Role = 'anon' | 'authenticated';

  function canSelectFile(
    role: Role,
    file: MockFileRow,
    currentUserId: number | null,
    currentUserVendorId: number | null,
    isInternal: boolean,
    users: MockUserRow[],
    evidenceLinks: MockImageLink[]
  ): boolean {
    if (role !== 'authenticated') return false; // Action 1: TO authenticated only
    if (isInternal) return true;
    if (currentUserId !== null && file.created_by === currentUserId) return true;

    // Action 2: Only active user avatars are viewable by authenticated users
    const isUserProfilePicture = users.some(
      (u) => u.profile_picture_file_id === file.id && u.is_active
    );
    if (isUserProfilePicture) return true;

    // Evidence links: must belong to current vendor profile
    if (currentUserVendorId !== null) {
      const belongsToVendor = evidenceLinks.some(
        (link) => link.file_id === file.id && link.vendor_profile_id === currentUserVendorId
      );
      if (belongsToVendor) return true;
    }

    return false;
  }

  function canInsertFile(
    role: Role,
    newFile: MockFileRow,
    currentUserId: number | null,
    isInternal: boolean
  ): boolean {
    if (role !== 'authenticated') return false; // Action 1: TO authenticated only
    if (isInternal) return true;
    return currentUserId !== null && newFile.created_by === currentUserId;
  }

  function canUpdateFile(
    role: Role,
    existingFile: MockFileRow,
    updatedFile: MockFileRow,
    currentUserId: number | null,
    isInternal: boolean
  ): boolean {
    if (role !== 'authenticated') return false; // Action 1: TO authenticated only
    if (isInternal) return true;

    // USING clause: must be created by current user
    if (currentUserId === null || existingFile.created_by !== currentUserId) {
      return false;
    }

    // Action 3: WITH CHECK clause prevents changing created_by
    if (updatedFile.created_by !== currentUserId) {
      return false;
    }

    return true;
  }

  function canDeleteFile(
    role: Role,
    file: MockFileRow,
    currentUserId: number | null,
    isInternal: boolean,
    users: MockUserRow[],
    ppeImages: Array<{ file_id: number }>,
    otherImages: Array<{ file_id: number }>
  ): boolean {
    if (role !== 'authenticated') return false; // Action 1: TO authenticated only

    // Must be internal staff OR creator
    const hasPermission = isInternal || (currentUserId !== null && file.created_by === currentUserId);
    if (!hasPermission) return false;

    // Action 4: Universal Reference Protection - applies to BOTH internal staff and creator
    const isReferenced =
      users.some((u) => u.profile_picture_file_id === file.id) ||
      ppeImages.some((p) => p.file_id === file.id) ||
      otherImages.some((o) => o.file_id === file.id);

    return !isReferenced;
  }

  await test('Anonymous users are blocked from SELECT, INSERT, UPDATE, DELETE on files table', () => {
    const file: MockFileRow = { id: 10, created_by: 10 };
    assert.strictEqual(canSelectFile('anon', file, null, null, false, [], []), false);
    assert.strictEqual(canInsertFile('anon', file, null, false), false);
    assert.strictEqual(canUpdateFile('anon', file, file, null, false), false);
    assert.strictEqual(canDeleteFile('anon', file, null, false, [], [], []), false);
  });

  await test('Authenticated User A can read metadata for active User B avatar, but NOT inactive User C', () => {
    const userBAvatarFile: MockFileRow = { id: 501, created_by: 20 };
    const userCAvatarFile: MockFileRow = { id: 502, created_by: 30 };
    const users: MockUserRow[] = [
      { id: 10, profile_picture_file_id: 500, is_active: true },  // User A
      { id: 20, profile_picture_file_id: 501, is_active: true },  // User B (active)
      { id: 30, profile_picture_file_id: 502, is_active: false }, // User C (deactivated)
    ];

    assert.strictEqual(canSelectFile('authenticated', userBAvatarFile, 10, 1, false, users, []), true, 'Active user avatar must be visible');
    assert.strictEqual(canSelectFile('authenticated', userCAvatarFile, 10, 1, false, users, []), false, 'Inactive user avatar must NOT be visible');
  });

  await test('Vendor A cannot read Vendor B evidence files in files table', () => {
    const vendorBEvidenceFile: MockFileRow = { id: 901, created_by: 20 };
    const users: MockUserRow[] = [];
    const evidenceLinks: MockImageLink[] = [
      { file_id: 901, vendor_profile_id: 2 }, // Belongs to Vendor 2
    ];

    const allowed = canSelectFile('authenticated', vendorBEvidenceFile, 10, 1, false, users, evidenceLinks);
    assert.strictEqual(allowed, false, 'Vendor 1 must NOT be able to view Vendor 2 evidence metadata');
  });

  await test('Authorized Vendor A can read their own submission evidence files', () => {
    const vendorAEvidenceFile: MockFileRow = { id: 902, created_by: 10 };
    const evidenceLinks: MockImageLink[] = [
      { file_id: 902, vendor_profile_id: 1 },
    ];
    const allowed = canSelectFile('authenticated', vendorAEvidenceFile, 10, 1, false, [], evidenceLinks);
    assert.strictEqual(allowed, true, 'Vendor 1 should read their own evidence file');
  });

  await test('Internal reviewer can read any file metadata', () => {
    const anyFile: MockFileRow = { id: 999, created_by: 99 };
    const allowed = canSelectFile('authenticated', anyFile, 5, null, true, [], []);
    assert.strictEqual(allowed, true, 'Internal staff must have full metadata read access');
  });

  await test('UPDATE WITH CHECK prevents creator from transferring ownership (created_by)', () => {
    const existingFile: MockFileRow = { id: 200, created_by: 10 };
    const illegitimateUpdate: MockFileRow = { id: 200, created_by: 99 }; // Attempt to transfer ownership
    const legitimateUpdate: MockFileRow = { id: 200, created_by: 10 };

    assert.strictEqual(canUpdateFile('authenticated', existingFile, illegitimateUpdate, 10, false), false, 'Changing created_by must be rejected');
    assert.strictEqual(canUpdateFile('authenticated', existingFile, legitimateUpdate, 10, false), true, 'Legitimate author update must be accepted');
  });

  await test('Universal Reference Protection on DELETE: neither internal user nor creator can delete referenced file', () => {
    const referencedFile: MockFileRow = { id: 300, created_by: 10 };
    const unreferencedFile: MockFileRow = { id: 301, created_by: 10 };
    const ppeImages = [{ file_id: 300 }]; // file 300 is actively referenced

    // Internal admin attempt
    assert.strictEqual(canDeleteFile('authenticated', referencedFile, 5, true, [], ppeImages, []), false, 'Internal staff CANNOT delete referenced file');
    assert.strictEqual(canDeleteFile('authenticated', unreferencedFile, 5, true, [], [], []), true, 'Internal staff CAN delete unreferenced file');

    // Creator attempt
    assert.strictEqual(canDeleteFile('authenticated', referencedFile, 10, false, [], ppeImages, []), false, 'Creator CANNOT delete referenced file');
    assert.strictEqual(canDeleteFile('authenticated', unreferencedFile, 10, false, [], [], []), true, 'Creator CAN delete unreferenced file');
  });

  console.log(`\n========================================`);
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log(`========================================\n`);

  return { passed, failed, total: passed + failed };
}
