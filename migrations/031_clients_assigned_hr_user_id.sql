-- ============================================================
-- Migration 031: Explicit clients ownership via assigned_hr_user_id
-- - Adds a nullable ownership field that points to hr_users.id
-- - Keeps legacy rows unassigned (NULL) unless assigned explicitly later
-- - No speculative backfill in this phase
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS assigned_hr_user_id INTEGER NULL
  REFERENCES hr_users(id) ON DELETE SET NULL;

-- Verification query (manual):
-- SELECT column_name, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'clients'
--    AND column_name = 'assigned_hr_user_id';
