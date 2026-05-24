-- Migration 114: Emergency maintenance action types + ticket enhancements
-- Adds admin-managed action types for emergency maintenance requests,
-- links them to emergency_tickets, and enforces the 48-hour execution policy.

-- ── 1. Admin-managed action types ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_action_types (
  id            SERIAL PRIMARY KEY,
  arabic_label  VARCHAR(100) NOT NULL,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial values
INSERT INTO emergency_action_types (arabic_label, display_order) VALUES
  ('فحص وتشخيص',         1),
  ('تغيير فلتر',          2),
  ('إصلاح تسرب',          3),
  ('تغيير مضخة',          4),
  ('تغيير أغشية',         5),
  ('فحص كهربائي',         6),
  ('تنظيف الجهاز',        7),
  ('استبدال قطعة',        8)
ON CONFLICT DO NOTHING;

-- ── 2. Add action_type_id to emergency_tickets ────────────────────────────────
ALTER TABLE emergency_tickets
  ADD COLUMN IF NOT EXISTS action_type_id INTEGER
    REFERENCES emergency_action_types(id) ON DELETE SET NULL;

-- ── 3. 48-hour execution policy field ────────────────────────────────────────
-- due_within_hours = company SLA. Default 48 per policy.
ALTER TABLE emergency_tickets
  ADD COLUMN IF NOT EXISTS due_within_hours INTEGER NOT NULL DEFAULT 48;

-- ── 4. Permissions ────────────────────────────────────────────────────────────
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order) VALUES
  ('admin.emergency_action_types.view',   'admin', 'emergency_action_types', 'view',   'عرض أنواع إجراءات الطوارئ',   220),
  ('admin.emergency_action_types.manage', 'admin', 'emergency_action_types', 'manage', 'إدارة أنواع إجراءات الطوارئ', 221)
ON CONFLICT (key) DO NOTHING;
