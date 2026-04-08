-- ============================================================
-- Migration 004: Column additions for existing tables
-- All statements use ADD COLUMN IF NOT EXISTS so they are safe
-- to run against databases created at any prior schema revision.
-- ============================================================

-- ── employees ──────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title  VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch     VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS residence  VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ── clients ────────────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_name   VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS father_name  VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_name    VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nickname     VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS occupation   VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS water_source VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes        TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rating       VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referrers    JSONB DEFAULT '[]';

-- ── branches ───────────────────────────────────────────────
ALTER TABLE branches ADD COLUMN IF NOT EXISTS contact_info JSONB DEFAULT '[]';

-- ── job_vacancies ──────────────────────────────────────────
ALTER TABLE job_vacancies ADD COLUMN IF NOT EXISTS required_certificate VARCHAR(255);
ALTER TABLE job_vacancies ADD COLUMN IF NOT EXISTS required_major       VARCHAR(255);
ALTER TABLE job_vacancies ADD COLUMN IF NOT EXISTS contact_methods      JSONB DEFAULT '[]';

-- ── applicants ─────────────────────────────────────────────
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS has_whatsapp_primary   BOOLEAN DEFAULT FALSE;
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS has_whatsapp_secondary BOOLEAN DEFAULT FALSE;
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS specialization         VARCHAR(255);

-- ── training_courses ───────────────────────────────────────
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS job_vacancy_id     INTEGER REFERENCES job_vacancies(id);
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

-- ── job_applications ───────────────────────────────────────
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS hired_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS is_archived        BOOLEAN DEFAULT FALSE;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS archived_at        TIMESTAMPTZ;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS stage_status       VARCHAR(30);
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS decision           VARCHAR(30);
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS is_escalated       BOOLEAN DEFAULT FALSE;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS escalated_at       TIMESTAMPTZ;

-- ── training_attendance ────────────────────────────────────
ALTER TABLE training_attendance ADD COLUMN IF NOT EXISTS recorded_by_user_id INTEGER;

-- ── hr_users ───────────────────────────────────────────────
ALTER TABLE hr_users ADD COLUMN IF NOT EXISTS role_id     INTEGER;
ALTER TABLE hr_users ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

-- ── Data migration: derive stage_status / decision for existing rows ──
-- Runs only for rows that pre-date the stage_status column.
-- WHERE clause makes it idempotent.
UPDATE job_applications SET
  stage_status = CASE
    WHEN current_stage = 'Submitted'      AND application_status = 'New'                             THEN 'Pending'
    WHEN current_stage = 'Submitted'      AND application_status IN ('In Review', 'Rejected')        THEN 'Under Review'
    WHEN current_stage = 'Shortlisted'                                                                THEN 'Ready'
    WHEN current_stage = 'Interview'      AND application_status = 'Interview Scheduled'             THEN 'Scheduled'
    WHEN current_stage = 'Interview'      AND application_status IN ('Interview Completed', 'Interview Failed') THEN 'Completed'
    WHEN current_stage = 'Training'       AND application_status IN ('Approved', 'Retraining')       THEN 'Ready'
    WHEN current_stage = 'Training'       AND application_status = 'Training Scheduled'              THEN 'Scheduled'
    WHEN current_stage = 'Training'       AND application_status = 'Training Started'                THEN 'In Progress'
    WHEN current_stage = 'Training'       AND application_status = 'Training Completed'              THEN 'Completed'
    WHEN current_stage = 'Final Decision'                                                             THEN 'Awaiting Decision'
    ELSE 'Pending'
  END,
  decision = CASE application_status
    WHEN 'Qualified'      THEN 'Qualified'
    WHEN 'Rejected'       THEN 'Rejected'
    WHEN 'Interview Failed' THEN 'Failed'
    WHEN 'Approved'       THEN 'Approved'
    WHEN 'Retraining'     THEN 'Retraining'
    WHEN 'Passed'         THEN 'Passed'
    WHEN 'Final Hired'    THEN 'Hired'
    WHEN 'Final Rejected' THEN 'Rejected'
    WHEN 'Retreated'      THEN 'Retreated'
    ELSE NULL
  END
WHERE stage_status IS NULL;
