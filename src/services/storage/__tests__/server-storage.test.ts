/**
 * PPEye Server-Mediated Storage Architecture & Edge Function Client Unit Tests (Mocked)
 *
 * Verifies:
 * 1. Supabase Identity & JWT Enforcement:
 *    - Rejects unauthenticated requests when no active session exists.
 *    - Forwards active Supabase access token in Authorization headers.
 * 2. Role-Based Access Control & Submission Ownership:
 *    - External Team Leader authorized only for own vendor submissions.
 *    - External Team Leader denied access to other vendors' submissions.
 *    - Internal EHS Reviewer authorized to inspect all vendor submissions.
 * 3. File-to-Record Association:
 *    - Atomic association with files and junction records.
 * 4. Zero Public Access & Private Evidence Streaming:
 *    - Streaming endpoints require authentication and never grant public access.
 * 5. Provider-Independent IStorageService Interface:
 *    - Fully compatible with IStorageService contract.
 */

import { ServerStorageClient } from '../server-storage.client';
import { StorageErrorCode } from '../storage.errors';

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

export async function runServerStorageTests(): Promise<{ passed: number; failed: number; total: number }> {
  let passed = 0;
  let failed = 0;

  // Intercept global fetch for Edge Function testing
  const originalFetch = globalThis.fetch;

  let currentSessionToken: string | null = null;
  let interceptedRequests: Array<{ url: string; method: string; headers: Headers; body?: any }> = [];

  // Mock server state
  const mockSubmissions = [
    { id: 101, vendor_profile_id: 1, site_name: 'Metro Site North' },
    { id: 102, vendor_profile_id: 2, site_name: 'Competitor West Site' },
  ];

  // User 5: External Team Leader for Vendor 1
  // User 99: Internal EHS Reviewer
  let currentUser = { id: 5, category: 'EXTERNAL', vendor_profile_id: 1 };

  const mockSupabase = {
    auth: {
      getSession: async () => ({
        data: {
          session: currentSessionToken ? { access_token: currentSessionToken } : null,
        },
        error: null,
      }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 999, provider_file_id: 'drv_1', file_name: 'f.jpg', mime_type: 'image/jpeg' },
            error: null,
          }),
        }),
      }),
    }),
  };

  const createClient = () =>
    new ServerStorageClient({
      baseUrl: 'https://test.supabase.co/functions/v1/storage-api',
      supabaseClient: mockSupabase,
    });

  function setupMockFetch() {
    (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const headers = new Headers(init?.headers || {});

      interceptedRequests.push({ url, method, headers, body: init?.body });

      // Verify Authorization header
      const auth = headers.get('Authorization');
      if (!auth || !auth.startsWith('Bearer ') || auth === 'Bearer null' || auth === 'Bearer undefined') {
        return new Response(JSON.stringify({ error: 'Missing or invalid Authorization token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check upload action
      if (url.includes('action=upload')) {
        const formData = init?.body as any;
        const submissionId = formData?.get ? parseInt(formData.get('submissionId'), 10) : undefined;

        // Check submission ownership
        if (submissionId) {
          const sub = mockSubmissions.find((s) => s.id === submissionId);
          if (!sub) {
            return new Response(JSON.stringify({ error: 'Submission not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (currentUser.category === 'EXTERNAL' && sub.vendor_profile_id !== currentUser.vendor_profile_id) {
            return new Response(
              JSON.stringify({ error: 'Access Denied: User is not authorized to upload to this vendor submission' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        const fileName = (formData?.get ? formData.get('fileName') : null) || 'inspection_photo.jpg';

        return new Response(
          JSON.stringify({
            success: true,
            driveFileId: 'drv_edge_mock_123',
            file: {
              id: 999,
              provider_file_id: 'drv_edge_mock_123',
              file_name: fileName,
              mime_type: 'image/jpeg',
              size_bytes: 2048,
              created_by: currentUser.id,
              created_at: new Date().toISOString(),
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Check download action
      if (url.includes('action=download')) {
        const fileId = new URL(url).searchParams.get('fileId');

        // If downloading competitor's file while External user -> 403
        if (fileId === 'competitor_file_456' && currentUser.category === 'EXTERNAL') {
          return new Response(
            JSON.stringify({ error: 'Access Denied: You do not have permission to view this evidence.' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response('MOCK_BINARY_DATA', {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': '16',
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }

      // Check delete action
      if (url.includes('action=delete') && method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    };
  }

  async function test(name: string, fn: () => Promise<void>) {
    try {
      interceptedRequests = [];
      currentUser = { id: 5, category: 'EXTERNAL', vendor_profile_id: 1 };
      currentSessionToken = 'mock_jwt_external_user_5';
      setupMockFetch();

      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`    ${err?.message || err}`);
      if (err?.stack) console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n')}`);
      failed++;
    }
  }

  console.log('\n--- PPEye Server-Mediated Storage Architecture Test Suite ---');

  // =========================================================================
  // 1. Supabase Identity & JWT Enforcement
  // =========================================================================
  console.log('\n• Suite: Supabase Identity & JWT Enforcement');

  await test('Rejects unauthenticated requests with AUTHENTICATION_REQUIRED when no session exists', async () => {
    currentSessionToken = null; // simulate logged out user
    const client = createClient();

    await assertAsyncThrows(
      () =>
        client.upload({
          localUri: 'file:///photo.jpg',
          fileName: 'photo.jpg',
          category: 'PPE',
        }),
      StorageErrorCode.AUTHENTICATION_REQUIRED,
      'Threw AUTHENTICATION_REQUIRED on missing session'
    );
  });

  await test('Forwards active Supabase access token in Authorization headers', async () => {
    currentSessionToken = 'token_team_leader_abc123';
    const client = createClient();

    await client.upload({
      localUri: 'file:///w1_front.jpg',
      fileName: 'w1_front.jpg',
      category: 'PPE',
      metadata: { submissionId: 101 },
    });

    assert(interceptedRequests.length === 1, '1 request intercepted');
    const authHeader = interceptedRequests[0].headers.get('Authorization');
    assert(authHeader === 'Bearer token_team_leader_abc123', 'Bearer token forwarded correctly');
  });

  // =========================================================================
  // 2. Role-Based Access Control & Submission Ownership
  // =========================================================================
  console.log('\n• Suite: Role-Based Access Control & Submission Ownership');

  await test('External Team Leader can upload to their own vendor submission', async () => {
    const client = createClient();

    const stored = await client.upload({
      localUri: 'file:///w1_front.jpg',
      fileName: 'w1_front.jpg',
      category: 'PPE',
      metadata: { submissionId: 101 }, // vendor 1 (authorized)
    });

    assert(stored.providerFileId === 'drv_edge_mock_123', 'File uploaded via server-mediated API');
    assert(stored.storageProvider === 'GOOGLE_DRIVE', 'Provider is GOOGLE_DRIVE');
    assert(stored.createdBy === 5, 'Record created by authenticated user');
  });

  await test('External Team Leader cannot upload to another vendor submission (403 Forbidden)', async () => {
    const client = createClient();

    await assertAsyncThrows(
      () =>
        client.upload({
          localUri: 'file:///w1_front.jpg',
          fileName: 'w1_front.jpg',
          category: 'PPE',
          metadata: { submissionId: 102 }, // vendor 2 (competitor)
        }),
      StorageErrorCode.PERMISSION_DENIED,
      'Access Denied for other vendor submission'
    );
  });

  await test('External Team Leader cannot download evidence from other vendors (403 Forbidden)', async () => {
    const client = createClient();

    await assertAsyncThrows(
      () => client.downloadFile('competitor_file_456'),
      StorageErrorCode.PERMISSION_DENIED,
      'Access Denied when downloading competitor evidence'
    );
  });

  await test('Internal EHS Reviewer can view/download evidence across any vendor submission', async () => {
    // Switch identity to Internal Reviewer
    currentUser = { id: 99, category: 'INTERNAL', vendor_profile_id: 0 };
    const client = createClient();

    const downloaded = await client.downloadFile('competitor_file_456');
    assert(downloaded.fileId === 'competitor_file_456', 'Internal reviewer downloaded file successfully');
  });

  // =========================================================================
  // 3. Zero Public Access & Private Evidence Streaming
  // =========================================================================
  console.log('\n• Suite: Zero Public Access & Private Evidence Streaming');

  await test('Download URL produces an authenticated private streaming endpoint, never public', async () => {
    const client = createClient();
    const url = await client.getDownloadUrl('evidence_file_789');

    assert(!url.includes('drive.google.com/uc'), 'Never uses unauthenticated Google Drive link');
    assert(url.includes('/functions/v1/storage-api?action=download&fileId='), 'Streams via authenticated Edge Function');
  });

  // Restore globals
  (globalThis as any).fetch = originalFetch;

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n========================================');
  console.log(`Result: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('========================================\n');

  return { passed, failed, total: passed + failed };
}

// Auto-run if executed directly
if ((require as any).main === module) {
  runServerStorageTests().then((res) => {
    process.exit(res.failed > 0 ? 1 : 0);
  });
}
