-- ============================================================
-- 251_visit_task_results_repaired_by.sql
-- ============================================================
-- Phase 6a.2 — Distinguish "who recorded the result" from
-- "who actually performed the repair" on visit_task_results.
--
-- Per maintenance.md §٠.١٩.د:
--   - closed_by  (existing)  = the user who SAVED the result row
--                              (typically the supervisor doing paperwork).
--   - repaired_by_employee_id (NEW) = the technician who actually
--                                      did the field work.
--
-- They CAN be the same person (a tech who self-documents), but
-- the constitution mandates the schema differentiates them so
-- per-tech performance metrics are not skewed by who entered
-- the form.
--
-- The wizard (Phase 6c) exposes both as separate dropdowns.
-- Phase 6b backend uses repaired_by when writing
-- service_request_problems.repaired_by_employee_id at resolution
-- time.
-- ============================================================

BEGIN;

ALTER TABLE public.visit_task_results
  ADD COLUMN IF NOT EXISTS repaired_by_employee_id INTEGER
    REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS visit_task_results_repaired_by_idx
  ON public.visit_task_results (repaired_by_employee_id)
  WHERE repaired_by_employee_id IS NOT NULL;

COMMENT ON COLUMN public.visit_task_results.repaired_by_employee_id IS
  'The technician who actually performed the repair (٠.١٩.د). Distinct from closed_by which is who saved the form. Used to populate service_request_problems.repaired_by_employee_id at resolution.';

COMMIT;
