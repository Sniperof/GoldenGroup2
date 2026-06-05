-- ============================================================
-- 241_service_request_audit_log.sql
-- ============================================================
-- Phase 0.3 — Append-only audit log for service_requests.
--
-- Per maintenance.md §٠.١٧:
--   - Records every status transition + every decision.
--   - DB-level triggers enforce append-only (no UPDATE, no DELETE).
--   - 21 canonical event types — extended in §٠.١٩.و with 7 problem events.
--   - actor_role ∈ {operator, audit_admin, system, customer}.
--
-- Pattern follows task_activity_log + client_audit_log (existing).
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.١٧, §٠.١٩.و
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_request_audit_log (
    id                    BIGSERIAL PRIMARY KEY,
    service_request_id    BIGINT NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
    event_type            VARCHAR(50) NOT NULL,
    event_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id         INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    actor_role            VARCHAR(50) NOT NULL,
    note                  TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT service_request_audit_log_event_type_check
      CHECK (event_type IN (
        -- Core lifecycle (٠.١٧)
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
        -- Problem events (٠.١٩.و)
        'problem_added',
        'problem_edited',
        'problem_status_changed',
        'problem_resolution_recorded',
        'problem_soft_deleted',
        'problem_restored',
        'problem_audit_admin_override'
      )),

    CONSTRAINT service_request_audit_log_actor_role_check
      CHECK (actor_role IN ('operator', 'audit_admin', 'system', 'customer'))
);

CREATE INDEX IF NOT EXISTS service_request_audit_log_request_created_idx
  ON public.service_request_audit_log (service_request_id, created_at);

CREATE INDEX IF NOT EXISTS service_request_audit_log_event_type_idx
  ON public.service_request_audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS service_request_audit_log_actor_idx
  ON public.service_request_audit_log (actor_user_id, created_at DESC);

-- Append-only enforcement: block UPDATE and DELETE at the DB level.
CREATE OR REPLACE FUNCTION public.tg_service_request_audit_log_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'service_request_audit_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_request_audit_log_no_update ON public.service_request_audit_log;
CREATE TRIGGER service_request_audit_log_no_update
  BEFORE UPDATE ON public.service_request_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_request_audit_log_block_mutation();

DROP TRIGGER IF EXISTS service_request_audit_log_no_delete ON public.service_request_audit_log;
CREATE TRIGGER service_request_audit_log_no_delete
  BEFORE DELETE ON public.service_request_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_request_audit_log_block_mutation();

COMMENT ON TABLE public.service_request_audit_log IS
  'Append-only audit log for service_requests. UPDATE/DELETE blocked at DB level. See maintenance.md §٠.١٧ + §٠.١٩.و.';

COMMENT ON COLUMN public.service_request_audit_log.actor_role IS
  'Role snapshot at event time. system = cron/auto-cancel, customer = future external channels.';

COMMIT;
