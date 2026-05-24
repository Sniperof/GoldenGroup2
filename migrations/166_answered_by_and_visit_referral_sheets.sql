-- Migration 166: answered_by in appointments + field_visit_id in referral_sheets

-- 1. Add answered_by to telemarketing_appointments (captured in UI but not persisted)
ALTER TABLE telemarketing_appointments
  ADD COLUMN IF NOT EXISTS answered_by VARCHAR(50);

-- 2. Link referral_sheets to field_visits (visit-level name lists)
ALTER TABLE referral_sheets
  ADD COLUMN IF NOT EXISTS field_visit_id INTEGER REFERENCES field_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referral_sheets_field_visit ON referral_sheets(field_visit_id);
