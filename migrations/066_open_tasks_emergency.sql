ALTER TABLE open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_task_type_check;

ALTER TABLE open_tasks
  ADD CONSTRAINT open_tasks_task_type_check
  CHECK (task_type IN ('device_demo', 'emergency_maintenance'));

ALTER TABLE emergency_tickets
  ADD COLUMN IF NOT EXISTS open_task_id INTEGER REFERENCES open_tasks(id);
