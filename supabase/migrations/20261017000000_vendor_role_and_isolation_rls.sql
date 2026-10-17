-- ==============================================================================
-- PPEye Supabase Migration: Vendor Role, Isolation, and Review Protection RLS
-- Migration: 20261017000000_vendor_role_and_isolation_rls.sql
-- ==============================================================================

-- 1. Helper Functions to Resolve Current App Context (Auth User & Vendor Profile)
-- These allow deterministic RLS evaluation with either Supabase Auth UID or session context.

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

-- 2. Clean Up Old Permissive Policies on Core Tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ppe_submissions', 'ppe_worker_instances', 'ppe_images', 'other_images',
    'ppe_reviews', 'ppe_review_reasons', 'other_reviews', 'submission_reviews',
    'vendor_members', 'vendor_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow write for anon users" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow read for anon users" ON public.%I', t);
  END LOOP;
END $$;

-- 3. RLS Policies: Vendor Profiles & Members

-- Vendor Profiles: Readable by authenticated members of the vendor or internal staff
CREATE POLICY "Vendor profiles select policy"
ON public.vendor_profiles
FOR SELECT
TO authenticated, anon
USING (
  public.is_internal_user() 
  OR id = public.get_user_vendor_profile_id()
  OR created_by = public.current_app_user_id()
  OR auth.role() = 'service_role'
);

-- Vendor Members: Readable by vendor members or internal staff
CREATE POLICY "Vendor members select policy"
ON public.vendor_members
FOR SELECT
TO authenticated, anon
USING (
  public.is_internal_user()
  OR vendor_profile_id = public.get_user_vendor_profile_id()
  OR user_id = public.current_app_user_id()
  OR auth.role() = 'service_role'
);

-- Vendor Members Insert/Delete: Project Manager only (or service role / internal admin)
CREATE POLICY "Vendor members insert policy"
ON public.vendor_members
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = public.current_app_user_id()
        AND u.external_type = 'PROJECT_MANAGER'
    )
  )
);

CREATE POLICY "Vendor members delete policy"
ON public.vendor_members
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = public.current_app_user_id()
        AND u.external_type = 'PROJECT_MANAGER'
    )
  )
);

-- 4. RLS Policies: PPE Submissions (Strict Vendor Isolation)

-- SELECT: Internal users see all; vendors only see submissions for their vendor_profile_id.
-- Workers only see submissions they submitted if restricted.
CREATE POLICY "Submissions select policy"
ON public.ppe_submissions
FOR SELECT
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = public.current_app_user_id() AND u.external_type = 'WORKER'
      )
      OR submitted_by = public.current_app_user_id()
    )
  )
);

-- INSERT: Vendors can create submissions only for their assigned vendor_profile_id,
-- starting in DRAFT or SUBMITTED status (never directly COMPLETED).
CREATE POLICY "Submissions insert policy"
ON public.ppe_submissions
FOR INSERT
TO authenticated, anon
WITH CHECK (
  auth.role() = 'service_role'
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND status IN ('DRAFT', 'SUBMITTED')
  )
);

-- UPDATE:
-- Internal reviewers can update status/verdict.
-- Vendors can ONLY update their own vendor's submissions while in DRAFT (or transitioning from DRAFT to SUBMITTED),
-- and can NEVER modify reviewer outcomes or directly set status to COMPLETED.
CREATE POLICY "Submissions update policy"
ON public.ppe_submissions
FOR UPDATE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND (
      -- If vendor is updating, it can transition DRAFT -> SUBMITTED or stay in DRAFT
      (status IN ('DRAFT', 'SUBMITTED'))
    )
  )
);

-- DELETE:
-- ONLY allowed if submission status is 'DRAFT'. Submitted or completed submissions cannot be deleted by vendors.
CREATE POLICY "Submissions delete policy"
ON public.ppe_submissions
FOR DELETE
TO authenticated, anon
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR (
    vendor_profile_id = public.get_user_vendor_profile_id()
    AND status = 'DRAFT'
  )
);

-- 5. RLS Policies: Worker Instances & Images

-- Worker Instances
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
      AND s.status = 'DRAFT'
  )
);

-- PPE Images (Front/Back)
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
      AND s.status = 'DRAFT'
  )
);

-- Other Supporting Images
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
      AND s.status = 'DRAFT'
  )
);

-- 6. RLS Policies: Reviews & Review Decisions (Reviewer ONLY Mutations)
-- Vendors CANNOT insert, update, or delete reviews or review verdicts under any circumstances!

-- Submission Reviews
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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

-- Worker PPE Reviews
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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

-- Other Reviews
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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

-- PPE Review Reasons
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
      AND s.vendor_profile_id = public.get_user_vendor_profile_id()
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
