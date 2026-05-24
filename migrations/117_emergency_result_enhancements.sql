-- Migration 117: Emergency result enhancements
-- Adds two system_list categories + enriches parts & costs tables

-- ── 1. System list categories ─────────────────────────────────────────────────
INSERT INTO system_lists (category, value, display_order) VALUES
  -- سبب عدم سحب القطعة المبدلة
  ('part_no_retrieval_reason', 'الزبون احتفظ بها',      1),
  ('part_no_retrieval_reason', 'كانت متكسرة',           2),
  ('part_no_retrieval_reason', 'تعذر الوصول إليها',     3),
  ('part_no_retrieval_reason', 'سبب آخر',               4),
  -- سبب الحسم
  ('discount_reason', 'شكوى متكررة',                   1),
  ('discount_reason', 'ضيق مادي',                       2),
  ('discount_reason', 'خدمة ترحيبية',                   3),
  ('discount_reason', 'قرار إداري',                     4),
  ('discount_reason', 'خطأ من الفني',                   5)
ON CONFLICT DO NOTHING;

-- ── 2. Enrich emergency_maintenance_actions parts structure ───────────────────
-- Parts are now stored in emergency_result_parts (separate table) for richer data
CREATE TABLE IF NOT EXISTS emergency_result_parts (
  id                      SERIAL PRIMARY KEY,
  open_task_id            INTEGER NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
  spare_part_id           INTEGER REFERENCES spare_parts(id) ON DELETE SET NULL,
  part_name_snapshot      VARCHAR(255) NOT NULL,
  part_code_snapshot      VARCHAR(100),
  maintenance_type        VARCHAR(50),  -- Periodic / Emergency / Accessory
  unit_price              NUMERIC NOT NULL DEFAULT 0,
  quantity                INTEGER NOT NULL DEFAULT 1,
  line_total              NUMERIC GENERATED ALWAYS AS (unit_price * quantity) STORED,
  retrieved               BOOLEAN DEFAULT TRUE,   -- هل تم سحب القطعة المبدلة؟
  no_retrieval_reason_id  INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  no_retrieval_reason_text VARCHAR(255),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_task ON emergency_result_parts(open_task_id);

-- ── 3. Enrich emergency_result_costs ─────────────────────────────────────────
ALTER TABLE emergency_result_costs
  ADD COLUMN IF NOT EXISTS transport_fee        NUMERIC DEFAULT 0,    -- أجور مواصلات وخدمة
  ADD COLUMN IF NOT EXISTS assembly_fee         NUMERIC DEFAULT 0,    -- أجور فك أو تركيب
  ADD COLUMN IF NOT EXISTS discount_percentage  NUMERIC DEFAULT 0     CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  ADD COLUMN IF NOT EXISTS discount_reason_id   INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_reason_text VARCHAR(255);
