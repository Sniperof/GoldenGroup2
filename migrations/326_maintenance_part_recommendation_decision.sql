-- ============================================================
-- 326_maintenance_part_recommendation_decision.sql
-- ============================================================
-- Separate the technician's recommendation from the customer's
-- decision and the actual execution of a maintenance part.
--
-- A row in emergency_result_parts may now mean:
--   - a part was actually replaced/handed over, or
--   - the technician confirmed it is required/optional but the
--     customer refused it, or it was unavailable.
--
-- This distinction is shared by emergency_maintenance and the
-- future periodic_maintenance result wizard.
-- ============================================================

BEGIN;

ALTER TABLE public.emergency_result_parts
  ADD COLUMN IF NOT EXISTS recommendation_status varchar(30) DEFAULT 'required' NOT NULL,
  ADD COLUMN IF NOT EXISTS customer_decision varchar(30) DEFAULT 'approved' NOT NULL,
  ADD COLUMN IF NOT EXISTS execution_status varchar(40) DEFAULT 'replaced' NOT NULL,
  ADD COLUMN IF NOT EXISTS customer_refusal_reason_id integer REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_refusal_reason_text varchar(255);

ALTER TABLE public.emergency_result_parts
  DROP CONSTRAINT IF EXISTS emergency_result_parts_recommendation_status_check,
  ADD CONSTRAINT emergency_result_parts_recommendation_status_check
    CHECK (recommendation_status IN ('required', 'optional'));

ALTER TABLE public.emergency_result_parts
  DROP CONSTRAINT IF EXISTS emergency_result_parts_customer_decision_check,
  ADD CONSTRAINT emergency_result_parts_customer_decision_check
    CHECK (customer_decision IN ('approved', 'refused', 'not_required'));

ALTER TABLE public.emergency_result_parts
  DROP CONSTRAINT IF EXISTS emergency_result_parts_execution_status_check,
  ADD CONSTRAINT emergency_result_parts_execution_status_check
    CHECK (execution_status IN (
      'replaced',
      'delivered_to_customer_stock',
      'not_replaced_customer_refused',
      'not_replaced_unavailable',
      'not_replaced_technician_decision'
    ));

CREATE INDEX IF NOT EXISTS idx_erp_execution_status
  ON public.emergency_result_parts (execution_status);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT seed.category, seed.value, TRUE, seed.display_order, seed.metadata::jsonb
FROM (VALUES
  ('part_customer_refusal_reason', 'السعر غير مناسب', 10, '{"code":"price_refused"}'),
  ('part_customer_refusal_reason', 'يريد التأجيل', 20, '{"code":"requested_later"}'),
  ('part_customer_refusal_reason', 'لا يقتنع بالحاجة للقطعة', 30, '{"code":"not_convinced"}'),
  ('part_customer_refusal_reason', 'يريد استشارة لاحقة', 40, '{"code":"needs_consultation"}'),
  ('part_customer_refusal_reason', 'أخرى', 99, '{"code":"other"}')
) AS seed(category, value, display_order, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = seed.category
    AND sl.value = seed.value
);

COMMENT ON COLUMN public.emergency_result_parts.recommendation_status IS
  'Technician recommendation: required for repair/maintenance or optional advice.';

COMMENT ON COLUMN public.emergency_result_parts.customer_decision IS
  'Customer decision on the recommended part: approved/refused/not_required.';

COMMENT ON COLUMN public.emergency_result_parts.execution_status IS
  'Actual result for the part. Only replaced/customer_stock rows affect inventory/financial execution.';

COMMENT ON COLUMN public.emergency_result_parts.customer_refusal_reason_id IS
  'Optional system_lists reason for customer refusal of a recommended part.';

COMMIT;
