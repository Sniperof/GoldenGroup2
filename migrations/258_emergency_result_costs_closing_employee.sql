-- ============================================================
-- 258 — Add closing_employee_id to emergency_result_costs
-- ============================================================
-- The emergencyResult.ts service has been writing/reading
-- `closing_employee_id` (employee who closed the maintenance result)
-- but the column was never added. This migration backfills it.
-- ============================================================

ALTER TABLE public.emergency_result_costs
  ADD COLUMN IF NOT EXISTS closing_employee_id INTEGER
    REFERENCES public.employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.emergency_result_costs.closing_employee_id IS
  'Employee who finalized the maintenance result (Phase 4 of the wizard).';
