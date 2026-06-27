-- ============================================================
-- 332_gift_approval_notes.sql
-- ============================================================
-- gifts.md §ب: approval_notes / condition_notes حقول مفهومية على gift_records.
-- القاعدة: إذا اعتُمد السجل للتسليم بينما condition_status='not_met'،
-- تصبح ملاحظات الاعتماد إلزامية (تُفرض في طبقة الخدمة).
-- ============================================================

BEGIN;

ALTER TABLE public.gift_records
  ADD COLUMN IF NOT EXISTS approval_notes  TEXT,
  ADD COLUMN IF NOT EXISTS condition_notes TEXT;

COMMIT;
