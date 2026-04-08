-- ============================================================
-- Migration 005: Constraint cleanup, type fixes, FK drops,
--                unique constraints, and indexes.
-- All DROP CONSTRAINT use IF EXISTS — safe to re-run.
-- ============================================================

-- ── Drop stale CHECK constraint on hr_users.role ───────────
ALTER TABLE hr_users DROP CONSTRAINT IF EXISTS hr_users_role_check;

-- ── Drop FK constraints that were removed intentionally ─────
-- These columns are kept but no longer reference employees
-- because HR users (not employees) perform these actions.
ALTER TABLE audit_logs          DROP CONSTRAINT IF EXISTS audit_logs_application_id_fkey;
ALTER TABLE audit_logs          DROP CONSTRAINT IF EXISTS audit_logs_performed_by_user_id_fkey;
ALTER TABLE job_applications    DROP CONSTRAINT IF EXISTS job_applications_entered_by_user_id_fkey;
ALTER TABLE training_courses    DROP CONSTRAINT IF EXISTS training_courses_created_by_user_id_fkey;
ALTER TABLE training_course_trainees DROP CONSTRAINT IF EXISTS training_course_trainees_result_recorded_by_fkey;
ALTER TABLE training_attendance DROP CONSTRAINT IF EXISTS training_attendance_recorded_by_user_id_fkey;

-- ── Relax NOT NULL on job_applications.job_vacancy_id ───────
-- Allows manual/internal applications without a vacancy.
ALTER TABLE job_applications ALTER COLUMN job_vacancy_id DROP NOT NULL;

-- ── Drop restrictive CHECK on application_source ────────────
-- Source list is now managed via system_lists, not a hard enum.
ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS job_applications_application_source_check;

-- ── Relax NOT NULL on optional applicant fields ─────────────
ALTER TABLE applicants ALTER COLUMN city_or_area           DROP NOT NULL;
ALTER TABLE applicants ALTER COLUMN sub_area               DROP NOT NULL;
ALTER TABLE applicants ALTER COLUMN neighborhood           DROP NOT NULL;
ALTER TABLE applicants ALTER COLUMN detailed_address       DROP NOT NULL;
ALTER TABLE applicants ALTER COLUMN academic_qualification DROP NOT NULL;
ALTER TABLE applicants ALTER COLUMN previous_employment    DROP NOT NULL;
ALTER TABLE applicants ALTER COLUMN years_of_experience    DROP NOT NULL;

-- ── Migrate driving_license BOOLEAN → VARCHAR(10) ───────────
-- Only runs if the column is still boolean type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'applicants'
      AND column_name = 'driving_license'
      AND data_type   = 'boolean'
  ) THEN
    ALTER TABLE applicants
      ALTER COLUMN driving_license TYPE VARCHAR(10) USING NULL;
  END IF;
END $$;

-- ── Drop restrictive CHECK on applicant_segment ─────────────
ALTER TABLE applicants DROP CONSTRAINT IF EXISTS applicants_applicant_segment_check;
ALTER TABLE applicants ALTER COLUMN applicant_segment TYPE VARCHAR(100);

-- ── Fix vacancy_count CHECK: allow 0 ────────────────────────
ALTER TABLE job_vacancies DROP CONSTRAINT IF EXISTS job_vacancies_vacancy_count_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'job_vacancies_vacancy_count_check'
      AND table_name = 'job_vacancies'
  ) THEN
    ALTER TABLE job_vacancies
      ADD CONSTRAINT job_vacancies_vacancy_count_check CHECK (vacancy_count >= 0);
  END IF;
END $$;

-- ── Add UNIQUE constraint on system_lists(category, value) ──
-- Required for ON CONFLICT DO NOTHING in seed migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'system_lists_category_value_unique'
      AND table_name = 'system_lists'
  ) THEN
    ALTER TABLE system_lists
      ADD CONSTRAINT system_lists_category_value_unique UNIQUE (category, value);
  END IF;
END $$;

-- ── Add FK hr_users.role_id → roles (if not already present) ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'hr_users_role_id_fkey'
      AND table_name = 'hr_users'
  ) THEN
    ALTER TABLE hr_users
      ADD CONSTRAINT hr_users_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id);
  END IF;
END $$;

-- ── Unique partial index on hr_users.employee_id ────────────
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_users_employee_id
  ON hr_users(employee_id)
  WHERE employee_id IS NOT NULL;

-- ── General indexes ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_system_lists_category ON system_lists(category);
