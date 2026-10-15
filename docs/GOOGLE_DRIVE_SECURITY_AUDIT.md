# PPEye Google Drive Access Model & Security Audit

## Executive Summary

An architectural and security audit of PPEye's storage access model was conducted to determine whether client-side Google Drive OAuth safely supports the intended account ownership model for external Vendor Team Leaders and internal EHS Reviewers.

**Audit Verdict:**
Direct client-side mobile OAuth **cannot safely support** PPEye's enterprise compliance and account ownership model:
1. **Personal Google Accounts:** If external Team Leaders authenticate using their personal Google accounts, inspection evidence is stored across disparate, uncontrollable private Google Drives. Enterprise EHS reviewers cannot reliably access the photos, contractors' personal storage quotas dictate upload success, and company compliance audit trails are lost when contractors depart or delete files.
2. **Central Corporate Google Account on Mobile:** If the mobile client is configured to upload directly to a central corporate Google Drive, the mobile application binary must bundle either corporate OAuth client secrets (`EXPO_PUBLIC_GOOGLE_DRIVE_FOLDER_SECRET`), service account private keys, or long-lived refresh tokens. Any contractor or malicious actor can extract these credentials to gain unrestricted read, overwrite, and delete access across the entire corporate Google Drive, completely bypassing application authorization.
3. **Absence of Row-Level Security on Storage:** Direct Google Drive access has no awareness of Supabase identities, vendor profiles, submission status, or safety review workflows.

**Solution:**
A **Server-Mediated Storage Architecture** implemented via Supabase Edge Functions (`storage-api`). Google Cloud Service Account / Drive credentials are strictly confined to the server environment. The mobile client authenticates exclusively via Supabase JWTs, and the server mediates all storage operations while strictly enforcing Supabase identity, role hierarchy, submission ownership, and file-to-record integrity.

---

## Stakeholder & Ownership Model

| Stakeholder | User Category | Primary Storage Needs | Security Boundary |
| :--- | :--- | :--- | :--- |
| **Vendor Team Leader** | `EXTERNAL` (`TEAM_LEADER`) | Upload daily worker PPE photos and site hazard evidence from mobile devices. | Must only be permitted to upload and view photos for submissions associated with their assigned vendor profile. Must **never** access other vendors' submissions or central drive files. |
| **EHS Reviewer / Auditor** | `INTERNAL` | Review worker inspection photos across all vendors, assign safety verdicts (`SAFE` / `UNSAFE`), and audit compliance. | Authorized to inspect evidence photos for all submissions across the enterprise. Must not have direct credentials to manage/delete underlying root storage. |
| **Enterprise / Organization** | Legal Entity | Legal ownership and retention of safety compliance evidence and audit logs. | Evidence must reside in enterprise-controlled central storage. Evidence must **never be made public**. |

---

## Detailed Vulnerability Analysis of Direct Mobile OAuth

### 1. Hardcoded / Exposed Secrets in Mobile Client Bundles
In direct mobile OAuth approaches, developers often place credentials in `.env`:
```env
# CRITICAL VULNERABILITY: EXPO_PUBLIC_ prefixes embed secrets in the client APK / IPA bundle!
EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=GOCSPX-...
EXPO_PUBLIC_GOOGLE_REFRESH_TOKEN=1//04...
```
Because Expo bundles any environment variable prefixed with `EXPO_PUBLIC_` directly into the JavaScript client bundle, any user with basic mobile reverse-engineering tools (e.g. `apktool`, strings extraction, or a Charles/Proxyman proxy) can extract the client secret and refresh token.

### 2. Over-Privileged Google Drive Scopes
Google Drive API OAuth scopes (`https://www.googleapis.com/auth/drive.file` or `drive`) grant unrestricted write or full-drive access. When a token is held on an external contractor's mobile device:
- The contractor can upload arbitrary non-inspection files to corporate storage.
- The contractor can delete, rename, or tamper with evidence uploaded by other contractors.
- The contractor can exhaust the company's Google Workspace storage quota.

### 3. Inability to Enforce Application-Level Authorization (RLS)
Google Drive permissions cannot inspect Supabase database constraints:
- Drive does not know if a submission is already reviewed or locked.
- Drive does not know which vendor a contractor belongs to.
- Drive does not know if a photo corresponds to an active worker instance.

---

## Proposed Server-Mediated Storage Architecture

The server-mediated architecture introduces a zero-trust storage proxy between the mobile client and Google Drive, implemented as a lightweight **Supabase Edge Function** (`storage-api`).

```mermaid
sequenceDiagram
    autonumber
    actor TeamLeader as External Team Leader
    participant MobileApp as PPEye Mobile App
    participant EdgeFunc as Supabase Edge Function (storage-api)
    participant SupabaseDB as Supabase Database (Postgres & RLS)
    participant GoogleDrive as Enterprise Google Drive

    Note over MobileApp,EdgeFunc: 1. User Authenticated via Supabase Auth (JWT)
    TeamLeader->>MobileApp: Take Worker FRONT/BACK Photo
    MobileApp->>EdgeFunc: POST /storage-api (Multipart Binary + Supabase JWT)
    
    Note over EdgeFunc,SupabaseDB: 2. Identity, Role & Ownership Verification
    EdgeFunc->>SupabaseDB: Verify JWT & fetch user profile
    SupabaseDB-->>EdgeFunc: User: External, VendorProfileId: 1
    EdgeFunc->>SupabaseDB: Verify submission ownership (vendor_members)
    SupabaseDB-->>EdgeFunc: Authorized (owns submission)

    Note over EdgeFunc,GoogleDrive: 3. Secure Server-to-Server Upload
    EdgeFunc->>GoogleDrive: Upload to Corporate PPEye Folder (Service Account)
    GoogleDrive-->>EdgeFunc: Return driveFileId (e.g., "drv_abc123")

    Note over EdgeFunc,SupabaseDB: 4. Atomic File-to-Record Linking
    EdgeFunc->>SupabaseDB: INSERT into files table (provider_file_id: drv_abc123)
    EdgeFunc->>SupabaseDB: INSERT into ppe_images table (worker_instance_id, side)
    SupabaseDB-->>EdgeFunc: Success

    EdgeFunc-->>MobileApp: 201 Created (File Record & Metadata)
    MobileApp-->>TeamLeader: Display Instant Thumbnail
```

### Authorization Matrix

| Action | Caller Role | Conditions Checked by Edge Function | Evidence Visibility |
| :--- | :--- | :--- | :--- |
| **Upload Worker PPE Photo** | `EXTERNAL` | 1. User belongs to `vendor_members` for the submission.<br>2. Worker instance exists in submission.<br>3. Exactly one active image per side (`FRONT`/`BACK`). | **Private** |
| **Upload Others Evidence Photo** | `EXTERNAL` | 1. User belongs to `vendor_members` for the submission.<br>2. Submission is in editable state (`DRAFT`). | **Private** |
| **Download / Stream Evidence** | `EXTERNAL` | 1. File is linked to user's assigned vendor submissions or user's own profile picture.<br>2. Banned from viewing other vendors' submissions. | **Private** (Authenticated stream) |
| **Download / Stream Evidence** | `INTERNAL` (EHS Reviewer) | 1. User is `INTERNAL`.<br>2. Authorized to review all vendor submissions. | **Private** (Authenticated stream) |
| **Delete Evidence** | `EXTERNAL` | 1. Submission is unreviewed.<br>2. File is not referenced in active safety audits. | **Private** |

---

## Binary Transfer Limits & Secure Streaming

1. **Upload Mechanism:**
   - Inspection photos taken by mobile devices are compressed and sanitized to under **10 MB** (enforced by `MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024`).
   - The mobile client streams the image via `multipart/form-data` with `Authorization: Bearer <supabase_jwt>`.
   - The Supabase Edge Function streams the binary directly to the Google Drive v3 upload endpoint without storing intermediate files on disk, ensuring memory usage is strictly bounded.

2. **Download / Viewing Mechanism:**
   - **Never Public:** Google Drive files are created with private permissions (`anyoneWithLink` is **never** granted).
   - The Edge Function streams file binaries via authenticated HTTP response (`GET /storage-api?action=download&fileId=...`).
   - The mobile client caches verified private images in app-private sandbox storage (`FileSystem.documentDirectory` / `FileSystem.cacheDirectory`), evicting sensitive caches on logout.

---

## Deployment Setup & Required Secrets

### 1. Remove Mobile Secrets
Remove client-side secrets from `.env` and `src/constants/config.ts`:
```env
# REMOVE:
# EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=...
# EXPO_PUBLIC_GOOGLE_REFRESH_TOKEN=...
# EXPO_PUBLIC_GOOGLE_DRIVE_FOLDER_SECRET=...
```
The mobile application only needs:
```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...
```

### 2. Configure Supabase Server Secrets
Configure server-side secrets in the Supabase Dashboard or via Supabase CLI (`supabase secrets set`):
```bash
# 1. Google Cloud Service Account or OAuth credentials (server-side only)
supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL="ppeye-storage@<project-id>.iam.gserviceaccount.com"
supabase secrets set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
supabase secrets set GOOGLE_DRIVE_ROOT_FOLDER_ID="1a2b3c4d5e6f7g8h9i0j"

# 2. Or if using OAuth Refresh Token for central account:
supabase secrets set GOOGLE_CLIENT_ID="175589809991-...apps.googleusercontent.com"
supabase secrets set GOOGLE_CLIENT_SECRET="GOCSPX-..."
supabase secrets set GOOGLE_REFRESH_TOKEN="1//04..."
supabase secrets set GOOGLE_DRIVE_TARGET_FOLDER_ID="1a2b3c4d5e6f7g8h9i0j"
```

### 3. Deploy the Storage Edge Function
```bash
supabase functions deploy storage-api --no-verify-jwt
```
*(The function verifies the JWT internally to provide fine-grained error messages and role resolution).*
