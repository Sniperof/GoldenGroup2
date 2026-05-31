-- ============================================================
-- Migration 224: contact_targets grain v2 + rename latest_appointment_id
-- ============================================================
-- Constitution source:
--   DEC-004 D23 — rename latest_appointment_id → latest_visit_id + FK to field_visits
--   DEC-005 D26 — closing_reason, closed_by, closed_at, team_key
--   DEC-005 D27 — work_location_geo_unit_id (grain change)
--
-- Strategy:
--   - work_location_geo_unit_id is nullable for now. UNIQUE constraint update
--     to include it is DEFERRED to Phase 5 (after backfill in Phase 4/5).
--   - target_stage and source_type DROP is DEFERRED to Phase 9 (Legacy Removal),
--     per DEC-005 D30. They are unused but still constrained by NOT NULL CHECK
--     ('lead'); changing that here would risk breaking unknown legacy inserts.
--   - latest_appointment_id (INTEGER, no FK currently) → latest_visit_id
--     (INTEGER, FK to field_visits(id) ON DELETE SET NULL). Old name kept as
--     a generated column would be ideal but Postgres doesn't allow renames
--     with FK swap atomically in a single ALTER; we use RENAME + ADD FK.
-- ============================================================

-- ── 1. Rename latest_appointment_id → latest_visit_id (DEC-004 D23) ───────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contact_targets'
      AND column_name = 'latest_appointment_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contact_targets'
      AND column_name = 'latest_visit_id'
  ) THEN
    ALTER TABLE contact_targets RENAME COLUMN latest_appointment_id TO latest_visit_id;
  END IF;
END $$;

-- Ensure the column exists (defensive — in case migration runs on a fresh DB)
ALTER TABLE contact_targets
  ADD COLUMN IF NOT EXISTS latest_visit_id INTEGER;

-- ── 2. Attach FK to field_visits (was unconstrained INTEGER) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_contact_targets_latest_visit'
       AND table_name      = 'contact_targets'
  ) THEN
    ALTER TABLE contact_targets
      ADD CONSTRAINT fk_contact_targets_latest_visit
      FOREIGN KEY (latest_visit_id) REFERENCES field_visits(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Add closing fields (DEC-005 D26) ────────────────────────────────────
ALTER TABLE contact_targets
  ADD COLUMN IF NOT EXISTS closing_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS closed_by      INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS team_key       VARCHAR(50);

-- closing_reason values per DEC-005 D26 (enforced softly via comment only;
-- hard CHECK deferred until Phase 5 when backend writes start populating it)
COMMENT ON COLUMN contact_targets.closing_reason IS
  'DEC-005 D26 vocabulary: booked | manual_telemarketer | manual_supervisor | auto_closed_by_cron | cooldown_set.';
COMMENT ON COLUMN contact_targets.closed_by IS
  'hr_users.id who closed the target. NULL for auto_closed_by_cron.';
COMMENT ON COLUMN contact_targets.closed_at IS
  'Timestamp of closure. NULL while status != closed.';
COMMENT ON COLUMN contact_targets.team_key IS
  'Snapshot of team_key (from day_schedule) that owned this target. Helps cross-team awareness queries (DEC-005 D28).';

-- ── 4. Add work_location_geo_unit_id (DEC-005 D27) ─────────────────────────
ALTER TABLE contact_targets
  ADD COLUMN IF NOT EXISTS work_location_geo_unit_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN contact_targets.work_location_geo_unit_id IS
  'Work location grain per DEC-005 D27. Computed from task_type_config.location_basis: client → client geo_unit, device → installed_device.installation_geo_unit_id. Backfill + UNIQUE constraint update deferred to Phase 5.';

CREATE INDEX IF NOT EXISTS idx_contact_targets_work_location
  ON contact_targets(work_location_geo_unit_id)
  WHERE work_location_geo_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_targets_latest_visit
  ON contact_targets(latest_visit_id)
  WHERE latest_visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_targets_closed_at
  ON contact_targets(closed_at)
  WHERE closed_at IS NOT NULL;
