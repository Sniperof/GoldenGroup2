-- ============================================================
-- 368_service_requests_completed_status.sql
-- ============================================================
-- Phase 4 (DEC-013 §4) — add the general self-completion terminal
-- `completed` to the service_requests status CHECK.
--
-- Additive: existing types never produce `completed` (their state machine
-- is unchanged). Only the account_creation link path sets it, via a direct
-- update in adminAccountRequestService (NOT the generic stateMachine, whose
-- terminal-outcome lists are emergency/water specific).
-- ============================================================

BEGIN;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_status_check;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_status_check
    CHECK (status IN (
      'received', 'in_review', 'awaiting_customer_info',
      'resolved_at_intake', 'rejected', 'promoted', 'cancelled',
      'completed'
    ));

COMMIT;
