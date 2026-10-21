-- ==============================================================================
-- PPEye Migration: Create Dedicated Service Log & Audit Tables
-- Migration: 20261022000002_create_service_log_tables.sql
--
-- Adds 2 standalone tables for observability and audit trails:
-- 1. storage_operations_log (supabase_storage_service operations)
-- 2. database_service_logs  (supabase_database_service & coordinator operations)
-- ==============================================================================

-- 1. Storage Operations Log Table
CREATE TABLE IF NOT EXISTS public.storage_operations_log (
  id BIGSERIAL PRIMARY KEY,
  operation VARCHAR(32) NOT NULL, -- 'UPLOAD', 'DOWNLOAD', 'SIGNED_URL', 'DELETE', 'CLEANUP'
  bucket VARCHAR(64) NOT NULL,    -- 'evidence', 'avatars'
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT,
  mime_type VARCHAR(128),
  performed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED', 'RETRYING'
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.storage_operations_log IS 'Audit log of all storage operations processed by supabase_storage_service';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_storage_ops_created_at ON public.storage_operations_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_ops_performed_by ON public.storage_operations_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_storage_ops_bucket_op ON public.storage_operations_log(bucket, operation);

-- Enable RLS on storage_operations_log
ALTER TABLE public.storage_operations_log ENABLE ROW LEVEL SECURITY;

-- Storage Logs RLS: Internal staff see all; external users see their own logs
DROP POLICY IF EXISTS "Storage logs select policy" ON public.storage_operations_log;
CREATE POLICY "Storage logs select policy"
ON public.storage_operations_log
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR performed_by = public.current_app_user_id()
);

-- Storage Logs RLS: Authenticated users can insert log entries for their own actions
DROP POLICY IF EXISTS "Storage logs insert policy" ON public.storage_operations_log;
CREATE POLICY "Storage logs insert policy"
ON public.storage_operations_log
FOR INSERT
TO authenticated
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR performed_by = public.current_app_user_id()
  OR performed_by IS NULL
);


-- 2. Database Service Logs Table
CREATE TABLE IF NOT EXISTS public.database_service_logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(64) NOT NULL, -- 'CREATE_SUBMISSION', 'CREATE_WORKER', 'LINK_PPE_IMAGE', 'REVIEW_DECISION', etc.
  entity_type VARCHAR(64) NOT NULL, -- 'ppe_submissions', 'ppe_worker_instances', 'files', 'ppe_reviews'
  entity_id TEXT,
  performed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED'
  payload JSONB DEFAULT '{}'::jsonb,
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.database_service_logs IS 'Audit log of high-level database and coordinator mutations from supabase_database_service';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_db_logs_created_at ON public.database_service_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_logs_performed_by ON public.database_service_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_db_logs_action ON public.database_service_logs(action);
CREATE INDEX IF NOT EXISTS idx_db_logs_entity ON public.database_service_logs(entity_type, entity_id);

-- Enable RLS on database_service_logs
ALTER TABLE public.database_service_logs ENABLE ROW LEVEL SECURITY;

-- Database Logs RLS: Internal staff see all; external users see their own logs
DROP POLICY IF EXISTS "Database logs select policy" ON public.database_service_logs;
CREATE POLICY "Database logs select policy"
ON public.database_service_logs
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR performed_by = public.current_app_user_id()
);

-- Database Logs RLS: Authenticated users can insert log entries for their actions
DROP POLICY IF EXISTS "Database logs insert policy" ON public.database_service_logs;
CREATE POLICY "Database logs insert policy"
ON public.database_service_logs
FOR INSERT
TO authenticated
WITH CHECK (
  auth.role() = 'service_role'
  OR public.is_internal_user()
  OR performed_by = public.current_app_user_id()
  OR performed_by IS NULL
);
