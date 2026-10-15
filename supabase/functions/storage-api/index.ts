// ==============================================================================
// Supabase Edge Function: storage-api
// Secure, Server-Mediated Google Drive Storage Proxy for PPEye
//
// Enforces:
// 1. Supabase JWT Authentication & User Identity Resolution.
// 2. Role-Based Access Control (Internal EHS Reviewer vs External Team Leader).
// 3. Submission Ownership via vendor_members and submitted_by.
// 4. Atomic File-to-Record Association (files, ppe_images, other_images, users).
// 5. Zero Public Access: Private Evidence Streaming directly from Google Drive.
// 6. Complete Secret Isolation: Google credentials never leave this server.
// ==============================================================================

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

let cachedDriveToken: string | null = null;
let tokenExpiryTimestamp = 0;

/**
 * Obtains a short-lived Google Drive REST API access token using server secrets.
 */
async function getServerDriveAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedDriveToken && now < tokenExpiryTimestamp - 60000) {
    return cachedDriveToken;
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive server credentials missing in environment.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to refresh Google Drive access token: ${res.status} ${errText}`);
  }

  const data: TokenResponse = await res.json();
  cachedDriveToken = data.access_token;
  tokenExpiryTimestamp = now + data.expires_in * 1000;
  return cachedDriveToken;
}

/**
 * Queries Supabase REST API securely using the service role key or user JWT.
 */
async function querySupabase(path: string, options: RequestInit = {}): Promise<any> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

  const headers = new Headers(options.headers || {});
  headers.set('apikey', serviceKey);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${serviceKey}`);
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase query failed [${res.status}]: ${errText}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Validates Supabase JWT and returns user details.
 */
async function authenticateUser(req: Request): Promise<{ id: number; email: string; category: string; designation?: string }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header.');
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });

  if (!userRes.ok) {
    throw new Error('Invalid or expired Supabase authentication token.');
  }

  const authUser = await userRes.json();
  const email = authUser.email;
  const phone = authUser.phone;

  // Resolve internal database user profile
  let query = 'users?select=*';
  if (email) {
    query += `&email=eq.${encodeURIComponent(email)}`;
  } else if (phone) {
    query += `&phone=eq.${encodeURIComponent(phone)}`;
  } else {
    query += `&id=eq.${encodeURIComponent(authUser.id)}`;
  }

  const users = await querySupabase(query);
  if (!users || users.length === 0) {
    throw new Error(`User profile not found for authenticated identity ${email || phone || authUser.id}.`);
  }

  return users[0];
}

/**
 * Validates that an external user has ownership / access to a submission.
 */
async function verifySubmissionAccess(user: { id: number; category: string }, submissionId: number): Promise<any> {
  const subs = await querySupabase(`ppe_submissions?select=*&id=eq.${submissionId}`);
  if (!subs || subs.length === 0) {
    throw new Error(`Submission #${submissionId} not found.`);
  }

  const submission = subs[0];

  // Internal EHS Reviewers have global access to all vendor submissions
  if (user.category === 'INTERNAL') {
    return submission;
  }

  // External Team Leaders must either be the direct submitter or belong to the vendor profile
  if (submission.submitted_by === user.id) {
    return submission;
  }

  const members = await querySupabase(
    `vendor_members?select=id&vendor_profile_id=eq.${submission.vendor_profile_id}&user_id=eq.${user.id}`
  );

  if (!members || members.length === 0) {
    throw new Error(`Access Denied: User #${user.id} is not an authorized member of vendor profile #${submission.vendor_profile_id}.`);
  }

  return submission;
}

/**
 * Main HTTP Handler for Supabase Edge Function
 */
export default async function handler(req: Request): Promise<Response> {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'upload';

  try {
    // 2. Authenticate caller
    const user = await authenticateUser(req);

    // -------------------------------------------------------------------------
    // ACTION: upload
    // -------------------------------------------------------------------------
    if (action === 'upload' && req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';
      let fileBytes: Uint8Array;
      let fileName = 'upload.jpg';
      let mimeType = 'image/jpeg';
      let category = 'PPE';
      let submissionId: number | undefined;
      let workerInstanceId: number | undefined;
      let side: 'FRONT' | 'BACK' | undefined;
      let sequenceNo: number | undefined;

      if (contentType.includes('multipart/form-data')) {
        const formData: any = await req.formData();
        const fileEntry = formData.get('file');
        if (!fileEntry || typeof fileEntry === 'string') {
          return new Response(JSON.stringify({ error: 'Missing file binary in form-data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const fileBlob = fileEntry as Blob;
        fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
        fileName = (fileEntry as any).name || 'photo.jpg';
        mimeType = fileBlob.type || 'image/jpeg';

        category = (formData.get('category') as string) || 'PPE';
        if (formData.has('submissionId')) submissionId = parseInt(formData.get('submissionId') as string, 10);
        if (formData.has('workerInstanceId')) workerInstanceId = parseInt(formData.get('workerInstanceId') as string, 10);
        if (formData.has('side')) side = formData.get('side') as any;
        if (formData.has('sequenceNo')) sequenceNo = parseInt(formData.get('sequenceNo') as string, 10);
      } else {
        const body = await req.json();
        const base64Content = body.fileBase64;
        if (!base64Content) {
          return new Response(JSON.stringify({ error: 'Missing fileBase64 in request body' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const binaryStr = atob(base64Content);
        fileBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          fileBytes[i] = binaryStr.charCodeAt(i);
        }
        fileName = body.fileName || 'photo.jpg';
        mimeType = body.mimeType || 'image/jpeg';
        category = body.category || 'PPE';
        submissionId = body.submissionId;
        workerInstanceId = body.workerInstanceId;
        side = body.side;
        sequenceNo = body.sequenceNo;
      }

      // Check max size: 10 MB
      if (fileBytes.length > 10 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'File size exceeds 10MB limit.' }), {
          status: 413,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Validate submission ownership & parameters
      if (category === 'PPE') {
        if (!submissionId || !workerInstanceId || !side) {
          return new Response(JSON.stringify({ error: 'PPE upload requires submissionId, workerInstanceId, and side.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        await verifySubmissionAccess(user, submissionId);
      } else if (category === 'OTHERS') {
        if (!submissionId) {
          return new Response(JSON.stringify({ error: 'Others upload requires submissionId.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        await verifySubmissionAccess(user, submissionId);
      }

      // Server-side Google Drive upload
      const driveToken = await getServerDriveAccessToken();
      const targetFolderId = Deno.env.get('GOOGLE_DRIVE_TARGET_FOLDER_ID') || Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID');

      const metadata: Record<string, any> = {
        name: fileName,
        mimeType,
      };
      if (targetFolderId) {
        metadata.parents = [targetFolderId];
      }

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const metadataPart = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${mimeType}\r\n\r\n`;

      const metadataBytes = new TextEncoder().encode(metadataPart);
      const closeBytes = new TextEncoder().encode(closeDelim);

      const combinedBody = new Uint8Array(metadataBytes.length + fileBytes.length + closeBytes.length);
      combinedBody.set(metadataBytes, 0);
      combinedBody.set(fileBytes, metadataBytes.length);
      combinedBody.set(closeBytes, metadataBytes.length + fileBytes.length);

      const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: combinedBody,
      });

      if (!driveRes.ok) {
        const driveErr = await driveRes.text();
        throw new Error(`Google Drive upload failed [${driveRes.status}]: ${driveErr}`);
      }

      const driveData = await driveRes.json();
      const driveFileId = driveData.id;

      // Atomic persistence in files table
      const fileInsert = await querySupabase('files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          storage_provider: 'GOOGLE_DRIVE',
          provider_file_id: driveFileId,
          file_name: fileName,
          mime_type: mimeType,
          size_bytes: fileBytes.length,
          created_by: user.id,
        }),
      });

      const fileRecord = fileInsert[0];

      // Atomic junction record insertion
      if (category === 'PPE' && workerInstanceId && side) {
        await querySupabase('ppe_images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            worker_instance_id: workerInstanceId,
            file_id: fileRecord.id,
            side,
          }),
        });
      } else if (category === 'OTHERS' && submissionId) {
        await querySupabase('other_images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submission_id: submissionId,
            file_id: fileRecord.id,
            sequence_no: sequenceNo ?? 1,
          }),
        });
      } else if (category === 'PROFILE_PICTURE') {
        await querySupabase(`users?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_picture_file_id: fileRecord.id }),
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          file: fileRecord,
          driveFileId,
        }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // -------------------------------------------------------------------------
    // ACTION: download / stream (Zero public exposure)
    // -------------------------------------------------------------------------
    if (action === 'download' && req.method === 'GET') {
      const fileIdParam = url.searchParams.get('fileId');
      if (!fileIdParam) {
        return new Response(JSON.stringify({ error: 'Missing fileId parameter.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Lookup file record
      let fileRows: any[];
      if (/^\d+$/.test(fileIdParam)) {
        fileRows = await querySupabase(`files?select=*&id=eq.${fileIdParam}`);
      } else {
        fileRows = await querySupabase(`files?select=*&provider_file_id=eq.${encodeURIComponent(fileIdParam)}`);
      }

      if (!fileRows || fileRows.length === 0) {
        return new Response(JSON.stringify({ error: 'File not found.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const fileRec = fileRows[0];

      // Authorization verification for download
      if (user.category !== 'INTERNAL') {
        // External user: must be linked to user's vendor submissions or user's own profile picture
        const isOwnAvatar = fileRec.id === (user as any).profile_picture_file_id;
        if (!isOwnAvatar) {
          // Check ppe_images
          const ppeLinks = await querySupabase(
            `ppe_images?select=worker_instance_id,ppe_worker_instances!inner(submission_id)&file_id=eq.${fileRec.id}`
          );
          let authorized = false;

          for (const link of ppeLinks || []) {
            try {
              const subId = link.ppe_worker_instances?.submission_id;
              if (subId) {
                await verifySubmissionAccess(user, subId);
                authorized = true;
                break;
              }
            } catch {}
          }

          if (!authorized) {
            // Check other_images
            const otherLinks = await querySupabase(`other_images?select=submission_id&file_id=eq.${fileRec.id}`);
            for (const link of otherLinks || []) {
              try {
                if (link.submission_id) {
                  await verifySubmissionAccess(user, link.submission_id);
                  authorized = true;
                  break;
                }
              } catch {}
            }
          }

          if (!authorized) {
            return new Response(JSON.stringify({ error: 'Access Denied: You do not have permission to view this evidence.' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // Stream file directly from Google Drive API to authenticated client
      const driveToken = await getServerDriveAccessToken();
      const driveStreamRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileRec.provider_file_id}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${driveToken}`,
          },
        }
      );

      if (!driveStreamRes.ok) {
        const streamErr = await driveStreamRes.text();
        throw new Error(`Google Drive download stream failed [${driveStreamRes.status}]: ${streamErr}`);
      }

      return new Response(driveStreamRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': fileRec.mime_type || 'image/jpeg',
          'Content-Length': fileRec.size_bytes ? fileRec.size_bytes.toString() : '',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    return new Response(JSON.stringify({ error: `Unsupported action or method: ${action} ${req.method}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: err?.message || 'Internal Server Error in storage-api',
      }),
      {
        status: err?.message?.includes('Access Denied') ? 403 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}
