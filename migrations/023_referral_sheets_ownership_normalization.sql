-- ============================================================
-- Migration 023: Referral sheets ownership normalization
-- - Adds a dedicated security ownership field for hr_users
-- - Keeps the legacy owner_user_id field untouched
-- ============================================================

ALTER TABLE referral_sheets
  ADD COLUMN IF NOT EXISTS assigned_hr_user_id INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referral_sheets_assigned_hr_user_id
  ON referral_sheets(assigned_hr_user_id);

-- No automatic backfill is performed here on purpose.
-- owner_user_id is currently semantically ambiguous:
--   - it has no FK to hr_users
--   - runtime writes accept arbitrary ownerUserId values from the client
--   - the same numeric id could overlap across hr_users, employees, or other entities
-- Therefore assigned_hr_user_id remains NULL until an explicit, audited assignment
-- path is introduced in a later phase.
