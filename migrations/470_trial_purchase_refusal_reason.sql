-- Explicit customer refusal of trial purchase. No historical classification:
-- administrative draft rejection and generic cancellation are different events.
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'contract_cancellation_reasons', 'trial_purchase_refused', TRUE, 55,
       '{"label":"رفض الزبون تثبيت شراء جهاز التجربة"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists
   WHERE category = 'contract_cancellation_reasons'
     AND value = 'trial_purchase_refused'
);
