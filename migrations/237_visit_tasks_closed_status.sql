-- Allow administrative closure of visit tasks after the visit is completed.
ALTER TABLE visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_status_check;

ALTER TABLE visit_tasks
  ADD CONSTRAINT visit_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'not_completed', 'cancelled', 'closed'));
