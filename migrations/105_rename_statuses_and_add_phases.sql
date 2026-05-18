-- Migration 105: Rename status values + expand to 11-value lifecycle
-- Safe because open_tasks is empty (truncated earlier this session).
-- New schema aligns with the documented Phase/State/Temporal model (task-model.md §2.2.1).

-- Drop the partial unique index that references old status names
DROP INDEX IF EXISTS idx_open_tasks_unique_active;

-- Drop existing status CHECK
ALTER TABLE open_tasks DROP CONSTRAINT IF EXISTS open_tasks_status_check;

-- Backfill any straggler rows (should be zero after truncate; harmless if all empty)
UPDATE open_tasks SET status = 'needs_follow_up' WHERE status = 'needs_reschedule';
UPDATE open_tasks SET status = 'in_scheduling'   WHERE status = 'in_contact_list';
UPDATE open_tasks SET status = 'in_execution'    WHERE status = 'in_visit';

-- Also normalize last_waiting_status (added in migration 102 with old values)
UPDATE open_tasks SET last_waiting_status = 'needs_follow_up' WHERE last_waiting_status = 'needs_reschedule';

-- Add new CHECK with full 11-value lifecycle
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_status_check
  CHECK (status IN (
    'open', 'needs_follow_up',
    'assigned', 'in_scheduling', 'scheduled',
    'waiting_execution', 'in_execution', 'ended',
    'completed', 'closed', 'cancelled'
  ));

-- Recreate the partial unique index with the new status names
-- (keeps one active task per (client, task_type), except for emergency_maintenance which can repeat)
CREATE UNIQUE INDEX idx_open_tasks_unique_active
  ON open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended')
    AND task_type <> 'emergency_maintenance';

-- Also tighten the constraint on last_waiting_status (must be one of the waiting-phase states)
ALTER TABLE open_tasks DROP CONSTRAINT IF EXISTS open_tasks_last_waiting_status_check;
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_last_waiting_status_check
  CHECK (last_waiting_status IS NULL OR last_waiting_status IN ('open', 'needs_follow_up'));
