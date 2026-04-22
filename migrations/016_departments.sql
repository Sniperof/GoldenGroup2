-- Migration 016: Departments
-- Adds a department management system per branch.
-- Each branch can have multiple departments; each department has a type (from system_lists)
-- and optionally one or more device models associated with it.

-- 1. Add metadata JSONB column to system_lists (for canSelectDevice flag on department_type items)
ALTER TABLE system_lists
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- 2. Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  department_type_id   INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  branch_id            INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  device_model_ids     JSONB NOT NULL DEFAULT '[]',
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_branch ON departments(branch_id);
CREATE INDEX IF NOT EXISTS idx_departments_type   ON departments(department_type_id);

-- 3. Add department_id to employees (nullable — existing employees have no department)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);

-- 4. Seed default department type list items
-- canSelectDevice=true means a form field for picking device models will appear
INSERT INTO system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('department_type', 'مبيعات',         TRUE, 1, '{"canSelectDevice": false}'),
  ('department_type', 'تسويق',          TRUE, 2, '{"canSelectDevice": false}'),
  ('department_type', 'صيانة',          TRUE, 3, '{"canSelectDevice": true}'),
  ('department_type', 'خدمة عملاء',    TRUE, 4, '{"canSelectDevice": false}'),
  ('department_type', 'موارد بشرية',   TRUE, 5, '{"canSelectDevice": false}'),
  ('department_type', 'إدارة',         TRUE, 6, '{"canSelectDevice": false}'),
  ('department_type', 'محاسبة',        TRUE, 7, '{"canSelectDevice": false}'),
  ('department_type', 'مستودع',        TRUE, 8, '{"canSelectDevice": true}'),
  ('department_type', 'تقنية معلومات', TRUE, 9, '{"canSelectDevice": true}')
ON CONFLICT (category, value) DO NOTHING;
