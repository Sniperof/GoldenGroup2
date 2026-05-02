-- Sprint 4: Link open_tasks through the appointment → marketing_visit chain

ALTER TABLE telemarketing_appointments
  ADD COLUMN IF NOT EXISTS open_task_id INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL;

ALTER TABLE marketing_visit_tasks
  ADD COLUMN IF NOT EXISTS source_open_task_id INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL;
