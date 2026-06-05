-- ============================================================
-- 240_service_requests_table.sql
-- ============================================================
-- Phase 0.2 — Create the central service_requests entity.
--
-- service_requests is the GLOBAL intake layer that precedes
-- open_tasks for emergency_maintenance (V1.0 scope: internal
-- channels only; external channels reserved schema-wise).
--
-- Schema follows maintenance.md §٠.٧ verbatim:
--   - 7 channels (CHECK)
--   - 6 status states (CHECK) — ٠.٣
--   - submission_type {apply, refer_a_candidate}
--   - submitter_tier {visitor, lead, fop, op, staff}
--   - device_source {company_device, external_device}
--   - public_ref_number SR-YYYYMMDD-NNNN (UNIQUE partial)
--   - Audit-Admin-only reject path columns
--   - Three flags (٠.١٥): duplicate, review_required, archived
--   - Indexes per ٠.٧
--
-- This migration creates the schema only. No code reads or
-- writes to this table yet (Phase 2+ deliverables).
--
-- FK targets verified to exist in 001_initial_schema.sql:
--   clients, candidates, hr_users, installed_devices,
--   contracts, emergency_action_types, open_tasks, branches.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.٧
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_requests (
    id                          BIGSERIAL PRIMARY KEY,

    -- Public-facing reference (SR-YYYYMMDD-NNNN) — ٠.٧.أ
    public_ref_number           VARCHAR(20) NOT NULL,

    -- Channel & source (immutable after received per SR-R008)
    channel                     VARCHAR(30) NOT NULL,
    application_source          VARCHAR(100),

    -- Three parties (٠.١٢)
    requester_user_id           INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    requester_external          JSONB,
    beneficiary_client_id       INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
    beneficiary_candidate_id    INTEGER REFERENCES public.candidates(id) ON DELETE SET NULL,
    beneficiary_external        JSONB,
    referrer_user_id            INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    referrer_external           JSONB,
    submission_type             VARCHAR(20) NOT NULL DEFAULT 'apply',

    -- Submitter tier snapshot (٠.١١)
    submitter_tier              VARCHAR(20) NOT NULL DEFAULT 'staff',

    -- Contract & device
    contract_id                 INTEGER REFERENCES public.contracts(id) ON DELETE SET NULL,
    device_source               VARCHAR(20),
    installed_device_id         INTEGER REFERENCES public.installed_devices(id) ON DELETE SET NULL,
    external_device_name        VARCHAR(255),
    external_device_serial      VARCHAR(100),

    -- Immutable customer-submitted data (SR-R008)
    problem_description         TEXT NOT NULL,
    requested_action_type_id    INTEGER REFERENCES public.emergency_action_types(id) ON DELETE SET NULL,
    attachments                 JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Service address snapshot (٠.١٤)
    service_address             JSONB,

    -- Triage & status
    priority                    VARCHAR(20),
    status                      VARCHAR(30) NOT NULL DEFAULT 'received',
    reviewed_by_user_id         INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    claimed_at                  TIMESTAMPTZ,
    triage_outcome              VARCHAR(50),
    triage_notes                TEXT,
    linked_open_task_id         INTEGER REFERENCES public.open_tasks(id) ON DELETE SET NULL,
    expected_callback_at        TIMESTAMPTZ,

    -- Flags (٠.١٥)
    duplicate_flag              BOOLEAN NOT NULL DEFAULT FALSE,
    duplicate_of_request_id     BIGINT REFERENCES public.service_requests(id) ON DELETE SET NULL,
    review_required_flag        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Rejection (Audit Admin only)
    rejected_by_user_id         INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    rejection_reason            VARCHAR(100),

    -- Soft archive (SR-R010)
    archived_at                 TIMESTAMPTZ,
    archived_by_user_id         INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,

    -- Reopen (SR-REOPEN-04)
    reopen_count                INTEGER NOT NULL DEFAULT 0,
    last_reopened_at            TIMESTAMPTZ,

    -- Scope & timing
    branch_id                   INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at                   TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- CHECK constraints
    CONSTRAINT service_requests_channel_check
      CHECK (channel IN (
        'phone', 'internal_button', 'client_detail_button', 'admin_manual',
        'mobile_app', 'website', 'whatsapp'
      )),

    CONSTRAINT service_requests_status_check
      CHECK (status IN (
        'received', 'in_review', 'awaiting_customer_info',
        'resolved_at_intake', 'rejected', 'promoted', 'cancelled'
      )),

    CONSTRAINT service_requests_submission_type_check
      CHECK (submission_type IN ('apply', 'refer_a_candidate')),

    CONSTRAINT service_requests_submitter_tier_check
      CHECK (submitter_tier IN ('visitor', 'lead', 'fop', 'op', 'staff')),

    CONSTRAINT service_requests_device_source_check
      CHECK (device_source IS NULL OR device_source IN ('company_device', 'external_device')),

    CONSTRAINT service_requests_priority_check
      CHECK (priority IS NULL OR priority IN ('Critical', 'High', 'Normal', 'Low')),

    CONSTRAINT service_requests_triage_outcome_check
      CHECK (triage_outcome IS NULL OR triage_outcome IN (
        -- resolved_at_intake outcomes
        'resolved_by_advice', 'customer_self_fixed', 'false_alarm', 'info_clarified_no_issue',
        -- rejected outcomes
        'duplicate', 'invalid_request', 'spam', 'out_of_scope', 'unverified_caller', 'device_not_company',
        -- promoted outcome (single driver)
        'needs_field_intervention',
        -- cancelled outcomes
        'data_entry_error', 'customer_withdrew_via_support', 'redundant_with_existing_task', 'customer_no_response'
      ))
);

-- Partial UNIQUE on public_ref_number — allows theoretical reuse after archive
-- (rejected operationally, but DB doesn't block it). Per SR-REF-05.
CREATE UNIQUE INDEX IF NOT EXISTS service_requests_public_ref_unique_active
  ON public.service_requests (public_ref_number)
  WHERE archived_at IS NULL;

-- Index set per ٠.٧
CREATE INDEX IF NOT EXISTS service_requests_status_created_idx
  ON public.service_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS service_requests_beneficiary_client_active_idx
  ON public.service_requests (beneficiary_client_id)
  WHERE status NOT IN ('resolved_at_intake', 'rejected', 'promoted', 'cancelled');

CREATE INDEX IF NOT EXISTS service_requests_duplicate_flag_active_idx
  ON public.service_requests (duplicate_flag)
  WHERE duplicate_flag = TRUE
    AND status NOT IN ('resolved_at_intake', 'rejected', 'promoted', 'cancelled');

CREATE INDEX IF NOT EXISTS service_requests_review_required_idx
  ON public.service_requests (review_required_flag)
  WHERE review_required_flag = TRUE;

CREATE INDEX IF NOT EXISTS service_requests_installed_device_active_idx
  ON public.service_requests (installed_device_id)
  WHERE status NOT IN ('resolved_at_intake', 'rejected', 'promoted', 'cancelled');

CREATE INDEX IF NOT EXISTS service_requests_not_archived_idx
  ON public.service_requests (id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS service_requests_branch_status_idx
  ON public.service_requests (branch_id, status);

-- Auto-update updated_at on row change.
CREATE OR REPLACE FUNCTION public.tg_service_requests_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_requests_set_updated_at ON public.service_requests;
CREATE TRIGGER service_requests_set_updated_at
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_requests_set_updated_at();

COMMENT ON TABLE public.service_requests IS
  'GLOBAL intake layer for emergency_maintenance (V1.0). Precedes open_tasks. 6 states + 7 channels. See maintenance.md §٠.';

COMMENT ON COLUMN public.service_requests.public_ref_number IS
  'SR-YYYYMMDD-NNNN format. Generated in same transaction as INSERT. UNIQUE WHERE archived_at IS NULL.';

COMMENT ON COLUMN public.service_requests.channel IS
  'Origin channel. V1.0 active: phone, internal_button, client_detail_button, admin_manual. Reserved: mobile_app, website, whatsapp.';

COMMENT ON COLUMN public.service_requests.branch_id IS
  'Tracking/reporting only (SR-08). Not used for access control — all service_requests permissions are GLOBAL.';

COMMIT;
