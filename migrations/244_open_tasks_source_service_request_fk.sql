-- ============================================================
-- 244_open_tasks_source_service_request_fk.sql
-- ============================================================
-- Phase 0.6 — Add source_service_request_id back-pointer to open_tasks.
--
-- Per maintenance.md §٠.٨:
--   - 1:0..1 relationship: service_request → open_task.
--   - This FK enables fast reverse lookup ("which request created
--     this task?") without joining through open_task_emergency_payload.
--   - Indexed partially (most open_tasks are non-emergency).
--
-- NOTE: A FORTHCOMING Phase 8 cleanup migration will tighten the
-- open_tasks.creation_origin CHECK to remove deprecated values
-- (service_request_call, telemarketing_inline_booking,
-- cascading_during_visit, manual_creation). For Phase 0 we only
-- ADD the FK column — no enum change yet to avoid breaking legacy
-- writers in routes/emergencyTickets.ts.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.٨
-- ============================================================

BEGIN;

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS source_service_request_id BIGINT
    REFERENCES public.service_requests(id) ON DELETE SET NULL;

-- Partial index — vast majority of open_tasks will have NULL here.
CREATE INDEX IF NOT EXISTS open_tasks_source_service_request_idx
  ON public.open_tasks (source_service_request_id)
  WHERE source_service_request_id IS NOT NULL;

COMMENT ON COLUMN public.open_tasks.source_service_request_id IS
  'Back-pointer to the service_request that promoted to this open_task. NULL for legacy emergency_tickets path and all non-emergency tasks. Populated by the promote service from Phase 2 onward.';

COMMIT;
