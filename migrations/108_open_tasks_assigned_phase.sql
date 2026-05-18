-- 108_open_tasks_assigned_phase.sql
-- Adds daily assignment metadata for the planning gate.

BEGIN;

ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS assigned_for_date DATE,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluded_for_date DATE,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

CREATE INDEX IF NOT EXISTS open_tasks_assigned_daily_idx
  ON open_tasks (assigned_team_key, assigned_for_date, status)
  WHERE status = 'assigned';

CREATE INDEX IF NOT EXISTS open_tasks_excluded_for_date_idx
  ON open_tasks (excluded_for_date)
  WHERE excluded_for_date IS NOT NULL;

COMMIT;
