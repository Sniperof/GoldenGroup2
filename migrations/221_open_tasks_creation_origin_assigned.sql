-- ============================================================
-- Migration 221: Add creation_origin + assigned_* + expected_time to open_tasks
-- ============================================================
-- Constitution source:
--   DEC-004 D13 — creation_origin (7 values), assigned_by/at/via
--   DEC-004 D22 — expected_time
--
-- Conservative Additive strategy (per Phase 1 decision option A):
--   Old fields `source`, `origin`, `origin_ref_id` REMAIN in place (they are
--   used by UI: TaskCreationCard, TaskHeader "مشتقّة من #X", planningMarketingTargets).
--   They will be re-evaluated for DROP in Phase 9 (Legacy Removal).
--   This migration is purely additive + backfills creation_origin from source.
--
-- creation_origin mapping (from legacy `source` values observed in
--   packages/web/src/components/tasks/cards/TaskCreationCard.tsx SOURCE_LABELS):
--     manual          → manual_creation
--     system          → system_trigger
--     system_auto     → system_trigger
--     telemarketing   → telemarketing_inline_booking
--     follow_up_task  → cascading_during_visit
--     emergency_ticket→ emergency_request
--   Unknown / NULL    → manual_creation (safest default for existing rows)
-- ============================================================

ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS creation_origin VARCHAR(50),
  ADD COLUMN IF NOT EXISTS assigned_by     INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_via    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS expected_time   VARCHAR(50);

-- ── Backfill creation_origin from legacy source values ──────────────────────
UPDATE open_tasks
   SET creation_origin = CASE source
     WHEN 'manual'           THEN 'manual_creation'
     WHEN 'system'           THEN 'system_trigger'
     WHEN 'system_auto'      THEN 'system_trigger'
     WHEN 'telemarketing'    THEN 'telemarketing_inline_booking'
     WHEN 'follow_up_task'   THEN 'cascading_during_visit'
     WHEN 'emergency_ticket' THEN 'emergency_request'
     ELSE 'manual_creation'
   END
 WHERE creation_origin IS NULL;

-- ── CHECK constraint enforcing DEC-004 D13 vocabulary ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'open_tasks_creation_origin_check'
      AND table_name      = 'open_tasks'
  ) THEN
    ALTER TABLE open_tasks
      ADD CONSTRAINT open_tasks_creation_origin_check
      CHECK (creation_origin IS NULL OR creation_origin IN (
        'branch_plan',
        'service_request_call',
        'telemarketing_inline_booking',
        'cascading_during_visit',
        'manual_creation',
        'emergency_request',
        'system_trigger'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'open_tasks_assigned_via_check'
      AND table_name      = 'open_tasks'
  ) THEN
    ALTER TABLE open_tasks
      ADD CONSTRAINT open_tasks_assigned_via_check
      CHECK (assigned_via IS NULL OR assigned_via IN (
        'planning_calculation',
        'telemarketing_booking',
        'manual_override',
        'cascading'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_open_tasks_creation_origin
  ON open_tasks(creation_origin);
CREATE INDEX IF NOT EXISTS idx_open_tasks_assigned_by
  ON open_tasks(assigned_by) WHERE assigned_by IS NOT NULL;

COMMENT ON COLUMN open_tasks.source IS
  'DEPRECATED (DEC-004 D13): use creation_origin. Retained for legacy readers (TaskCreationCard, planningMarketingTargets) until Phase 9.';
COMMENT ON COLUMN open_tasks.origin IS
  'DEPRECATED (DEC-004 D13): subsumed by creation_origin. Always "manual_entry" in current writes. Drop in Phase 9.';
COMMENT ON COLUMN open_tasks.origin_ref_id IS
  'Retained: backs the "مشتقّة من #X" UI hint in TaskHeader. Not covered by constitution; kept for operational value.';
COMMENT ON COLUMN open_tasks.creation_origin IS
  'Canonical task-creation origin per DEC-004 D13. 7 values enumerated by check constraint.';
COMMENT ON COLUMN open_tasks.assigned_via IS
  'How this task moved into assigned state per DEC-004 D13 (planning_calculation | telemarketing_booking | manual_override | cascading).';
