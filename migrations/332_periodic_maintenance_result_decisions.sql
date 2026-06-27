-- 332_periodic_maintenance_result_decisions.sql
-- Allow the shared maintenance result cost row to store periodic-maintenance
-- application decisions. Follow-up generation is intentionally not added here.

ALTER TABLE public.emergency_result_costs
  DROP CONSTRAINT IF EXISTS emergency_result_costs_final_decision_check;

ALTER TABLE public.emergency_result_costs
  ADD CONSTRAINT emergency_result_costs_final_decision_check
  CHECK (
    final_decision IN (
      'resolved',
      'unresolved',
      'needs_followup',
      'cancelled',
      'performed',
      'partially_performed',
      'not_performed'
    )
  );

COMMENT ON CONSTRAINT emergency_result_costs_final_decision_check ON public.emergency_result_costs IS
  'Maintenance result decisions. Emergency uses resolved/unresolved/needs_followup/cancelled; periodic uses performed/partially_performed/not_performed.';
