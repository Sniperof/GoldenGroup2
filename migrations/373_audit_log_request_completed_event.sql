-- 373_audit_log_request_completed_event.sql
-- ============================================================
-- DEC-013 — the shared state machine now emits `request_completed` when a
-- request reaches the `completed` terminal (account_creation link-and-activate).
-- Extend the audit-log event_type CHECK to allow it. Rebuilds the full list
-- from 359 plus the new event.
-- ============================================================

BEGIN;

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
    'request_completed',
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
