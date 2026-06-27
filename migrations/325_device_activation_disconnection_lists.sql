-- ============================================================
-- 325_device_activation_disconnection_lists.sql
-- ============================================================
-- Converts the previously hard-coded / free-text reasons of the
-- device_activation and device_disconnection result modals into
-- admin-managed system_lists, on par with retrieval/return (323/324).
--
-- IMPORTANT — backend contract is preserved:
--   * The activation modal stores its follow-up reason as a plain text
--     `reason_code` (visit_task_device_activation_results / visit_tasks).
--   * The disconnection modal stores `reason_code` and `retrieval_reason`
--     as plain text as well (visit_task_device_disconnection_results).
--   Both side tables keep TEXT columns — these lists only feed the
--   dropdowns. The seeded `value` codes match the codes the modals
--   already send, so previously-saved records stay valid.
-- ============================================================

BEGIN;

-- ── device_activation — follow-up reasons (was a free-text input) ──
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_activation_followup_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('pressure_issue',       1, '{"label":"ضغط ماء غير مناسب"}'),
  ('electrical_issue',     2, '{"label":"مشكلة كهرباء"}'),
  ('device_fault',         3, '{"label":"عطل في الجهاز"}'),
  ('prerequisite_missing', 4, '{"label":"متطلب تركيب ناقص"}'),
  ('customer_not_ready',   5, '{"label":"الزبون غير جاهز"}'),
  ('other',               99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_activation_followup_reasons'
     AND sl.value = v.value
);

-- ── device_disconnection — disconnection reasons (was a hard-coded array) ──
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_disconnection_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('contract_cancelled',       1, '{"label":"إلغاء عقد"}'),
  ('temporary_stop',           2, '{"label":"إيقاف مؤقت"}'),
  ('customer_request',         3, '{"label":"طلب الزبون"}'),
  ('technical_safety',         4, '{"label":"سلامة فنية"}'),
  ('replacement_preparation',  5, '{"label":"تحضير تبديل"}'),
  ('maintenance_preparation',  6, '{"label":"تحضير صيانة"}'),
  ('other',                   99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_disconnection_reasons'
     AND sl.value = v.value
);

-- ── device_disconnection — subsequent retrieval reasons (was a hard-coded array) ──
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_disconnection_retrieval_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('workshop_repair',  1, '{"label":"صيانة في الورشة"}'),
  ('replacement',      2, '{"label":"تبديل جهاز"}'),
  ('final_retrieval',  3, '{"label":"استرجاع نهائي"}'),
  ('other',           99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'device_disconnection_retrieval_reasons'
     AND sl.value = v.value
);

COMMIT;
