BEGIN;

-- Administrative visit closure writes field_visits.status = 'closed'.
-- The baseline schema allowed it, but later staging constraint drift omitted it,
-- causing POST /field-visits/:id/close to fail with field_visits_status_check.
ALTER TABLE public.field_visits
  DROP CONSTRAINT IF EXISTS field_visits_status_check;

ALTER TABLE public.field_visits
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
    'needs_reschedule',
    'closed'
  ));

COMMIT;
