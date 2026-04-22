-- ============================================================
-- Migration 014: Attach branch_id to every branch-scoped domain table.
-- Strategy:
--   1. Seed a "غير محدد" (unassigned) fallback branch so we can
--      backfill legacy rows without losing them.
--   2. For every branch-scoped table: add nullable branch_id,
--      map existing free-text `branch` column (where it exists)
--      to a real branches.id, assign fallback for the rest,
--      then add an index. We deliberately keep the column
--      nullable and the free-text `branch` column intact in this
--      migration — Phase 3 code will populate branch_id on writes,
--      and a later cleanup migration will enforce NOT NULL and
--      drop the legacy text column.
-- ============================================================

-- 0. Fallback branch for unassigned legacy rows.
INSERT INTO branches (name, status)
SELECT 'غير محدد', 'active'
 WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = 'غير محدد');

-- Helper CTE approach inlined per table below.

-- 1. employees (has legacy `branch` VARCHAR)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE employees e
   SET branch_id = b.id
  FROM branches b
 WHERE e.branch_id IS NULL
   AND e.branch IS NOT NULL
   AND TRIM(e.branch) <> ''
   AND b.name = TRIM(e.branch);
UPDATE employees
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);

-- 2. clients (no legacy column → all go to fallback)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE clients
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_branch ON clients(branch_id);

-- 3. candidates
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE candidates
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_branch ON candidates(branch_id);

-- 4. contracts
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE contracts
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_branch ON contracts(branch_id);

-- 5. job_vacancies (has legacy `branch` VARCHAR NOT NULL)
ALTER TABLE job_vacancies
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE job_vacancies v
   SET branch_id = b.id
  FROM branches b
 WHERE v.branch_id IS NULL
   AND v.branch IS NOT NULL
   AND TRIM(v.branch) <> ''
   AND b.name = TRIM(v.branch);
UPDATE job_vacancies
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_vacancies_branch ON job_vacancies(branch_id);

-- 6. job_applications (tracks a vacancy → derive)
ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE job_applications a
   SET branch_id = v.branch_id
  FROM job_vacancies v
 WHERE a.branch_id IS NULL
   AND a.job_vacancy_id = v.id;
UPDATE job_applications
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_applications_branch ON job_applications(branch_id);

-- 7. tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE tasks
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(branch_id);

-- 8. telemarketing_task_lists
ALTER TABLE telemarketing_task_lists
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE telemarketing_task_lists
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tm_task_lists_branch ON telemarketing_task_lists(branch_id);

-- 9. telemarketing_call_logs
ALTER TABLE telemarketing_call_logs
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE telemarketing_call_logs
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tm_call_logs_branch ON telemarketing_call_logs(branch_id);

-- 10. telemarketing_appointments
ALTER TABLE telemarketing_appointments
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE telemarketing_appointments
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tm_appointments_branch ON telemarketing_appointments(branch_id);

-- 11. training_courses (has legacy `branch` VARCHAR)
ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE RESTRICT;
UPDATE training_courses t
   SET branch_id = b.id
  FROM branches b
 WHERE t.branch_id IS NULL
   AND t.branch IS NOT NULL
   AND TRIM(t.branch) <> ''
   AND b.name = TRIM(t.branch);
UPDATE training_courses
   SET branch_id = (SELECT id FROM branches WHERE name = 'غير محدد')
 WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_training_courses_branch ON training_courses(branch_id);
