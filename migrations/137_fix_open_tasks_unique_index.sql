-- Migration 137: Fix open_tasks unique-active index for current status names
--
-- Context: migration 055 created idx_open_tasks_unique_active using old status names
-- (needs_reschedule, in_contact_list, in_visit). Migration 105 renamed all statuses.
-- The index now covers statuses that no longer exist → constraint is effectively dead,
-- allowing duplicate device_demo tasks per client.
--
-- New rule: at most ONE active device_demo task per client in the **waiting phase**
-- (open, needs_follow_up). Planning and execution phases are allowed to overlap
-- temporarily during rescheduling flows. emergency_maintenance is still excluded.

DROP INDEX IF EXISTS idx_open_tasks_unique_active;

CREATE UNIQUE INDEX idx_open_tasks_unique_active
  ON open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type != 'emergency_maintenance';
