-- Migration: Ensure explicit UNIQUE constraint on files (storage_provider, provider_file_id)
-- Complements existing idx_files_provider_file unique index for PostgREST upsert compatibility.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_files_provider_file'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT uq_files_provider_file UNIQUE (storage_provider, provider_file_id);
  END IF;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
