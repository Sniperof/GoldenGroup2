BEGIN;

-- The active do-not-contact flag stays on clients for fast eligibility checks.
-- This append-only ledger records who changed the permanent customer-wide
-- contact decision and why, including planning-dashboard bulk operations.
CREATE TABLE IF NOT EXISTS public.client_contact_control_events (
    id BIGSERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL
        REFERENCES public.clients(id) ON DELETE RESTRICT,
    branch_id INTEGER
        REFERENCES public.branches(id) ON DELETE RESTRICT,
    control_type VARCHAR(30) NOT NULL,
    action VARCHAR(20) NOT NULL,
    reason_code VARCHAR(50) NOT NULL DEFAULT 'manual',
    reason_text TEXT,
    operation_id BIGINT
        REFERENCES public.planning_curation_operations(id) ON DELETE RESTRICT,
    performed_by INTEGER
        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT client_contact_control_events_type_check
        CHECK (control_type IN ('do_not_contact')),
    CONSTRAINT client_contact_control_events_action_check
        CHECK (action IN ('enabled', 'disabled'))
);

CREATE INDEX IF NOT EXISTS client_contact_control_events_client_history_idx
    ON public.client_contact_control_events (client_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS client_contact_control_events_branch_day_idx
    ON public.client_contact_control_events (branch_id, created_at DESC);

-- Preserve the pre-ledger state without inventing an actor or an original
-- decision timestamp. Rerunning the migration cannot duplicate this baseline.
INSERT INTO public.client_contact_control_events (
    client_id,
    branch_id,
    control_type,
    action,
    reason_code,
    reason_text,
    operation_id,
    performed_by
)
SELECT
    c.id,
    c.branch_id,
    'do_not_contact',
    'enabled',
    'legacy_state_baseline',
    'Baseline imported when the contact-control audit ledger was introduced',
    NULL,
    NULL
FROM public.clients c
WHERE c.do_not_contact IS TRUE
  AND NOT EXISTS (
      SELECT 1
      FROM public.client_contact_control_events existing_event
      WHERE existing_event.client_id = c.id
        AND existing_event.control_type = 'do_not_contact'
  );

COMMENT ON TABLE public.client_contact_control_events IS
    'Append-only audit of permanent customer-wide contact controls. The live eligibility flag remains clients.do_not_contact.';

COMMENT ON COLUMN public.contact_targets.closing_reason IS
    'DEC-005 vocabulary: booked | manual_telemarketer | manual_supervisor | auto_closed_by_cron | cooldown_set | do_not_contact.';

COMMIT;
