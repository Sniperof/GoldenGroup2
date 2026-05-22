-- Migration 119: Extended payment system for emergency_result_costs

-- ── 1. New columns ────────────────────────────────────────────────────────────

ALTER TABLE emergency_result_costs
  -- نوع الدفع: كاش | تقسيط
  ADD COLUMN IF NOT EXISTS payment_type          VARCHAR(20),
  -- عدد أشهر التقسيط (فقط عند تقسيط)
  ADD COLUMN IF NOT EXISTS installment_months    INTEGER,
  -- طريقة الدفع: hand | transfer | barter
  ADD COLUMN IF NOT EXISTS payment_delivery      VARCHAR(20),
  -- شركة الحوالة (من القوائم)
  ADD COLUMN IF NOT EXISTS transfer_company_id   INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  -- المقايضة
  ADD COLUMN IF NOT EXISTS barter_description    TEXT,
  ADD COLUMN IF NOT EXISTS barter_value_syp      NUMERIC(12,2),
  -- الدفعة الأولى بالعملة الأولى
  ADD COLUMN IF NOT EXISTS pay1_currency         VARCHAR(5),    -- 'syp' | 'usd'
  ADD COLUMN IF NOT EXISTS pay1_amount           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS pay1_exchange_rate    NUMERIC(10,2), -- ل.س لكل دولار
  -- الدفعة الثانية (اختيارية، عملة مختلفة)
  ADD COLUMN IF NOT EXISTS pay2_currency         VARCHAR(5),
  ADD COLUMN IF NOT EXISTS pay2_amount           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS pay2_exchange_rate    NUMERIC(10,2),
  -- حقل التسكير
  ADD COLUMN IF NOT EXISTS closing_note          TEXT;

-- ── 2. Transfer companies system list ────────────────────────────────────────

INSERT INTO system_lists (category, value, display_order) VALUES
  ('transfer_company', 'شام كاش',      1),
  ('transfer_company', 'سيريتيل كاش', 2),
  ('transfer_company', 'MTN كاش',      3),
  ('transfer_company', 'بيمو',         4),
  ('transfer_company', 'سبأ',          5),
  ('transfer_company', 'أخرى',         6)
ON CONFLICT DO NOTHING;
