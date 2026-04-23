ALTER TABLE job_vacancies
  ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_vacancies_department
  ON job_vacancies(department_id);
