-- Migration 017: Extended employee profile
-- Adds all the new columns required by the expanded employee form.
-- All columns are nullable so existing rows are unaffected.

-- ── Identity ─────────────────────────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_number  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS first_name       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS father_name      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_name        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS birth_date       DATE,
  ADD COLUMN IF NOT EXISTS gender           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS marital_status   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS military_service VARCHAR(50);

-- ── Contact & Address ─────────────────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS contacts                JSONB        NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS residence_governorate_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residence_region_id      INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residence_sub_area_id    INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residence_neighborhood_id INTEGER REFERENCES geo_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS detailed_address         TEXT;

-- ── Academic & Skills ─────────────────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS academic_qualification VARCHAR(100),
  ADD COLUMN IF NOT EXISTS specialization         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS years_of_experience    INTEGER,
  ADD COLUMN IF NOT EXISTS driving_license        BOOLEAN,
  ADD COLUMN IF NOT EXISTS job_skills             TEXT,
  ADD COLUMN IF NOT EXISTS foreign_languages      JSONB NOT NULL DEFAULT '[]';

-- ── Employment ────────────────────────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hire_date           DATE,
  ADD COLUMN IF NOT EXISTS start_work_date     DATE,
  ADD COLUMN IF NOT EXISTS contract_type       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS work_type           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS previous_employment TEXT,
  ADD COLUMN IF NOT EXISTS direct_manager_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL;

-- ── Referral / Source ─────────────────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS referrer_type   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_channel  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS referrer_name   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS referral_notes  TEXT;

-- ── Unique employee number (optional, manually assigned) ──────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_number
  ON employees (employee_number)
  WHERE employee_number IS NOT NULL;

-- ── Useful indexes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_direct_manager ON employees (direct_manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_birth_date     ON employees (birth_date);
