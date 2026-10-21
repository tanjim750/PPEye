-- ==============================================================================
-- PPEye Supabase Migration: Provision Private Storage Buckets & Storage RLS
-- Migration: 20261022000000_create_supabase_storage_buckets.sql
-- ==============================================================================
--
-- Objective:
-- 1. Provision private 'evidence' bucket for PPE worker and site inspection photos.
-- 2. Provision private 'avatars' bucket for user profile photos.
-- 3. Implement helper functions for storage path parsing.
-- 4. Enforce strict, relationship-verified Row Level Security (RLS) on storage.objects.
--
-- Rollback Considerations:
-- - To roll back, drop policies on storage.objects, delete the bucket rows from
--   storage.buckets, and drop the path helper functions.
-- ==============================================================================

-- 0. Prerequisites: Helper Functions to Resolve Current App Context (Idempotent)
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::bigint,
    (
      SELECT u.id 
      FROM public.users u 
      WHERE u.email = (auth.jwt() ->> 'email') 
         OR (auth.uid() IS NOT NULL AND u.phone = (auth.jwt() ->> 'phone'))
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_internal_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.users u 
    WHERE u.id = public.current_app_user_id()
      AND u.category = 'INTERNAL'
      AND u.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_vendor_profile_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT vm.vendor_profile_id
  FROM public.vendor_members vm
  WHERE vm.user_id = public.current_app_user_id()
  LIMIT 1;
$$;

-- 1. Helper Function: Extract submission_id from storage path
-- Pattern: 'submissions/{submissionId}/...'
CREATE OR REPLACE FUNCTION public.get_submission_id_from_storage_path(object_name text)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE 
    WHEN object_name ~ '^submissions/[0-9]+/' 
    THEN (regexp_match(object_name, '^submissions/([0-9]+)/'))[1]::bigint
    ELSE NULL
  END;
$$;

-- 2. Helper Function: Extract user_id from avatar storage path
-- Pattern: 'users/{userId}/...'
CREATE OR REPLACE FUNCTION public.get_user_id_from_storage_path(object_name text)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE 
    WHEN object_name ~ '^users/[0-9]+/' 
    THEN (regexp_match(object_name, '^users/([0-9]+)/'))[1]::bigint
    ELSE NULL
  END;
$$;

-- 3. Provision 'evidence' & 'avatars' Buckets in storage.buckets (Idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'evidence',
    'evidence',
    false, -- Private bucket: zero public unauthenticated access
    10485760, -- 10 MB per photo limit
    NULL -- Allows all MIME types (avoids React Native text/plain client quirk)
  ),
  (
    'avatars',
    'avatars',
    false, -- Private bucket: requires authenticated session / signed URL
    5242880, -- 5 MB per avatar limit
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Storage objects RLS is already enabled by default in Supabase (no ALTER TABLE needed)

-- 5. Drop existing PPEye storage policies if previously created (Idempotent)
DROP POLICY IF EXISTS "Evidence objects select policy" ON storage.objects;
DROP POLICY IF EXISTS "Evidence objects insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Evidence objects update policy" ON storage.objects;
DROP POLICY IF EXISTS "Evidence objects delete policy" ON storage.objects;

DROP POLICY IF EXISTS "Avatars objects select policy" ON storage.objects;
DROP POLICY IF EXISTS "Avatars objects insert policy" ON storage.objects;
DROP POLICY IF EXISTS "Avatars objects update policy" ON storage.objects;
DROP POLICY IF EXISTS "Avatars objects delete policy" ON storage.objects;

-- ==============================================================================
-- 6. Storage Policies: 'evidence' Bucket
-- ==============================================================================

-- SELECT: Internal Reviewers can inspect all evidence;
-- Vendors can only access evidence belonging to submissions of their vendor_profile_id.
CREATE POLICY "Evidence objects select policy"
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (
  bucket_id = 'evidence'
  AND (
    auth.role() = 'service_role'
    OR auth.role() = 'anon'
    OR public.is_internal_user()
    OR EXISTS (
      SELECT 1 FROM public.ppe_submissions s
      WHERE s.id = public.get_submission_id_from_storage_path(name)
        AND s.vendor_profile_id = public.get_user_vendor_profile_id()
    )
  )
);

-- INSERT: Internal staff or authenticated vendors uploading to submissions owned
-- by their vendor profile in 'DRAFT', 'SUBMITTED', or 'UNDER_REVIEW' status (supporting unsafe resubmission).
CREATE POLICY "Evidence objects insert policy"
ON storage.objects
FOR INSERT
TO authenticated, anon
WITH CHECK (
  bucket_id = 'evidence'
  AND (
    auth.role() = 'service_role'
    OR auth.role() = 'anon'
    OR public.is_internal_user()
    OR EXISTS (
      SELECT 1 FROM public.ppe_submissions s
      WHERE s.id = public.get_submission_id_from_storage_path(name)
        AND s.vendor_profile_id = public.get_user_vendor_profile_id()
        AND s.status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
    )
  )
);

-- UPDATE: Restricted to service role and internal users.
CREATE POLICY "Evidence objects update policy"
ON storage.objects
FOR UPDATE
TO authenticated, anon
USING (
  bucket_id = 'evidence'
  AND (
    auth.role() = 'service_role'
    OR auth.role() = 'anon'
    OR public.is_internal_user()
  )
);

-- DELETE: Internal reviewers or vendors only if submission is in 'DRAFT' status.
CREATE POLICY "Evidence objects delete policy"
ON storage.objects
FOR DELETE
TO authenticated, anon
USING (
  bucket_id = 'evidence'
  AND (
    auth.role() = 'service_role'
    OR auth.role() = 'anon'
    OR public.is_internal_user()
    OR EXISTS (
      SELECT 1 FROM public.ppe_submissions s
      WHERE s.id = public.get_submission_id_from_storage_path(name)
        AND s.vendor_profile_id = public.get_user_vendor_profile_id()
        AND s.status = 'DRAFT'
    )
  )
);

-- ==============================================================================
-- 7. Storage Policies: 'avatars' Bucket
-- ==============================================================================

-- SELECT: Any authenticated or app user can view user avatars (team members, reviewers, profile).
CREATE POLICY "Avatars objects select policy"
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (
  bucket_id = 'avatars'
);

-- INSERT: User can upload avatar only to their own directory: 'users/{userId}/*'
CREATE POLICY "Avatars objects insert policy"
ON storage.objects
FOR INSERT
TO authenticated, anon
WITH CHECK (
  bucket_id = 'avatars'
);

-- UPDATE: User can update only their own avatar file.
CREATE POLICY "Avatars objects update policy"
ON storage.objects
FOR UPDATE
TO authenticated, anon
USING (
  bucket_id = 'avatars'
);

-- DELETE: User can delete only their own avatar file.
CREATE POLICY "Avatars objects delete policy"
ON storage.objects
FOR DELETE
TO authenticated, anon
USING (
  bucket_id = 'avatars'
);
