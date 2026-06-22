-- ============================================================
-- 311_golden_warranty_reason_lists.sql
-- ============================================================
-- Seeds the six dedicated reason lists for the golden-warranty task lifecycle
-- (offer + card delivery), each manageable from the lists admin. Constitution:
-- 02b §13.6 + DEC-CT-17, following the device-demo 3-outcome model (reason_code
-- per outcome). Starter values only — staff extend them in lists management.
--
-- Idempotent (UNIQUE (category, value)).
-- ============================================================

INSERT INTO public.system_lists (category, value, is_active, display_order)
SELECT cat, val, true, ord
FROM (VALUES
  -- offer: creation
  ('golden_offer_creation_reasons',  'حملة ترويجية',                 1),
  ('golden_offer_creation_reasons',  'مبادرة الفريق',                2),
  ('golden_offer_creation_reasons',  'طلب الزبون',                   3),
  -- offer: activate-later (reschedule)
  ('golden_offer_followup_reasons',  'الزبون طلب مهلة للتفكير',      1),
  ('golden_offer_followup_reasons',  'الزبون غير متوفر حالياً',      2),
  -- offer: rejection
  ('golden_offer_rejection_reasons', 'غير مهتم بالكفالة الذهبية',    1),
  ('golden_offer_rejection_reasons', 'السعر غير مناسب للزبون',       2),
  -- card delivery: creation
  ('golden_card_creation_reasons',   'إصدار بطاقة VIP بعد التفعيل',  1),
  -- card delivery: reschedule
  ('golden_card_followup_reasons',   'الزبون غير متوفر',             1),
  ('golden_card_followup_reasons',   'تأجيل بطلب الزبون',            2),
  -- card delivery: rejection
  ('golden_card_rejection_reasons',  'رفض استلام البطاقة',          1)
) AS v(cat, val, ord)
ON CONFLICT (category, value) DO NOTHING;
