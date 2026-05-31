-- ============================================================
-- Migration 222: Add origin_type + origin_id + team_responsible_user_id to field_visits
-- ============================================================
-- Constitution source:
--   DEC-003 D3 — origin_type + origin_id (4 base values)
--   DEC-004 D22 — adds 'expected_followup' as 5th origin_type value
--   DEC-007 D47 — team_responsible_user_id snapshot
--
-- Note: customer_snapshot, appointment_booked_at, booked_by_telemarketer_id,
--   telemarketer_notes, answered_by, cancellation_reason_id, cancellation_notes
--   already exist (added by migration 165). Not re-added here.
--
-- Note: visit_family field stays for now (will be deprecated per DEC-003 D4
--   in Phase 9). visit_type CHECK constraint expansion to {marketing, service,
--   mixed} happens in Phase 7 (lifecycle refinement) after data migration.
-- ============================================================

ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS origin_type              VARCHAR(50),
  ADD COLUMN IF NOT EXISTS origin_id                BIGINT,
  ADD COLUMN IF NOT EXISTS team_responsible_user_id INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;

-- ── CHECK constraint for origin_type values (DEC-003 D3 + DEC-004 D22) ─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'field_visits_origin_type_check'
      AND table_name      = 'field_visits'
  ) THEN
    ALTER TABLE field_visits
      ADD CONSTRAINT field_visits_origin_type_check
      CHECK (origin_type IS NULL OR origin_type IN (
        'telemarketing',
        'expected_followup',
        'manual',
        'emergency_request',
        'system'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_field_visits_origin
  ON field_visits(origin_type, origin_id)
  WHERE origin_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_visits_team_responsible
  ON field_visits(team_responsible_user_id)
  WHERE team_responsible_user_id IS NOT NULL;

COMMENT ON COLUMN field_visits.origin_type IS
  'Origin channel per DEC-003 D3 + DEC-004 D22. Required at insert time after Phase 4 (book-visit endpoint goes live).';
COMMENT ON COLUMN field_visits.origin_id IS
  'Reference to source record (call_log id, hr_user id, emergency request id, etc.). Semantics depend on origin_type.';
COMMENT ON COLUMN field_visits.team_responsible_user_id IS
  'Snapshot of the team owner at creation time per DEC-007 D47. Supervisor for TeamSlot, Technician for EmergencySlot.';
