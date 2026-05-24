-- Migration 165: Add appointment info, customer snapshot, and cancellation fields to field_visits
-- Implements the visit-detail-page constitution (Sections 1, 2, 7)

ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS appointment_booked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booked_by_telemarketer_id  INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS telemarketer_notes         TEXT,
  ADD COLUMN IF NOT EXISTS answered_by                VARCHAR(50),
  ADD COLUMN IF NOT EXISTS customer_snapshot          JSONB,
  ADD COLUMN IF NOT EXISTS cancellation_reason_id     INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_notes         TEXT;

CREATE INDEX IF NOT EXISTS idx_field_visits_booked_by ON field_visits(booked_by_telemarketer_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_cancel_reason ON field_visits(cancellation_reason_id);

-- Seed visit cancellation reasons
INSERT INTO system_lists (category, value, display_order) VALUES
  ('visit_cancellation_reasons', 'رفض الزبون الزيارة',    1),
  ('visit_cancellation_reasons', 'الزبون غير متواجد',      2),
  ('visit_cancellation_reasons', 'تعذّر الوصول للعنوان',    3),
  ('visit_cancellation_reasons', 'طلب الزبون التأجيل',      4),
  ('visit_cancellation_reasons', 'قرار إداري من الشركة',    5),
  ('visit_cancellation_reasons', 'سبب آخر',                 6)
ON CONFLICT (category, value) DO NOTHING;
