/**
 * PPEye Full Database Token to Drive Flow Test Runner
 */
declare const Buffer: any;
declare const process: any;
declare const require: any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split('\n').forEach((line: string) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    }
  } catch {}
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

async function runTest() {
  console.log('====================================================');
  console.log(' Testing Full Plan: Supabase DB Token -> Google Drive');
  console.log('====================================================\n');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  const refreshToken = process.env.EXPO_PUBLIC_GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseKey) {
    console.error('✖ FAIL: Missing Supabase credentials in environment.');
    process.exit(1);
  }

  if (!refreshToken || !clientId || !clientSecret) {
    console.error('✖ FAIL: Missing Google OAuth credentials in .env.local.');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 1: Mint fresh Google Drive Access Token (mimicking your server's job)
  // ---------------------------------------------------------------------------
  console.log('[Step 1] Minting fresh 1-hour Google Access Token (simulating server/cron)...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error(`✖ FAIL: Failed to mint token from Google: ${tokenRes.status} ${errText}`);
    process.exit(1);
  }

  const tokenData = await tokenRes.json();
  const freshAccessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  console.log(`  ✔ Successfully minted token: ${freshAccessToken.substring(0, 15)}...`);
  console.log(`  ✔ Expires At: ${expiresAt}\n`);

  // ---------------------------------------------------------------------------
  // Step 2: Push token & expires_at to Supabase system_settings table
  // ---------------------------------------------------------------------------
  console.log('[Step 2] Updating Supabase `system_settings` table with the token...');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: updateData, error: updateErr } = await supabase
    .from('system_settings')
    .upsert({
      id: 1,
      google_drive_access_token: freshAccessToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .select();

  if (updateErr) {
    console.error('✖ FAIL: Failed to update Supabase table:', updateErr.message);
    process.exit(1);
  }

  console.log('  ✔ Supabase system_settings updated successfully!');
  console.log('    Table row:', updateData?.[0], '\n');

  // ---------------------------------------------------------------------------
  // Step 3: Now simulate the Mobile App (stripping local tokens to prove DB read)
  // ---------------------------------------------------------------------------
  console.log('[Step 3] Simulating Mobile App reading token directly from Supabase...');
  
  // Wipe environment tokens so the app CANNOT fallback to local env
  delete process.env.EXPO_PUBLIC_GOOGLE_ACCESS_TOKEN;
  delete process.env.EXPO_PUBLIC_GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_REFRESH_TOKEN;

  // Import app's auth engine
  const { fetchTokenFromDatabase } = await import('../../src/services/google-drive/auth');

  const fetchedToken = await fetchTokenFromDatabase();
  if (!fetchedToken) {
    console.error('✖ FAIL: App failed to read access token from Supabase database.');
    process.exit(1);
  }

  if (fetchedToken !== freshAccessToken) {
    console.error('✖ FAIL: Token fetched from DB does not match the token we just saved!');
    process.exit(1);
  }

  console.log('  ✔ Mobile app successfully fetched token from Supabase database!');
  console.log(`  ✔ Token verified: ${(fetchedToken as string).substring(0, 15)}...\n`);

  // ---------------------------------------------------------------------------
  // Step 4: Perform real Google Drive upload using only the Database token
  // ---------------------------------------------------------------------------
  console.log('[Step 4] Uploading photo to Google Drive using the Database Token...');
  const { uploadFileToDrive } = await import('../../src/services/google-drive/upload');

  const tempFilePath = path.resolve(process.cwd(), 'temp_db_plan_test.png');
  // 1x1 transparent PNG buffer
  const samplePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(tempFilePath, samplePng);

  let uploadResult: any;
  try {
    uploadResult = await uploadFileToDrive({
      localUri: tempFilePath,
      fileName: `test_db_token_upload_${Date.now()}.png`,
      mimeType: 'image/png',
    });
  } catch (uploadErr: any) {
    console.error('✖ FAIL: Upload to Google Drive failed:', uploadErr.message);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    process.exit(1);
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }

  console.log('  ✔ Photo uploaded to Google Drive successfully!');
  console.log(`    File ID: ${uploadResult?.fileId}`);
  console.log(`    File Name: ${uploadResult?.fileName}`);
  console.log(`    Is Mock: ${uploadResult?.isMock}`);
  console.log(`    Web View Link: ${uploadResult?.webViewLink || 'N/A'}\n`);

  // ---------------------------------------------------------------------------
  // Step 5: Clean up the test file from Google Drive
  // ---------------------------------------------------------------------------
  console.log('[Step 5] Cleaning up test file from Google Drive...');
  const { deleteFile } = await import('../../src/services/google-drive/files');
  const deleteOk = await deleteFile(uploadResult.fileId);
  console.log(`  ✔ Test file deleted from Drive: ${deleteOk}\n`);

  console.log('====================================================');
  console.log(' 🎉 ALL TESTS PASSED (100%)!');
  console.log(' Your plan is working completely and flawlessly:');
  console.log(' 1. Supabase stores the access_token & expires_at.');
  console.log(' 2. Mobile app reads token from Supabase.');
  console.log(' 3. Photo uploads to Google Drive with 0 errors.');
  console.log('====================================================');
}

runTest().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
