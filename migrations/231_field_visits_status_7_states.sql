-- ============================================================
-- Migration 231: field_visits.status — collapse to 7 states (DEC-004 D18)
-- ============================================================
-- Constitution source:
--   DEC-004 D18 — lifecycle simplified to 7 states. The 3 legacy "reschedule"
--                 statuses are removed; rescheduling becomes a task-level
--                 concept via last_waiting_status (D10) + expected_date (D22).
--   DEC-004 D11 — `closed` becomes an explicit admin-lock state after
--                 completed/not_completed. Reopen requires field_visits.reopen_closed.
--
-- Step 1: backfill the obsolete statuses to their nearest valid equivalent.
--   postponed_by_company   → cancelled  (the visit never executed)
--   postponed_by_customer  → cancelled
--   needs_reschedule       → cancelled
--   Rationale (D10): the open_task itself returns to last_waiting_status and
--   can be re-booked later via Schedule-from-Expected (D22).
--
-- Step 2: swap the CHECK constraint to the 7 canonical states.
-- ============================================================

BEGIN;

-- Step 1: backfill legacy statuses
UPDATE field_visits
   SET status     = 'cancelled',
       updated_at = NOW()
 WHERE status IN ('postponed_by_company', 'postponed_by_customer', 'needs_reschedule');

-- Step 2: swap CHECK constraint
ALTER TABLE field_visits
  DROP CONSTRAINT IF EXISTS field_visits_status_check;

ALTER TABLE field_visits
  ADD CONSTRAINT field_visits_status_check
  CHECK (status IN (
    'scheduled',
    'in_progress',
    'ended',
    'completed',
    'not_completed',
    'cancelled',
    'closed'
  ));

COMMIT;
