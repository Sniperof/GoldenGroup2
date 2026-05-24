-- Migration 151: AP-G006 — contact_target scope = one day
-- Adds a date column to contact_targets so each client can have
-- one contact target per campaign day instead of one forever.

BEGIN;

-- 1. Add date column (nullable initially for backfill)
ALTER TABLE contact_targets ADD COLUMN IF NOT EXISTS date DATE;

-- 2. Backfill existing rows: each old row gets the date it was created
UPDATE contact_targets SET date = DATE(created_at) WHERE date IS NULL;

-- 3. Drop old lifetime-unique constraint
ALTER TABLE contact_targets DROP CONSTRAINT IF EXISTS uq_contact_targets_dedupe;

-- 4. New per-day unique constraint
ALTER TABLE contact_targets
  ADD CONSTRAINT uq_contact_targets_per_day
  UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date);

-- 5. Performance index on date + status for daily queries
CREATE INDEX IF NOT EXISTS idx_contact_targets_date_status
  ON contact_targets(date, status);

COMMIT;
