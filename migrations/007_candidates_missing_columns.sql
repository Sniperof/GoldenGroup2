-- ============================================================
-- Migration 007: Add missing columns to candidates table
--
-- The candidates table was created from an older schema revision
-- that predated contacts, geo_unit_id, and occupation columns.
-- Migration 001 was a no-op (table already existed), and these
-- columns were not included in migration 004's ALTER list.
-- ============================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS contacts  JSONB DEFAULT '[]';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS geo_unit_id INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS occupation  VARCHAR(255);

-- Fix stale status CHECK: old constraint only allowed
-- ('New','Contacted','Qualified','Junk') but the code also uses
-- 'Suggested' and 'FollowUp'.
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_status_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'candidates_status_check'
      AND table_name = 'candidates'
  ) THEN
    ALTER TABLE candidates
      ADD CONSTRAINT candidates_status_check
      CHECK (status IN ('New', 'Suggested', 'FollowUp', 'Contacted', 'Qualified', 'Junk'));
  END IF;
END $$;
