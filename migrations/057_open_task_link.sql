ALTER TABLE telemarketing_task_list_items
  ADD COLUMN IF NOT EXISTS open_task_id INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL;
