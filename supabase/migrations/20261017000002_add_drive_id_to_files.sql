-- Migration: Add drive_id column to files table to explicitly store and display Google Drive File ID
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'files' 
      AND column_name = 'drive_id'
  ) THEN
    ALTER TABLE public.files ADD COLUMN drive_id VARCHAR(500);
  END IF;
END $$;

-- Backfill drive_id with provider_file_id for existing rows
UPDATE public.files 
SET drive_id = provider_file_id 
WHERE drive_id IS NULL AND provider_file_id IS NOT NULL;
