-- ============================================================
-- 309_open_task_reasons_golden_warranty.sql
-- ============================================================
-- POST /open-tasks validates `reason` against system_lists['open_task_reasons']
-- (falling back to a hard-coded default set only when that category is EMPTY).
-- To let the device page spawn a golden-warranty offer task with a meaningful
-- reason, register dedicated reasons. We also seed the standard default set so
-- that environments whose list was empty (relying on the fallback) keep accepting
-- the existing reasons once this category becomes non-empty.
--
-- Constitution: 02b §13.6 + DEC-CT-17 (CT-IMPL-017).
-- Idempotent (UNIQUE (category, value)).
-- ============================================================

INSERT INTO public.system_lists (category, value, is_active, display_order)
SELECT 'open_task_reasons', v.value, true, v.ord
FROM (VALUES
  ('new_lead', 1),
  ('follow_up', 2),
  ('renewal', 3),
  ('service_request', 4),
  ('other', 5),
  ('golden_warranty_offer', 6),
  ('golden_warranty_card_delivery', 7)
) AS v(value, ord)
ON CONFLICT (category, value) DO NOTHING;
