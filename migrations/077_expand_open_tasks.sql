-- Migration 077: Expand open_tasks for general task model

ALTER TABLE open_tasks ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'manual_entry';
ALTER TABLE open_tasks ADD COLUMN IF NOT EXISTS origin_ref_id INTEGER;
ALTER TABLE open_tasks ADD COLUMN IF NOT EXISTS assigned_scope_id INTEGER;
ALTER TABLE open_tasks ADD COLUMN IF NOT EXISTS assigned_team_key VARCHAR(50);

-- Expand task_family constraint to include 'emergency'
ALTER TABLE open_tasks DROP CONSTRAINT IF EXISTS open_tasks_task_family_check;
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_task_family_check
    CHECK (task_family IN ('marketing', 'service', 'maintenance', 'emergency'));

-- Backfill task_family for existing emergency tasks
UPDATE open_tasks SET task_family = 'emergency' WHERE task_type = 'emergency_maintenance';
