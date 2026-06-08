-- ============================================================
-- 242_service_request_problems.sql
-- ============================================================
-- Phase 0.4 — Diagnosed Problems list (لائحة الأعطال).
--
-- The structural counterpart of the device_demo pattern
-- (customer_device_pre_offers → open_task_pre_offers), but for
-- the diagnostic lifecycle of a device fault.
--
-- Per maintenance.md §٠.١٩.ب:
--   - Dual reference: service_request_id (permanent) +
--     open_task_id (filled at promote).
--   - 7 statuses, 4 add-phases (CHECK constraints).
--   - Distinguishes "who recorded" (resolution_recorded_by_user_id)
--     from "who repaired" (repaired_by_employee_id) — ٠.١٩.د.
--   - Soft delete only (EM-PROB-01).
--   - DB trigger: once status = 'resolved', further status changes
--     require Audit Admin override (enforced at app layer; here we
--     just record an attempt-block guard tag in the trigger so the
--     app can detect and route through override path).
--
-- Indexes per ٠.١٩.ج.
--
-- FK targets verified: service_requests (240), open_tasks,
--   installed_devices, system_lists, hr_users, employees,
--   visit_tasks.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.١٩
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_request_problems (
    -- Identity & dual parent reference
    id                                  BIGSERIAL PRIMARY KEY,
    service_request_id                  BIGINT NOT NULL
                                        REFERENCES public.service_requests(id) ON DELETE CASCADE,
    open_task_id                        INTEGER
                                        REFERENCES public.open_tasks(id) ON DELETE SET NULL,

    -- Device & type
    installed_device_id                 INTEGER NOT NULL
                                        REFERENCES public.installed_devices(id) ON DELETE RESTRICT,
    problem_type_id                     INTEGER NOT NULL
                                        REFERENCES public.system_lists(id) ON DELETE RESTRICT,
    details                             TEXT,

    -- Status lifecycle
    status                              VARCHAR(30) NOT NULL DEFAULT 'reported',

    -- Creation metadata
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id                  INTEGER NOT NULL
                                        REFERENCES public.hr_users(id) ON DELETE RESTRICT,
    added_during_phase                  VARCHAR(30) NOT NULL,
    creator_role_snapshot               VARCHAR(50) NOT NULL,

    -- Resolution metadata (٠.١٩.د — recorded vs repaired)
    resolved_at                         TIMESTAMPTZ,
    resolution_recorded_by_user_id      INTEGER
                                        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    repaired_by_employee_id             INTEGER
                                        REFERENCES public.employees(id) ON DELETE SET NULL,
    resolution_visit_task_id            BIGINT
                                        REFERENCES public.visit_tasks(id) ON DELETE SET NULL,
    repair_team_snapshot                JSONB,
    resolution_notes                    TEXT,

    -- Edit tracking
    last_edited_at                      TIMESTAMPTZ,
    last_edited_by_user_id              INTEGER
                                        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    edit_count                          INTEGER NOT NULL DEFAULT 0,

    -- Soft delete (EM-PROB-01 — never hard delete)
    deleted_at                          TIMESTAMPTZ,
    deleted_by_user_id                  INTEGER
                                        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    deletion_reason                     TEXT,

    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- CHECK constraints
    CONSTRAINT service_request_problems_status_check
      CHECK (status IN (
        'reported',
        'confirmed',
        'resolved_at_intake',
        'resolved',
        'deferred',
        'unresolvable_field',
        'cancelled'
      )),

    CONSTRAINT service_request_problems_added_during_phase_check
      CHECK (added_during_phase IN (
        'intake', 'in_review', 'technical_consultation', 'field_discovery'
      ))
);

-- Indexes per ٠.١٩.ج
CREATE INDEX IF NOT EXISTS service_request_problems_request_active_idx
  ON public.service_request_problems (service_request_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS service_request_problems_open_task_active_idx
  ON public.service_request_problems (open_task_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS service_request_problems_device_open_idx
  ON public.service_request_problems (installed_device_id, status)
  WHERE status NOT IN ('cancelled', 'resolved_at_intake')
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS service_request_problems_type_created_idx
  ON public.service_request_problems (problem_type_id, created_at);

CREATE INDEX IF NOT EXISTS service_request_problems_repaired_by_idx
  ON public.service_request_problems (repaired_by_employee_id, resolved_at)
  WHERE repaired_by_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_request_problems_resolution_visit_idx
  ON public.service_request_problems (resolution_visit_task_id)
  WHERE resolution_visit_task_id IS NOT NULL;

-- Trigger: prevent transitions out of 'resolved' without an explicit
-- override flag in the session (EM-PROB-02). The override path uses
-- SET LOCAL service_request.audit_override = 'on' inside a transaction
-- so the application's audit-admin endpoint can authorize the change.
CREATE OR REPLACE FUNCTION public.tg_service_request_problems_block_resolved_change()
RETURNS TRIGGER AS $$
DECLARE
  override_flag TEXT;
BEGIN
  IF OLD.status = 'resolved' AND NEW.status <> OLD.status THEN
    override_flag := current_setting('service_request.audit_override', true);
    IF override_flag IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'service_request_problems.status cannot change from resolved without audit-admin override (EM-PROB-02)';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_request_problems_resolved_guard ON public.service_request_problems;
CREATE TRIGGER service_request_problems_resolved_guard
  BEFORE UPDATE ON public.service_request_problems
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_request_problems_block_resolved_change();

COMMENT ON TABLE public.service_request_problems IS
  'Diagnosed problems list — lives on service_request_id permanently; gains open_task_id at promote. Pattern from customer_device_pre_offers/open_task_pre_offers. See maintenance.md §٠.١٩.';

COMMENT ON COLUMN public.service_request_problems.added_during_phase IS
  'When the problem entered the list. field_discovery = added by technician during the visit.';

COMMENT ON COLUMN public.service_request_problems.resolution_recorded_by_user_id IS
  'Who WROTE the resolution (e.g. supervisor doing paperwork).';

COMMENT ON COLUMN public.service_request_problems.repaired_by_employee_id IS
  'Who ACTUALLY repaired the device (e.g. the technician). Distinct from recorded_by per ٠.١٩.د.';

COMMIT;
