-- ============================================================
-- 359_service_request_escalation_lock.sql
-- ============================================================
-- Escalation = "restricted mode" for service_requests, mirroring the
-- jobs-recruitment escalation pattern (JR-R009). While a request is
-- escalated, every mutating action is blocked except two exits:
--   - resolve-escalation (فك التصعيد) — Audit Admin only
--   - reject             — Audit Admin only
--
-- A dedicated marker is required because review_required_flag is already
-- overloaded (auto-set by duplicate detection and branch resolution), so
-- it cannot mean "frozen / awaiting Audit Admin decision" on its own.
--
-- The marker is cleared when the request leaves the frozen situation:
--   - resolve-escalation clears it, or
--   - any terminal transition clears it (see stateMachine.ts).
-- ============================================================

BEGIN;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS escalated_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_by_user_id    INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_reason       TEXT;

-- Fast lookup of currently-frozen requests (the blocking guard reads this).
CREATE INDEX IF NOT EXISTS service_requests_escalated_active_idx
  ON public.service_requests (escalated_at)
  WHERE escalated_at IS NOT NULL;

COMMENT ON COLUMN public.service_requests.escalated_at IS
  'When set, the request is in restricted mode: all mutating actions are blocked except resolve-escalation and reject (both Audit Admin only). Cleared on de-escalation or any terminal transition. See SR-ESC-01/02.';

COMMENT ON COLUMN public.service_requests.escalated_by_user_id IS
  'Operator/reviewer who raised the escalation.';

COMMENT ON COLUMN public.service_requests.escalation_reason IS
  'Structured/free-text reason captured when the request was escalated.';

-- Allow the new de-escalation audit event on the audit-log CHECK constraint
-- (mirrors SR_AUDIT_EVENT_TYPES in _shared.ts). Rebuild the constraint with
-- the full list + 'escalation_resolved'.
ALTER TABLE public.service_request_audit_log
  DROP CONSTRAINT IF EXISTS service_request_audit_log_event_type_check;

ALTER TABLE public.service_request_audit_log
  ADD CONSTRAINT service_request_audit_log_event_type_check
  CHECK (event_type IN (
    'request_created',
    'status_changed',
    'claimed_by_operator',
    'claim_transferred',
    'review_required_flag_set',
    'duplicate_flag_set',
    'party_linked',
    'linkage_changed',
    'candidate_created',
    'priority_changed',
    'escalated_to_audit_admin',
    'escalation_resolved',
    'rejected_decision',
    'promoted_to_task',
    'merged_into_existing_task',
    'cancelled_by_admin',
    'customer_info_requested',
    'customer_info_received',
    'internal_note_added',
    'archived',
    'unarchived',
    'request_reopened',
    'problem_added',
    'problem_edited',
    'problem_status_changed',
    'problem_resolution_recorded',
    'problem_soft_deleted',
    'problem_restored',
    'problem_audit_admin_override'
  ));

COMMIT;
