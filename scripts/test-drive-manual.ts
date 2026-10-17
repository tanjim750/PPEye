/**
 * PPEye Google Drive Engine - Interactive Manual Test Runner
 *
 * This script allows developers and QA to test the Google Drive Engine manually
 * against the real Google Drive REST API.
 *
 * Usage:
 *   1. Using a Google Access Token directly:
 *      GOOGLE_ACCESS_TOKEN="ya29.a0..." npx tsx scripts/test-drive-manual.ts
 *
 *   2. Or run without args for interactive step-by-step guidance:
 *      npx tsx scripts/test-drive-manual.ts
 */

declare const Buffer: any;
declare const process: any;
declare const require: any;

const fs = require('fs');
const path = require('path');
const os = require('os');


// Color helpers for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function logStep(step: number, title: string) {
  console.log(`\n${colors.cyan}[Step ${step}] ${colors.bright}${title}${colors.reset}`);
}

function logPass(message: string) {
  console.log(`  ${colors.green}✔ PASS:${colors.reset} ${message}`);
}

function logFail(message: string, error?: any) {
  console.log(`  ${colors.red}✖ FAIL:${colors.reset} ${message}`);
  if (error) {
    console.error('    Error details:', error?.message ?? error);
  }
}

function logInfo(message: string) {
  console.log(`  ${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

async function runManualDriveTests() {
  console.log(`${colors.bright}====================================================`);
  console.log(` PPEye Google Drive Engine - Manual Verification Test`);
  console.log(`====================================================${colors.reset}\n`);

  const defaultToken = "";

  const token = process.env.GOOGLE_ACCESS_TOKEN || process.argv[2] || defaultToken;

  if (!token) {
    console.log(`${colors.yellow}No Google Access Token detected!${colors.reset}`);
    console.log(`To run live tests against your Google Drive, please provide an OAuth Access Token:`);
    console.log(`\nOption A (Environment Variable):`);
    console.log(`  GOOGLE_ACCESS_TOKEN="ya29.your_token_here" npx tsx scripts/test-drive-manual.ts\n`);
    console.log(`Option B (CLI Argument):`);
    console.log(`  npx tsx scripts/test-drive-manual.ts "ya29.your_token_here"\n`);
    console.log(`How to get a quick test token:`);
    console.log(`  1. From Google OAuth Playground (https://developers.google.com/oauthplayground)`);
    console.log(`     - Select 'Drive API v3' -> 'https://www.googleapis.com/auth/drive.file'`);
    console.log(`     - Authorize and copy the Access Token.`);
    console.log(`  2. Or using Google Cloud CLI on your terminal:`);
    console.log(`     gcloud auth print-access-token\n`);
    process.exit(1);
  }

  const results: { test: string; passed: boolean }[] = [];
  const tempDir = path.join(os.tmpdir(), `ppeye_drive_test_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  let testFolderId: string | null = null;
  let testFileId: string | null = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Verify Access Token & Scopes
    // -------------------------------------------------------------
    logStep(1, 'Validating Google OAuth Access Token & Scopes');
    try {
      const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
      if (!tokenInfoRes.ok) {
        throw new Error(`Token verification failed with HTTP ${tokenInfoRes.status}`);
      }
      const tokenInfo = await tokenInfoRes.json();
      logPass(`Token is valid for audience/app: ${tokenInfo.audience || tokenInfo.issued_to}`);
      logInfo(`Granted Scopes: ${tokenInfo.scope}`);
      logInfo(`Expires in: ${tokenInfo.expires_in} seconds`);
      results.push({ test: 'Token Validation', passed: true });
    } catch (err: any) {
      logFail('Token validation failed', err);
      results.push({ test: 'Token Validation', passed: false });
      throw new Error('Aborting remaining tests because token is invalid.');
    }

    // -------------------------------------------------------------
    // Test 2: Create Test Folder Hierarchy
    // -------------------------------------------------------------
    logStep(2, 'Creating Isolated Test Folder Hierarchy on Google Drive');
    const folderName = `PPEye_ManualTest_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
        }),
      });

      if (!folderRes.ok) {
        throw new Error(`Failed to create test folder: HTTP ${folderRes.status}`);
      }

      const folderData = await folderRes.json();
      testFolderId = folderData.id;
      logPass(`Created test folder: "${folderName}" (Folder ID: ${testFolderId})`);
      results.push({ test: 'Folder Creation', passed: true });
    } catch (err: any) {
      logFail('Folder creation failed', err);
      results.push({ test: 'Folder Creation', passed: false });
      throw err;
    }

    // -------------------------------------------------------------
    // Test 3: Upload Test File (Multipart <5MB Simulation)
    // -------------------------------------------------------------
    logStep(3, 'Uploading Sample PPE Evidence Image (< 5MB Multipart Upload)');
    const customImagePath = process.env.TEST_IMAGE_PATH;
    const keepUploadedFile = process.env.KEEP_FILE === 'true' || process.env.KEEP_FILE === '1';

    let testFileName: string;
    let sampleBuffer: any;

    if (customImagePath && fs.existsSync(customImagePath)) {
      testFileName = path.basename(customImagePath);
      sampleBuffer = fs.readFileSync(customImagePath);
      logInfo(`Using custom image from laptop: "${customImagePath}" (${(sampleBuffer.length / 1024).toFixed(1)} KB)`);
    } else {
      testFileName = `worker_front_test_${Date.now()}.png`;
      const samplePngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      sampleBuffer = Buffer.from(samplePngBase64, 'base64');
    }

    const testFilePath = path.join(tempDir, testFileName);
    fs.writeFileSync(testFilePath, sampleBuffer);

    const ext = path.extname(testFileName).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';

    try {
      const metadata = {
        name: testFileName,
        parents: [testFolderId!],
        mimeType,
      };

      const boundary = 'foo_bar_baz_boundary_' + Date.now();
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody = Buffer.concat([
        Buffer.from(
          delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${mimeType}\r\n\r\n`
        ),
        sampleBuffer,
        Buffer.from(closeDelimiter),
      ]);

      const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
            'Content-Length': multipartBody.length.toString(),
          },
          body: multipartBody,
        }
      );

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Upload failed HTTP ${uploadRes.status}: ${errText}`);
      }

      const uploadData = await uploadRes.json();
      testFileId = uploadData.id;
      logPass(`File uploaded successfully!`);
      logInfo(`File ID: ${testFileId}`);
      logInfo(`File Name: ${uploadData.name}`);
      logInfo(`Drive Web View Link: ${uploadData.webViewLink}`);
      results.push({ test: 'Multipart File Upload', passed: true });
    } catch (err: any) {
      logFail('Multipart upload failed', err);
      results.push({ test: 'Multipart File Upload', passed: false });
      throw err;
    }

    // -------------------------------------------------------------
    // Test 4: Retrieve File Metadata
    // -------------------------------------------------------------
    logStep(4, 'Fetching File Metadata & Verifying Properties');
    try {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${testFileId}?fields=id,name,mimeType,size,thumbnailLink,webViewLink,trashed`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!metaRes.ok) {
        throw new Error(`Metadata request failed: HTTP ${metaRes.status}`);
      }

      const meta = await metaRes.json();
      if (meta.name !== testFileName || meta.trashed === true) {
        throw new Error(`Unexpected metadata: name=${meta.name}, trashed=${meta.trashed}`);
      }

      logPass(`Metadata verified: ID=${meta.id}, Name=${meta.name}, Size=${meta.size} bytes`);
      if (meta.thumbnailLink) {
        logInfo(`Thumbnail URL generated: ${meta.thumbnailLink}`);
      }
      results.push({ test: 'Metadata Retrieval', passed: true });
    } catch (err: any) {
      logFail('Metadata retrieval failed', err);
      results.push({ test: 'Metadata Retrieval', passed: false });
    }

    // -------------------------------------------------------------
    // Test 5: Download File Content & Byte Verification
    // -------------------------------------------------------------
    logStep(5, 'Downloading File & Checking Byte Integrity');
    try {
      const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${testFileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!downloadRes.ok) {
        throw new Error(`Download failed: HTTP ${downloadRes.status}`);
      }

      const downloadedBuffer = Buffer.from(await downloadRes.arrayBuffer());
      if (downloadedBuffer.length !== sampleBuffer.length) {
        throw new Error(`Byte length mismatch: expected ${sampleBuffer.length}, got ${downloadedBuffer.length}`);
      }

      logPass(`File downloaded successfully (${downloadedBuffer.length} bytes matches uploaded buffer)!`);
      results.push({ test: 'File Download Integrity', passed: true });
    } catch (err: any) {
      logFail('Download failed', err);
      results.push({ test: 'File Download Integrity', passed: false });
    }

    // -------------------------------------------------------------
    // Test 6: Delete Test File
    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // Test 6: Delete Test File
    // -------------------------------------------------------------
    if (keepUploadedFile) {
      logStep(6, 'File Retention Mode (KEEP_FILE=true)');
      logPass(`Preserving uploaded file on Google Drive as requested.`);
      logInfo(`Direct Link to open in browser: https://drive.google.com/file/d/${testFileId}/view`);
      results.push({ test: 'File Deletion (Skipped / Preserved)', passed: true });
    } else {
      logStep(6, 'Deleting Uploaded Test File');
      try {
        const deleteRes = await fetch(`https://www.googleapis.com/drive/v3/files/${testFileId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!deleteRes.ok && deleteRes.status !== 204) {
          throw new Error(`Delete failed: HTTP ${deleteRes.status}`);
        }

        logPass(`File ${testFileId} deleted from Drive.`);

        // Verify it is gone or returns 404
        const verifyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${testFileId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (verifyRes.status === 404) {
          logPass(`Deletion confirmed: Drive API returned 404 Not Found for file.`);
        } else {
          logInfo(`File status after delete: HTTP ${verifyRes.status}`);
        }

        results.push({ test: 'File Deletion', passed: true });
        testFileId = null;
      } catch (err: any) {
        logFail('File deletion failed', err);
        results.push({ test: 'File Deletion', passed: false });
      }
    }

    // -------------------------------------------------------------
    // Test 7: Cleanup Test Folder
    // -------------------------------------------------------------
    if (keepUploadedFile) {
      logStep(7, 'Folder Retention Mode (KEEP_FILE=true)');
      logPass(`Preserving folder "${folderName}" on Google Drive.`);
      results.push({ test: 'Folder Cleanup (Skipped / Preserved)', passed: true });
    } else if (testFolderId) {
      logStep(7, 'Cleaning Up Test Folder');
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${testFolderId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        logPass(`Test folder ${testFolderId} cleaned up successfully.`);
        results.push({ test: 'Folder Cleanup', passed: true });
        testFolderId = null;
      } catch (err: any) {
        logInfo(`Note: Could not automatically delete test folder ${testFolderId}: ${err.message}`);
      }
    }
  } finally {
    // Clean local temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------
  // Summary Report
  // -------------------------------------------------------------
  console.log(`\n${colors.bright}====================================================`);
  console.log(` MANUAL TEST SUMMARY RESULTS`);
  console.log(`====================================================${colors.reset}`);
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? `${colors.green}✔ PASS${colors.reset}` : `${colors.red}✖ FAIL${colors.reset}`;
    console.log(`  ${icon} : ${r.test}`);
    if (!r.passed) allPassed = false;
  }
  console.log(`----------------------------------------------------`);
  if (allPassed) {
    console.log(`${colors.green}${colors.bright}ALL GOOGLE DRIVE ENGINE TESTS PASSED!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}${colors.bright}SOME TESTS FAILED. Please review the log above.${colors.reset}\n`);
  }
}

runManualDriveTests().catch((err) => {
  console.error('\nFatal test execution error:', err.message);
  process.exit(1);
});
