-- ==============================================================================
-- PPEye Supabase Migration: Strict Per-User Profile & Data Isolation for External Accounts
-- Migration: 20261106000000_strict_external_user_isolation_rls.sql
-- ==============================================================================
-- Enforces strict per-user isolation so every EXTERNAL user account (regardless of
-- external_type: PROJECT_MANAGER, TEAM_LEADER, or WORKER) can ONLY read/write their
-- own user profile, own submissions (submitted_by = current_app_user_id()), own worker
-- instances/images, and own review verdicts. Only INTERNAL users (Reviewers / Admins)
-- can view all external users' profiles and submissions.
-- ==============================================================================

-- 1. Recursion-Safe Context Helper Functions (SECURITY DEFINER avoids RLS recursion on public.users)
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::bigint,
    (
      SELECT u.id
      FROM public.users u
      WHERE (auth.jwt() ->> 'email') IS NOT NULL AND lower(u.email) = lower(auth.jwt() ->> 'email')
         OR (auth.uid() IS NOT NULL AND (auth.jwt() ->> 'phone') IS NOT NULL AND u.phone = (auth.jwt() ->> 'phone'))
      LIMIT 1
    )
  );
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

-- 2. Strict Per-User RLS on public.users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.users;
DROP POLICY IF EXISTS "Allow read for anon users" ON public.users;
DROP POLICY IF EXISTS "Allow write for anon users" ON public.users;
DROP POLICY IF EXISTS "Users strict select policy" ON public.users;
DROP POLICY IF EXISTS "Users strict insert policy" ON public.users;
DROP POLICY IF EXISTS "Users strict update policy" ON public.users;
DROP POLICY IF EXISTS "Users strict delete policy" ON public.users;

CREATE POLICY "Users strict select policy"
ON public.users
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR id = public.current_app_user_id()
);

CREATE POLICY "Users strict insert policy"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

CREATE POLICY "Users strict update policy"
ON public.users
FOR UPDATE
TO authenticated
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
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

-- 3. Strict Per-User RLS on public.vendor_members (prevent cross-vendor member enumeration)
ALTER TABLE public.vendor_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendor members select policy" ON public.vendor_members;
DROP POLICY IF EXISTS "Vendor members insert policy" ON public.vendor_members;
DROP POLICY IF EXISTS "Vendor members delete policy" ON public.vendor_members;

CREATE POLICY "Vendor members select policy"
ON public.vendor_members
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR user_id = public.current_app_user_id()
);

CREATE POLICY "Vendor members insert policy"
ON public.vendor_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

CREATE POLICY "Vendor members delete policy"
ON public.vendor_members
FOR DELETE
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
);

-- 4. Strict Per-User RLS on public.ppe_submissions (submitted_by = current_app_user_id())
ALTER TABLE public.ppe_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Submissions select policy" ON public.ppe_submissions;
DROP POLICY IF EXISTS "Submissions insert policy" ON public.ppe_submissions;
DROP POLICY IF EXISTS "Submissions update policy" ON public.ppe_submissions;
DROP POLICY IF EXISTS "Submissions delete policy" ON public.ppe_submissions;

CREATE POLICY "Submissions select policy"
ON public.ppe_submissions
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR submitted_by = public.current_app_user_id()
);

CREATE POLICY "Submissions insert policy"
ON public.ppe_submissions
FOR INSERT
TO authenticated
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
TO authenticated
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
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    submitted_by = public.current_app_user_id()
    AND status = 'DRAFT'
  )
);

-- 5. Strict Per-User RLS on Worker Instances & Images
ALTER TABLE public.ppe_worker_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppe_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Worker instances select policy" ON public.ppe_worker_instances;
DROP POLICY IF EXISTS "Worker instances insert policy" ON public.ppe_worker_instances;
DROP POLICY IF EXISTS "Worker instances delete policy" ON public.ppe_worker_instances;

CREATE POLICY "Worker instances select policy"
ON public.ppe_worker_instances
FOR SELECT
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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
TO authenticated
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

-- 6. Strict Per-User RLS on Review Tables (External users only read verdicts on their own submissions)
ALTER TABLE public.submission_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppe_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.other_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppe_review_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Submission reviews select policy" ON public.submission_reviews;
CREATE POLICY "Submission reviews select policy"
ON public.submission_reviews
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

DROP POLICY IF EXISTS "PPE reviews select policy" ON public.ppe_reviews;
CREATE POLICY "PPE reviews select policy"
ON public.ppe_reviews
FOR SELECT
TO authenticated
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

DROP POLICY IF EXISTS "Other reviews select policy" ON public.other_reviews;
CREATE POLICY "Other reviews select policy"
ON public.other_reviews
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR EXISTS (
    SELECT 1 FROM public.ppe_submissions s
    WHERE s.id = submission_id
      AND s.submitted_by = public.current_app_user_id()
  )
);

DROP POLICY IF EXISTS "PPE review reasons select policy" ON public.ppe_review_reasons;
CREATE POLICY "PPE review reasons select policy"
ON public.ppe_review_reasons
FOR SELECT
TO authenticated
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
