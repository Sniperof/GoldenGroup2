-- ============================================================
-- Migration 223: Add started_by + ended_by + location_missing_reason to visit_geo_logs
-- ============================================================
-- Constitution source:
--   DEC-004 D17 — GPS إلزامي مع location_missing استثناء صريح
--
-- Note: visit_geo_logs.location_missing BOOLEAN already exists (migration 081).
--   We add the structured reason here. Reason is required iff location_missing
--   = TRUE; this CHECK is enforced via DO block to remain idempotent.
--
-- location_missing_reason references system_lists category 'location_missing_reasons'
-- (seeded with 'أخرى' in migration 218; full values pending P-DEC006-01).
-- ============================================================

ALTER TABLE visit_geo_logs
  ADD COLUMN IF NOT EXISTS started_by              INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ended_by                INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_missing_reason INTEGER REFERENCES system_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_visit_geo_logs_location_missing_reason
  ON visit_geo_logs(location_missing_reason)
  WHERE location_missing_reason IS NOT NULL;

COMMENT ON COLUMN visit_geo_logs.started_by IS
  'hr_users.id who triggered POST /field-visits/:id/start (DEC-004 D17).';
COMMENT ON COLUMN visit_geo_logs.ended_by IS
  'hr_users.id who triggered POST /field-visits/:id/end (DEC-004 D17).';
COMMENT ON COLUMN visit_geo_logs.location_missing_reason IS
  'Required when location_missing = TRUE. Reference to system_lists category=location_missing_reasons (DEC-004 D17). Enforcement at application layer until Phase 7 lifecycle refinement.';
