-- Migration 071: Add 'ended' to field_visits.status
-- 'ended' = field work finished but not all visit_tasks are resolved yet.
-- 'completed' = all visit_tasks have recorded final results.
-- This separation is meaningful for multi-task visits; for single-task visits
-- the transition ended→completed is immediate.

ALTER TABLE field_visits DROP CONSTRAINT field_visits_status_check;

ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_status_check
  CHECK (status IN (
    'scheduled',
    'in_progress',
    'ended',
    'completed',
    'not_completed',
    'postponed_by_company',
    'postponed_by_customer',
    'cancelled',
    'needs_reschedule'
  ));
