-- Migration 069: Fix unique constraint to allow multiple emergency tickets per client
-- The idx_open_tasks_unique_active constraint prevents duplicate open tasks
-- for the same client+task_type. This is correct for marketing (device_demo)
-- but WRONG for emergency_maintenance — a client can have multiple emergencies.

DROP INDEX IF EXISTS idx_open_tasks_unique_active;

CREATE UNIQUE INDEX idx_open_tasks_unique_active
ON open_tasks(client_id, task_type)
WHERE status::text = ANY(ARRAY['open', 'in_contact_list', 'scheduled', 'in_visit', 'needs_reschedule']::text[])
  AND task_type != 'emergency_maintenance';
