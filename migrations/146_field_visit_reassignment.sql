-- Migration 146: Team reassignment for field_visits
-- Mirrors migration 112 which added reassigned_* to marketing_visits.
-- Also expands task_activity_log.event_type constraint to include
-- 'team_changed' and 'lifecycle_skip' which are already used in routes
-- but were missing from the original CHECK definition.

BEGIN;

-- 1. Add reassignment columns to field_visits
ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS reassigned_supervisor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_technician_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_trainee_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_team_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS reassigned_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reassigned_by            INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;

-- 2. Expand task_activity_log event_type constraint to include
--    'team_changed' and 'lifecycle_skip' (used in existing routes).
ALTER TABLE task_activity_log
  DROP CONSTRAINT IF EXISTS task_activity_log_event_type_check;

ALTER TABLE task_activity_log
  ADD CONSTRAINT task_activity_log_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'status_change',
    'note_added',
    'rescheduled',
    'assigned',
    'reassigned',
    'call_made',
    'priority_changed',
    'team_assigned',
    'team_changed',
    'lifecycle_skip'
  ]));

COMMIT;
