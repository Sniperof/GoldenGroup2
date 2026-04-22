-- ============================================================
-- Migration 017: Rich employee profile fields
-- Adds structured HR data for employee records and seeds
-- the new system-list categories used by the employee form.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS employee_number_seq;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_number BIGINT,
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS father_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS military_service VARCHAR(100),
  ADD COLUMN IF NOT EXISTS residence_governorate_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residence_region_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residence_sub_area_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residence_neighborhood_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS detailed_address TEXT,
  ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS academic_qualification VARCHAR(255),
  ADD COLUMN IF NOT EXISTS specialization VARCHAR(255),
  ADD COLUMN IF NOT EXISTS years_of_experience INTEGER,
  ADD COLUMN IF NOT EXISTS driving_license BOOLEAN,
  ADD COLUMN IF NOT EXISTS job_skills TEXT,
  ADD COLUMN IF NOT EXISTS foreign_languages JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS start_work_date DATE,
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS work_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS previous_employment TEXT,
  ADD COLUMN IF NOT EXISTS direct_manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referrer_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_channel VARCHAR(100),
  ADD COLUMN IF NOT EXISTS referrer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS referral_notes TEXT;

ALTER TABLE employees
  ALTER COLUMN employee_number SET DEFAULT nextval('employee_number_seq');

UPDATE employees
SET employee_number = nextval('employee_number_seq')
WHERE employee_number IS NULL;

SELECT setval(
  'employee_number_seq',
  COALESCE((SELECT MAX(employee_number) FROM employees), 0),
  true
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_employees_employee_number
  ON employees(employee_number)
  WHERE employee_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_direct_manager
  ON employees(direct_manager_id);

CREATE INDEX IF NOT EXISTS idx_employees_residence_governorate
  ON employees(residence_governorate_id);

CREATE INDEX IF NOT EXISTS idx_employees_residence_region
  ON employees(residence_region_id);

CREATE INDEX IF NOT EXISTS idx_employees_residence_sub_area
  ON employees(residence_sub_area_id);

CREATE INDEX IF NOT EXISTS idx_employees_residence_neighborhood
  ON employees(residence_neighborhood_id);

INSERT INTO system_lists (category, value, is_active, display_order)
VALUES
  ('military_service', 'منهي', TRUE, 1),
  ('military_service', 'معفى', TRUE, 2),
  ('military_service', 'مؤجل', TRUE, 3),
  ('military_service', 'غير مطلوب', TRUE, 4),
  ('contract_type', 'دائم', TRUE, 1),
  ('contract_type', 'مؤقت', TRUE, 2),
  ('contract_type', 'تجربة', TRUE, 3),
  ('contract_type', 'جزئي', TRUE, 4),
  ('foreign_language', 'الإنجليزية', TRUE, 1),
  ('foreign_language', 'الفرنسية', TRUE, 2),
  ('foreign_language', 'الكردية', TRUE, 3),
  ('foreign_language', 'التركية', TRUE, 4),
  ('foreign_language', 'الألمانية', TRUE, 5)
ON CONFLICT (category, value) DO NOTHING;
