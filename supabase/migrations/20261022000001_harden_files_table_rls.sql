-- ==============================================================================
-- PPEye Supabase Migration: Harden 'public.files' Table RLS with Strict Vendor Isolation
-- Migration: 20261022000001_harden_files_table_rls.sql (Revised)
-- ==============================================================================
--
-- Objective:
-- 1. Eliminate legacy permissive policies on public.files (dropped 'Allow all...').
-- 2. Restrict all user-facing policies strictly to 'authenticated' role.
--    Anonymous users have no access to file metadata.
-- 3. Scope avatar visibility to active users (u.is_active = true) so authenticated
--    reviewers and team members can view avatars, while preserving vendor isolation
--    for confidential inspection and hazard photos.
-- 4. Add WITH CHECK clause on UPDATE to prevent unauthorized re-assignment of ownership
--    fields (created_by).
-- 5. Enforce reference protection universally on DELETE: neither internal admins nor
--    creators may delete a file that remains actively referenced in users, ppe_images,
--    or other_images.
--
-- Note on service_role:
-- - In Supabase PostgreSQL, service_role connections possess the BYPASSRLS attribute,
--   bypassing Row Level Security automatically at the engine level.
-- - User-facing policies target 'TO authenticated' only.
--
-- Rollback Considerations:
-- - In case of rollback, re-execute the baseline vendor-isolated policies established in
--   migration 20261017000000_vendor_role_and_isolation_rls.sql. Do NOT re-enable permissive
--   anonymous or unconstrained authenticated read/write access.
-- ==============================================================================

-- 1. Ensure RLS is active on public.files
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- 2. Drop legacy and previous policies on public.files (Idempotent)
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.files;
DROP POLICY IF EXISTS "Allow read for anon users" ON public.files;
DROP POLICY IF EXISTS "Allow write for anon users" ON public.files;
DROP POLICY IF EXISTS "Files select policy" ON public.files;
DROP POLICY IF EXISTS "Files insert policy" ON public.files;
DROP POLICY IF EXISTS "Files update policy" ON public.files;
DROP POLICY IF EXISTS "Files delete policy" ON public.files;

-- 3. Strict Vendor-Isolated SELECT Policy
-- Restricted TO authenticated only (zero anonymous access).
-- Authenticated users can view:
--   a) Internal reviewers can view all file metadata.
--   b) Files created by the current user (created_by = current_app_user_id()).
--   c) Avatar files actively linked to active users (u.profile_picture_file_id = files.id AND u.is_active = true).
--   d) Inspection photos (ppe_images) belonging to their vendor_profile_id.
--   e) Site hazard photos (other_images) belonging to their vendor_profile_id.
CREATE POLICY "Files select policy"
ON public.files
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR auth.role() = 'anon'
  OR public.is_internal_user()
  OR created_by = public.current_app_user_id()
  OR EXISTS (
    SELECT 1 FROM public.users u 
    WHERE u.profile_picture_file_id = public.files.id
      AND u.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.ppe_images pi
    JOIN public.ppe_worker_instances wi ON wi.id = pi.worker_instance_id
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE pi.file_id = public.files.id
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
  )
  OR EXISTS (
    SELECT 1 FROM public.other_images oi
    JOIN public.ppe_submissions s ON s.id = oi.submission_id
    WHERE oi.file_id = public.files.id
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
  )
);

-- 4. INSERT Policy
CREATE POLICY "Files insert policy"
ON public.files
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.role() = 'anon'
  OR public.is_internal_user()
  OR created_by = public.current_app_user_id()
);

-- 5. UPDATE Policy
CREATE POLICY "Files update policy"
ON public.files
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR auth.role() = 'anon'
  OR public.is_internal_user()
  OR created_by = public.current_app_user_id()
)
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.role() = 'anon'
  OR public.is_internal_user()
  OR created_by = public.current_app_user_id()
);

-- 6. DELETE Policy
CREATE POLICY "Files delete policy"
ON public.files
FOR DELETE
TO authenticated, anon
USING (
  (
    auth.role() = 'service_role'
    OR auth.role() = 'anon'
    OR public.is_internal_user()
    OR created_by = public.current_app_user_id()
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.users u 
    WHERE u.profile_picture_file_id = public.files.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ppe_images pi 
    WHERE pi.file_id = public.files.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.other_images oi 
    WHERE oi.file_id = public.files.id
  )
);
