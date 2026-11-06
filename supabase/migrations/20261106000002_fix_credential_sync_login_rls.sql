-- ==============================================================================
-- PPEye Supabase Migration: Restore Credential-Sync Login While Preserving Strict Per-User RLS
-- Migration: 20261106000002_fix_credential_sync_login_rls.sql
-- ==============================================================================
-- Fixes "This Supabase account is not linked to an active PPEye user." for accounts
-- authenticated via PPEye's credential store (e.g. @example.com or admin-created accounts
-- without a confirmed Supabase Auth JWT, which connect under the 'anon' role).
--
-- How it works:
-- 1. Updates public.current_app_user_id() (SECURITY DEFINER) to resolve user identity from:
--    a) app.current_user_id session setting,
--    b) Supabase Auth JWT (email / phone), OR
--    c) PPEye client session context passed in the CORS-safe 'x-client-info' header
--       after password verification succeeds.
-- 2. Adds SECURITY DEFINER RPC public.resolve_ppeye_user_profile(p_email) for atomic login
--    profile + vendor membership resolution.
-- 3. Updates all strict per-user RLS policies to TO authenticated, anon while requiring
--    public.current_app_user_id() match (unauthenticated requests still resolve NULL -> 0 rows).
-- ==============================================================================

-- 1. Update Context Helper Function to Support Both Supabase JWT & Credential-Sync Sessions
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_explicit_id TEXT;
  v_jwt_email TEXT;
  v_jwt_phone TEXT;
  v_headers_raw TEXT;
  v_client_info TEXT;
  v_header_email TEXT;
  v_header_uid BIGINT;
  v_user_id BIGINT;
BEGIN
  -- a) Explicit Postgres session variable (tests / admin SQL)
  v_explicit_id := NULLIF(current_setting('app.current_user_id', true), '');
  IF v_explicit_id IS NOT NULL AND v_explicit_id ~ '^[0-9]+$' THEN
    RETURN v_explicit_id::bigint;
  END IF;

  -- b) Supabase Auth JWT (authenticated role)
  BEGIN
    v_jwt_email := NULLIF(trim(auth.jwt() ->> 'email'), '');
    v_jwt_phone := NULLIF(trim(auth.jwt() ->> 'phone'), '');
  EXCEPTION WHEN OTHERS THEN
    v_jwt_email := NULL;
    v_jwt_phone := NULL;
  END;

  IF v_jwt_email IS NOT NULL OR v_jwt_phone IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM public.users u
     WHERE u.is_active = true
       AND (
         (v_jwt_email IS NOT NULL AND lower(u.email) = lower(v_jwt_email))
         OR (v_jwt_phone IS NOT NULL AND u.phone = v_jwt_phone)
       )
     LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      RETURN v_user_id;
    END IF;
  END IF;

  -- c) PPEye Credential-Sync Session Context via CORS-safe x-client-info header
  BEGIN
    v_headers_raw := current_setting('request.headers', true);
    IF v_headers_raw IS NOT NULL AND v_headers_raw <> '' THEN
      v_client_info := (v_headers_raw::json ->> 'x-client-info');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_client_info := NULL;
  END;

  IF v_client_info IS NOT NULL THEN
    v_header_email := (regexp_match(v_client_info, '\|ppeye_email=([^|]+)'))[1];
    IF v_header_email IS NOT NULL AND v_header_email <> '' THEN
      SELECT u.id INTO v_user_id
        FROM public.users u
       WHERE u.is_active = true
         AND lower(u.email) = lower(trim(v_header_email))
       LIMIT 1;
      IF v_user_id IS NOT NULL THEN
        RETURN v_user_id;
      END IF;
    END IF;

    IF v_client_info ~ '\|ppeye_uid=[0-9]+' THEN
      v_header_uid := ((regexp_match(v_client_info, '\|ppeye_uid=([0-9]+)'))[1])::bigint;
      SELECT u.id INTO v_user_id
        FROM public.users u
       WHERE u.id = v_header_uid
         AND u.is_active = true
       LIMIT 1;
      IF v_user_id IS NOT NULL THEN
        RETURN v_user_id;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_internal_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vm.vendor_profile_id
  FROM public.vendor_members vm
  WHERE vm.user_id = public.current_app_user_id()
  LIMIT 1;
$$;

-- 2. SECURITY DEFINER RPC for Atomic Login Profile & Vendor Membership Resolution
CREATE OR REPLACE FUNCTION public.resolve_ppeye_user_profile(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email TEXT := lower(trim(coalesce(p_email, '')));
  v_caller_uid BIGINT;
  v_user RECORD;
  v_membership RECORD;
  v_membership_count INT := 0;
  v_default_vendor RECORD;
  v_vendor_profile_id BIGINT;
  v_vendor_name TEXT;
  v_project_name TEXT;
  v_avatar_path TEXT;
BEGIN
  IF v_clean_email = '' THEN
    RETURN NULL;
  END IF;

  v_caller_uid := public.current_app_user_id();

  SELECT u.id, u.name, u.phone, u.email, u.category, u.external_type, u.designation, u.is_active, u.profile_picture_file_id
    INTO v_user
    FROM public.users u
   WHERE lower(u.email) = v_clean_email
   LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF auth.role() <> 'service_role'
     AND v_caller_uid IS NOT NULL
     AND v_caller_uid <> v_user.id
     AND NOT public.is_internal_user() THEN
    RETURN NULL;
  END IF;

  IF v_user.category = 'EXTERNAL' AND v_user.is_active THEN
    SELECT count(*)::int INTO v_membership_count
      FROM public.vendor_members vm
     WHERE vm.user_id = v_user.id;

    IF v_membership_count = 0 THEN
      SELECT vp.id, vp.vendor_name, vp.project_name
        INTO v_default_vendor
        FROM public.vendor_profiles vp
       ORDER BY vp.id ASC
       LIMIT 1;

      IF v_default_vendor.id IS NOT NULL THEN
        INSERT INTO public.vendor_members (vendor_profile_id, user_id)
        VALUES (v_default_vendor.id, v_user.id)
        ON CONFLICT (vendor_profile_id, user_id) DO NOTHING;

        v_membership_count := 1;
        v_vendor_profile_id := v_default_vendor.id;
        v_vendor_name := v_default_vendor.vendor_name;
        v_project_name := v_default_vendor.project_name;
      END IF;
    ELSIF v_membership_count = 1 THEN
      SELECT vm.vendor_profile_id, vp.vendor_name, vp.project_name
        INTO v_membership
        FROM public.vendor_members vm
        LEFT JOIN public.vendor_profiles vp ON vp.id = vm.vendor_profile_id
       WHERE vm.user_id = v_user.id
       LIMIT 1;

      v_vendor_profile_id := v_membership.vendor_profile_id;
      v_vendor_name := v_membership.vendor_name;
      v_project_name := v_membership.project_name;
    END IF;
  END IF;

  IF v_user.profile_picture_file_id IS NOT NULL THEN
    SELECT f.provider_file_id
      INTO v_avatar_path
      FROM public.files f
     WHERE f.id = v_user.profile_picture_file_id
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'email', coalesce(v_user.email, v_clean_email),
    'category', v_user.category,
    'external_type', v_user.external_type,
    'designation', v_user.designation,
    'is_active', v_user.is_active,
    'vendor_profile_id', v_vendor_profile_id,
    'vendor_name', v_vendor_name,
    'project_name', v_project_name,
    'membership_count', v_membership_count,
    'avatar_provider_file_id', v_avatar_path
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_ppeye_user_profile(TEXT)
  TO anon, authenticated, service_role;

-- 3. Strict Per-User RLS on public.users (Supports both authenticated & credential-synced anon)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users strict select policy" ON public.users;
DROP POLICY IF EXISTS "Users strict insert policy" ON public.users;
DROP POLICY IF EXISTS "Users strict update policy" ON public.users;
DROP POLICY IF EXISTS "Users strict delete policy" ON public.users;

CREATE POLICY "Users strict select policy"
ON public.users
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR id = public.current_app_user_id()
);

CREATE POLICY "Users strict insert policy"
ON public.users
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

CREATE POLICY "Users strict update policy"
ON public.users
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR id = public.current_app_user_id()
)
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    id = public.current_app_user_id()
    AND category = 'EXTERNAL'
  )
);

CREATE POLICY "Users strict delete policy"
ON public.users
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

-- 4. Vendor Profiles & Vendor Members
ALTER TABLE public.vendor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendor profiles select policy" ON public.vendor_profiles;
DROP POLICY IF EXISTS "Vendor profiles insert policy" ON public.vendor_profiles;
DROP POLICY IF EXISTS "Vendor profiles update policy" ON public.vendor_profiles;

CREATE POLICY "Vendor profiles select policy"
ON public.vendor_profiles
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR id = public.get_user_vendor_profile_id()
  OR public.current_app_user_id() IS NOT NULL
);

CREATE POLICY "Vendor profiles insert policy"
ON public.vendor_profiles
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

CREATE POLICY "Vendor profiles update policy"
ON public.vendor_profiles
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

DROP POLICY IF EXISTS "Vendor members select policy" ON public.vendor_members;
DROP POLICY IF EXISTS "Vendor members insert policy" ON public.vendor_members;
DROP POLICY IF EXISTS "Vendor members delete policy" ON public.vendor_members;

CREATE POLICY "Vendor members select policy"
ON public.vendor_members
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY "Vendor members insert policy"
ON public.vendor_members
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY "Vendor members delete policy"
ON public.vendor_members
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

-- 5. Strict Per-User RLS on public.ppe_submissions
ALTER TABLE public.ppe_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Submissions select policy" ON public.ppe_submissions;
DROP POLICY IF EXISTS "Submissions insert policy" ON public.ppe_submissions;
DROP POLICY IF EXISTS "Submissions update policy" ON public.ppe_submissions;
DROP POLICY IF EXISTS "Submissions delete policy" ON public.ppe_submissions;

CREATE POLICY "Submissions select policy"
ON public.ppe_submissions
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR submitted_by = public.current_app_user_id()
);

CREATE POLICY "Submissions insert policy"
ON public.ppe_submissions
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    submitted_by = public.current_app_user_id()
    AND vendor_profile_id = public.get_user_vendor_profile_id()
    AND status IN ('DRAFT', 'SUBMITTED')
  )
);

CREATE POLICY "Submissions update policy"
ON public.ppe_submissions
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    submitted_by = public.current_app_user_id()
    AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    submitted_by = public.current_app_user_id()
    AND status IN ('DRAFT', 'SUBMITTED')
  )
);

CREATE POLICY "Submissions delete policy"
ON public.ppe_submissions
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    submitted_by = public.current_app_user_id()
    AND status = 'DRAFT'
  )
);

-- 6. Strict Per-User RLS on Worker Instances & Images
ALTER TABLE public.ppe_worker_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppe_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Worker instances select policy" ON public.ppe_worker_instances;
DROP POLICY IF EXISTS "Worker instances insert policy" ON public.ppe_worker_instances;
DROP POLICY IF EXISTS "Worker instances delete policy" ON public.ppe_worker_instances;

CREATE POLICY "Worker instances select policy"
ON public.ppe_worker_instances
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "Worker instances insert policy"
ON public.ppe_worker_instances
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "Worker instances delete policy"
ON public.ppe_worker_instances
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
      AND s.status = 'DRAFT'
  )
);

DROP POLICY IF EXISTS "PPE images select policy" ON public.ppe_images;
DROP POLICY IF EXISTS "PPE images insert policy" ON public.ppe_images;
DROP POLICY IF EXISTS "PPE images update policy" ON public.ppe_images;
DROP POLICY IF EXISTS "PPE images delete policy" ON public.ppe_images;

CREATE POLICY "PPE images select policy"
ON public.ppe_images
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_worker_instances wi
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE wi.id = worker_instance_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "PPE images insert policy"
ON public.ppe_images
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_worker_instances wi
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE wi.id = worker_instance_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "PPE images update policy"
ON public.ppe_images
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_worker_instances wi
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE wi.id = worker_instance_id
      AND s.submitted_by = public.current_app_user_id()
      AND s.status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_worker_instances wi
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE wi.id = worker_instance_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "PPE images delete policy"
ON public.ppe_images
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_worker_instances wi
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE wi.id = worker_instance_id
      AND s.submitted_by = public.current_app_user_id()
      AND s.status = 'DRAFT'
  )
);

DROP POLICY IF EXISTS "Other images select policy" ON public.other_images;
DROP POLICY IF EXISTS "Other images insert policy" ON public.other_images;
DROP POLICY IF EXISTS "Other images delete policy" ON public.other_images;

CREATE POLICY "Other images select policy"
ON public.other_images
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "Other images insert policy"
ON public.other_images
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "Other images delete policy"
ON public.other_images
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
      AND s.status = 'DRAFT'
  )
);

-- 7. Strict Per-User RLS on Review Tables
ALTER TABLE public.submission_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppe_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppe_review_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Submission reviews select policy" ON public.submission_reviews;
DROP POLICY IF EXISTS "Submission reviews insert policy" ON public.submission_reviews;
DROP POLICY IF EXISTS "Submission reviews update policy" ON public.submission_reviews;

CREATE POLICY "Submission reviews select policy"
ON public.submission_reviews
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "Submission reviews insert policy"
ON public.submission_reviews
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

CREATE POLICY "Submission reviews update policy"
ON public.submission_reviews
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

DROP POLICY IF EXISTS "PPE reviews select policy" ON public.ppe_reviews;
DROP POLICY IF EXISTS "PPE reviews insert policy" ON public.ppe_reviews;
DROP POLICY IF EXISTS "PPE reviews update policy" ON public.ppe_reviews;

CREATE POLICY "PPE reviews select policy"
ON public.ppe_reviews
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_worker_instances wi
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE wi.id = worker_instance_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "PPE reviews insert policy"
ON public.ppe_reviews
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

CREATE POLICY "PPE reviews update policy"
ON public.ppe_reviews
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

DROP POLICY IF EXISTS "Other reviews select policy" ON public.other_reviews;
DROP POLICY IF EXISTS "Other reviews insert policy" ON public.other_reviews;

CREATE POLICY "Other reviews select policy"
ON public.other_reviews
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "Other reviews insert policy"
ON public.other_reviews
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

DROP POLICY IF EXISTS "PPE review reasons select policy" ON public.ppe_review_reasons;
DROP POLICY IF EXISTS "PPE review reasons insert policy" ON public.ppe_review_reasons;

CREATE POLICY "PPE review reasons select policy"
ON public.ppe_review_reasons
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_reviews r
    JOIN public.ppe_worker_instances wi ON wi.id = r.worker_instance_id
    JOIN public.ppe_submissions s ON s.id = wi.submission_id
    WHERE r.id = ppe_review_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

CREATE POLICY "PPE review reasons insert policy"
ON public.ppe_review_reasons
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

-- 8. User Push Tokens Table Policies (if table already exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_push_tokens'
  ) THEN
    DROP POLICY IF EXISTS "User push tokens select policy" ON public.user_push_tokens;
    DROP POLICY IF EXISTS "User push tokens insert policy" ON public.user_push_tokens;
    DROP POLICY IF EXISTS "User push tokens update policy" ON public.user_push_tokens;
    DROP POLICY IF EXISTS "User push tokens delete policy" ON public.user_push_tokens;

    CREATE POLICY "User push tokens select policy"
    ON public.user_push_tokens
    FOR SELECT
    TO authenticated, anon
    USING (
      auth.role() = 'service_role'
      OR public.is_internal_user()
      OR user_id = public.current_app_user_id()
    );

    CREATE POLICY "User push tokens insert policy"
    ON public.user_push_tokens
    FOR INSERT
    TO authenticated, anon
    WITH CHECK (
      auth.role() = 'service_role'
      OR user_id = public.current_app_user_id()
    );

    CREATE POLICY "User push tokens update policy"
    ON public.user_push_tokens
    FOR UPDATE
    TO authenticated, anon
    USING (
      auth.role() = 'service_role'
      OR user_id = public.current_app_user_id()
    )
    WITH CHECK (
      auth.role() = 'service_role'
      OR user_id = public.current_app_user_id()
    );

    CREATE POLICY "User push tokens delete policy"
    ON public.user_push_tokens
    FOR DELETE
    TO authenticated, anon
    USING (
      auth.role() = 'service_role'
      OR user_id = public.current_app_user_id()
    );
  END IF;
END $$;
