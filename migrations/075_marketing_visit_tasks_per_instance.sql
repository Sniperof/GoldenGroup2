-- Migration 075: Allow multiple same-type tasks in one marketing visit
--
-- Previously uq_marketing_visit_tasks_visit_task enforced (visit_id, task_type)
-- uniqueness, which silently dropped duplicate-type tasks via ON CONFLICT DO NOTHING.
-- Now row identity is anchored to source_open_task_id instead.

ALTER TABLE marketing_visit_tasks
  DROP CONSTRAINT IF EXISTS uq_marketing_visit_tasks_visit_task;

-- Each open_task can appear at most once per visit (partial: only when linked).
-- Rows without a source_open_task_id are identity-stable by their primary key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_visit_tasks_open_task
  ON marketing_visit_tasks(visit_id, source_open_task_id)
  WHERE source_open_task_id IS NOT NULL;
