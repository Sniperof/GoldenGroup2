-- ============================================================
-- 243_open_task_emergency_payload.sql
-- ============================================================
-- Phase 0.5 — Side-table payload for emergency open_tasks.
--
-- Per P-MAINT-10 (resolved 2026-06-04):
--   open_tasks stays clean and unified across all task_types.
--   Type-specific payloads live in side tables (1:1) — same
--   pattern as open_task_pre_offers for device_demo.
--
-- This carries the emergency-specific data captured at promote:
--   - source_service_request_id: which request promoted to this task
--   - reported_problem_snapshot: immutable copy of customer's
--     original wording for historical record
--   - reported_action_type_id: optional pre-classification snapshot
--
-- Future expansion: open_task_periodic_payload (V2) follows the
-- same pattern with periodic_cycle_no + warranty references.
--
-- FK targets verified: open_tasks, service_requests (240),
--   emergency_action_types.
--
-- Reference: docs/constitution/features/tasks/maintenance.md P-MAINT-10
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.open_task_emergency_payload (
    id                              BIGSERIAL PRIMARY KEY,
    open_task_id                    INTEGER NOT NULL UNIQUE
                                    REFERENCES public.open_tasks(id) ON DELETE CASCADE,
    source_service_request_id       BIGINT NOT NULL
                                    REFERENCES public.service_requests(id) ON DELETE RESTRICT,
    reported_problem_snapshot       TEXT NOT NULL,
    reported_action_type_id         INTEGER
                                    REFERENCES public.emergency_action_types(id) ON DELETE SET NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS open_task_emergency_payload_source_request_idx
  ON public.open_task_emergency_payload (source_service_request_id);

COMMENT ON TABLE public.open_task_emergency_payload IS
  'Per-type payload for emergency_maintenance open_tasks (UNIQUE 1:1). Pattern from open_task_pre_offers. See maintenance.md P-MAINT-10.';

COMMENT ON COLUMN public.open_task_emergency_payload.reported_problem_snapshot IS
  'Immutable copy of service_requests.problem_description at promote time. Used for historical record even if request is archived.';

COMMIT;
