-- Migration 118: Emergency final decision reasons + follow-up task fields

-- ── 1. Remove partially_resolved from constraint ──────────────────────────────
ALTER TABLE emergency_result_costs
  DROP CONSTRAINT IF EXISTS emergency_result_costs_final_decision_check;
ALTER TABLE emergency_result_costs
  ADD CONSTRAINT emergency_result_costs_final_decision_check
    CHECK (final_decision IN ('resolved', 'unresolved', 'needs_followup', 'cancelled'));

-- Update any existing partially_resolved rows
UPDATE emergency_result_costs SET final_decision = 'unresolved' WHERE final_decision = 'partially_resolved';

-- ── 2. Add decision reason + follow-up fields ─────────────────────────────────
ALTER TABLE emergency_result_costs
  ADD COLUMN IF NOT EXISTS decision_reason_id   INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_reason_text VARCHAR(255),
  ADD COLUMN IF NOT EXISTS follow_up_priority   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS follow_up_expected_date DATE,
  ADD COLUMN IF NOT EXISTS follow_up_task_id    INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL;

-- ── 3. System list categories for decision reasons ────────────────────────────
INSERT INTO system_lists (category, value, display_order) VALUES
  -- سبب اكتمال المعالجة
  ('emergency_resolved_reason',   'تغيير فلتر',                 1),
  ('emergency_resolved_reason',   'إصلاح تسرب',                  2),
  ('emergency_resolved_reason',   'تغيير مضخة',                  3),
  ('emergency_resolved_reason',   'تنظيف الجهاز',               4),
  ('emergency_resolved_reason',   'استبدال غشاء',               5),
  ('emergency_resolved_reason',   'إصلاح كهربائي',              6),
  ('emergency_resolved_reason',   'سبب آخر',                    7),

  -- سبب عدم الحل
  ('emergency_unresolved_reason', 'قطعة غير متوفرة',            1),
  ('emergency_unresolved_reason', 'تحتاج فني متخصص',            2),
  ('emergency_unresolved_reason', 'مشكلة أعمق من المتوقع',      3),
  ('emergency_unresolved_reason', 'تعذر الوصول للجهاز',         4),
  ('emergency_unresolved_reason', 'سبب آخر',                    5),

  -- سبب الإلغاء
  ('emergency_cancelled_reason',  'رفض الزبون الخدمة',          1),
  ('emergency_cancelled_reason',  'الزبون غير متواجد',          2),
  ('emergency_cancelled_reason',  'العقد منتهٍ',                 3),
  ('emergency_cancelled_reason',  'قرار إداري',                  4),
  ('emergency_cancelled_reason',  'سبب آخر',                    5),

  -- سبب الحاجة للمتابعة
  ('emergency_followup_reason',   'انتظار قطعة',                1),
  ('emergency_followup_reason',   'الزبون طلب موعداً لاحقاً',   2),
  ('emergency_followup_reason',   'تحتاج فني متخصص',            3),
  ('emergency_followup_reason',   'العمل غير مكتمل',            4),
  ('emergency_followup_reason',   'سبب آخر',                    5)
ON CONFLICT DO NOTHING;
