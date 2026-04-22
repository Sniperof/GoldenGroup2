-- Migration 012: Link job titles in system_lists to RBAC roles
-- Adds linked_role_id to system_lists so each job title entry can reference
-- an existing role from the roles table.
-- Also removes the 3-value CHECK constraint on employees.role so that
-- employees with job titles outside مشرفة/فني/تيلماركتر can be saved.

-- 1. Add linked_role_id column to system_lists
ALTER TABLE system_lists
ADD COLUMN IF NOT EXISTS linked_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;

-- 2. Remove the NOT NULL + CHECK constraints on employees.role so that
--    job titles outside supervisor/technician/telemarketer can be saved.
ALTER TABLE employees
DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE employees
ALTER COLUMN role DROP NOT NULL;
