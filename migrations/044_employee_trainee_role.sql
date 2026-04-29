-- Migration 044: Add trainee as an operational employee role.
--
-- The scheduling flow now treats trainee as a first-class operational role.
-- Keep the constraint nullable-compatible because migration 012 intentionally
-- allowed employees with non-operational job titles to keep role = NULL.

ALTER TABLE employees
DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE employees
ADD CONSTRAINT employees_role_check
CHECK (
  role IS NULL OR role IN ('supervisor', 'technician', 'telemarketer', 'trainee')
);

INSERT INTO system_lists (category, value, display_order)
VALUES ('job_title', 'متدرب', 9)
ON CONFLICT (category, value) DO NOTHING;
