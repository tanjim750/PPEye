# PPEye Google Drive Engine — Manual Test Cases & Verification Guide

This document contains step-by-step manual test cases designed to verify that the **PPEye Google Drive Engine** functions properly in both **Direct Mobile Mode** and **Server-Mediated Mode (Supabase Edge Function)**.

---

## 📋 Test Environment & Prerequisites

1. **Active Google Account**: Access to a Google Drive account (or corporate workspace).
2. **PPEye App**: Running locally on Android/iOS via development build (`npx expo run:android` or `npx expo run:ios`) or via the test scripts.
3. **Environment Config (`.env`)**:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://ucqtzwaanzrtgalgwumz.supabase.co
   EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...
   EXPO_PUBLIC_GOOGLE_CLIENT_ID=175589809991-9mv0c5pia4j5sbvt41bj0ttjci7s2hqi.apps.googleusercontent.com
   EXPO_PUBLIC_STORAGE_MODE=server # or 'direct'
   ```

---

## 🧪 Detailed Manual Test Cases

### Test Case 1: Google OAuth Authentication & Token Acquisition
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-01` |
| **Component** | `src/services/google-drive/auth.ts` |
| **Objective** | Verify that the app prompts Google Sign-In with minimal scope (`https://www.googleapis.com/auth/drive.file`) and acquires an access token. |
| **Preconditions** | App installed, user logged in to PPEye, Google Play Services available. |
| **Steps** | 1. Navigate to Profile or Submission screen in the app.<br>2. Trigger Google Drive Sign-In.<br>3. Select a Google account in the native account picker dialog.<br>4. Accept permissions for Google Drive file access. |
| **Expected Result** | - Native Google account picker displays cleanly without crash.<br>- Session is established and stored securely.<br>- `isGoogleAuthenticated()` returns `true`.<br>- Google Client Secret is **never** requested or transmitted. |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 2: Folder Hierarchy Creation & Idempotency
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-02` |
| **Component** | `src/services/google-drive/folders.ts` |
| **Objective** | Verify that `PPEye` automatically creates the structured folder path: `PPEye/submissions/{YYYY-MM-DD}/{submission_id}/` without duplicates. |
| **Preconditions** | Valid Google Drive access token. |
| **Steps** | 1. Open Google Drive in your web browser (`drive.google.com`).<br>2. Trigger a submission upload from the app or CLI runner.<br>3. Check Google Drive for the root folder `PPEye`.<br>4. Inspect inside `PPEye` for subfolder `submissions/`.<br>5. Trigger a second submission on the same date. |
| **Expected Result** | - Root `PPEye` folder is created if it didn't exist.<br>- Subfolders `submissions` and current date are created.<br>- The second submission reuses the existing date folder without creating duplicates (idempotency). |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 3: Small Photo Upload (< 5MB Multipart Upload)
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-03` |
| **Component** | `src/services/google-drive/upload.ts` |
| **Objective** | Verify fast multipart upload for typical camera photos (< 5MB). |
| **Preconditions** | Camera photo captured locally (e.g., worker front PPE image). |
| **Steps** | 1. Capture a worker FRONT photo (approx. 1–3 MB).<br>2. Submit the photo to Google Drive.<br>3. Inspect the response payload and Google Drive web interface. |
| **Expected Result** | - Upload completes via single-request multipart upload (`uploadType=multipart`).<br>- Response returns valid `fileId`, `name`, `mimeType: "image/jpeg"`, and `webViewLink`.<br>- The image can be viewed and opened in Google Drive. |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 4: Large File Upload (≥ 5MB Resumable Upload)
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-04` |
| **Component** | `src/services/google-drive/upload.ts` |
| **Objective** | Verify resumable chunked upload for high-resolution images or files ≥ 5MB. |
| **Preconditions** | A test file or high-res image ≥ 5MB on device. |
| **Steps** | 1. Select or generate a test file larger than 5MB.<br>2. Trigger upload via `uploadFileToDrive()`.<br>3. Monitor upload request headers in network logs. |
| **Expected Result** | - Drive engine detects size ≥ 5MB and initiates resumable upload session (`uploadType=resumable`).<br>- Chunks (typically 5MB) are uploaded sequentially.<br>- Final chunk returns HTTP 200/201 with completed file metadata. |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 5: File Metadata & Thumbnail URL Retrieval
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-05` |
| **Component** | `src/services/google-drive/files.ts` |
| **Objective** | Verify metadata retrieval (`getDriveFileMetadata`) and secure thumbnail URL generation. |
| **Preconditions** | A previously uploaded file exists in Google Drive. |
| **Steps** | 1. Call `getDriveFileMetadata(fileId)` with the uploaded file ID.<br>2. Inspect returned fields (`id`, `name`, `mimeType`, `sizeBytes`, `thumbnailLink`).<br>3. Test `getDriveThumbnailUrl(fileId)`. |
| **Expected Result** | - File metadata matches uploaded file specifications.<br>- `thumbnailLink` or thumbnail helper returns a valid thumbnail URL formatted with dimensions (`sz=w800`). |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 6: Private File Download & Local Caching
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-06` |
| **Component** | `src/services/google-drive/files.ts` & `src/utils/image.ts` |
| **Objective** | Verify that files are downloaded using authenticated requests and stored safely in the private app cache. |
| **Preconditions** | File ID of an uploaded inspection photo. |
| **Steps** | 1. Call `downloadDriveFile(fileId)`.<br>2. Inspect returned local file URI in the private cache (`cache/ppeye_evidence/...`).<br>3. Verify file content matches original size.<br>4. Call `downloadDriveFile(fileId)` a second time. |
| **Expected Result** | - File is saved locally in private sandbox storage.<br>- Second call hits local cache without re-downloading from network.<br>- Evidence photos are not exposed in public Android MediaStore or iOS Camera Roll without authorization. |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 7: File Deletion & Trashing
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-07` |
| **Component** | `src/services/google-drive/files.ts` |
| **Objective** | Verify safe deletion of rejected or replaced evidence files from Google Drive. |
| **Preconditions** | Uploaded test file ID. |
| **Steps** | 1. Call `deleteDriveFile(fileId)`.<br>2. Check Google Drive web interface.<br>3. Immediately call `getDriveFileMetadata(fileId)` on the same ID. |
| **Expected Result** | - File is removed from Google Drive (or moved to Trash).<br>- `getDriveFileMetadata` returns a `StorageError` with `StorageErrorCode.FILE_NOT_FOUND` (HTTP 404). |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 8: Server-Mediated Edge Function Mode (`storage-api`)
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-08` |
| **Component** | `supabase/functions/storage-api/index.ts` & `server-storage.client.ts` |
| **Objective** | Verify complete upload/download cycle through Supabase Edge Function without client-side Google credentials. |
| **Preconditions** | App configured with `EXPO_PUBLIC_STORAGE_MODE=server`. User signed into Supabase. |
| **Steps** | 1. Trigger photo upload from the PPEye submission flow.<br>2. Monitor network traffic.<br>3. Verify that requests go to `https://<project>.supabase.co/functions/v1/storage-api/upload`.<br>4. Inspect the `Authorization` header on the request. |
| **Expected Result** | - Request uses the user's Supabase JWT Bearer token.<br>- Google OAuth credentials/refresh token are never sent to or from the mobile app.<br>- Edge Function verifies user role (Team Leader vs EHS Reviewer) and uploads to corporate Drive.<br>- File is registered in Supabase `files` table automatically. |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

### Test Case 9: Network Interruption & Consistency Recovery
| Attribute | Details |
| :--- | :--- |
| **ID** | `TC-DRIVE-09` |
| **Component** | `src/services/storage/upload.queue.ts` |
| **Objective** | Verify that network failures during upload do not corrupt submission state and resume gracefully. |
| **Preconditions** | Network connectivity toggle (Airplane Mode or WiFi off). |
| **Steps** | 1. Start a submission upload with multiple photos.<br>2. Turn on Airplane mode mid-upload.<br>3. Wait 5 seconds, then turn network back on.<br>4. Trigger retry in the submission queue. |
| **Expected Result** | - Upload pauses or fails cleanly with retryable error status.<br>- Photos already uploaded to Drive are preserved and not blindly re-uploaded.<br>- Once network is restored, retry completes remaining photos and marks submission complete. |
| **Pass / Fail** | [ ] PASS &nbsp;&nbsp;&nbsp; [ ] FAIL |

---

## ⚡ Instant Terminal Verification Script

An automated manual test script is provided in the repository at [`scripts/test-drive-manual.ts`](file:///home/abir/Desktop/vs-code/Tanjim%20Bhai/PPEye/scripts/test-drive-manual.ts).

You can run it from your terminal at any time to verify live Google Drive operations in under 10 seconds:

```bash
# Option 1: Passing token as environment variable
GOOGLE_ACCESS_TOKEN="ya29.your_token_here" npx tsx scripts/test-drive-manual.ts

# Option 2: Passing token as CLI parameter
npx tsx scripts/test-drive-manual.ts "ya29.your_token_here"
```

### What this script verifies automatically:
1. **Token Validation**: Confirms your Google token has active Drive scopes.
2. **Folder Creation**: Creates an isolated `PPEye_ManualTest_<timestamp>` test folder in Drive.
3. **Multipart Upload**: Uploads a sample image into the folder.
4. **Metadata Check**: Reads properties, file size, and thumbnail URL.
5. **Download & Integrity**: Downloads the file and validates byte length.
6. **Deletion & Cleanup**: Deletes the test file and test folder, leaving your Drive clean.
