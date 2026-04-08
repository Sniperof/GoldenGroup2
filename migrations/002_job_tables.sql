-- ============================================================
-- Migration 002: HR / Recruitment tables (complete final schema)
-- Tables are created in their FINAL form — includes all columns
-- that were added via ALTER TABLE in later schema revisions.
-- No DROP TABLE statements — safe to run on existing databases.
-- ============================================================

-- Final column set includes required_certificate, required_major,
-- contact_methods (originally added in createHrUsers).
CREATE TABLE IF NOT EXISTS job_vacancies (
  id                        SERIAL PRIMARY KEY,
  title                     VARCHAR(255) NOT NULL,
  branch                    VARCHAR(255) NOT NULL,
  governorate               VARCHAR(255),
  city_or_area              VARCHAR(255),
  sub_area                  VARCHAR(255),
  neighborhood              VARCHAR(255),
  detailed_address          TEXT,
  work_type                 VARCHAR(100),
  required_gender           VARCHAR(20),
  required_age_min          INTEGER,
  required_age_max          INTEGER,
  email                     VARCHAR(255),
  required_qualification    VARCHAR(255),
  required_specialization   VARCHAR(255),
  required_certificate      VARCHAR(255),
  required_major            VARCHAR(255),
  required_experience_years INTEGER,
  required_skills           TEXT,
  responsibilities          TEXT,
  driving_license_required  BOOLEAN DEFAULT FALSE,
  vacancy_count             INTEGER NOT NULL CHECK (vacancy_count >= 0),
  max_retraining_count      INTEGER DEFAULT 1,
  contact_methods           JSONB DEFAULT '[]',
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  status                    VARCHAR(20) DEFAULT 'Open'
                              CHECK (status IN ('Open', 'Closed', 'Archived')),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_vacancy_dates CHECK (start_date <= end_date)
);

-- Final column set: nullable columns are created nullable from the start,
-- driving_license is VARCHAR(10) (not BOOLEAN) from the start,
-- has_whatsapp_primary/secondary and specialization included.
CREATE TABLE IF NOT EXISTS applicants (
  id                     SERIAL PRIMARY KEY,
  first_name             VARCHAR(255) NOT NULL,
  last_name              VARCHAR(255) NOT NULL,
  dob                    DATE         NOT NULL,
  gender                 VARCHAR(20)  NOT NULL,
  marital_status         VARCHAR(50)  NOT NULL,
  email                  VARCHAR(255),
  mobile_number          VARCHAR(20)  NOT NULL,
  secondary_mobile       VARCHAR(20),
  governorate            VARCHAR(255) NOT NULL,
  city_or_area           VARCHAR(255),
  sub_area               VARCHAR(255),
  neighborhood           VARCHAR(255),
  detailed_address       TEXT,
  academic_qualification VARCHAR(255),
  previous_employment    VARCHAR(255),
  driving_license        VARCHAR(10) DEFAULT NULL,
  expected_salary        INTEGER,
  computer_skills        TEXT,
  foreign_languages      TEXT,
  specialization         VARCHAR(255),
  years_of_experience    INTEGER,
  cv_url                 TEXT,
  photo_url              TEXT,
  applicant_segment      VARCHAR(100),
  has_whatsapp_primary   BOOLEAN DEFAULT FALSE,
  has_whatsapp_secondary BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrers (
  id              SERIAL PRIMARY KEY,
  type            VARCHAR(20) NOT NULL CHECK (type IN ('Employee', 'Customer')),
  employee_id     INTEGER REFERENCES employees(id),
  full_name       VARCHAR(255) NOT NULL,
  last_name       VARCHAR(255),
  mobile_number   VARCHAR(20)  NOT NULL,
  governorate     VARCHAR(255),
  city_or_area    VARCHAR(255),
  sub_area        VARCHAR(255),
  neighborhood    VARCHAR(255),
  detailed_address TEXT,
  referrer_work   VARCHAR(255),
  referrer_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Final column set includes job_vacancy_id, created_by_user_id, updated_at
-- (originally added in fixSchemaConstraints).
-- created_by_user_id has NO FK to employees — FK was dropped in createHrUsers.
CREATE TABLE IF NOT EXISTS training_courses (
  id                SERIAL PRIMARY KEY,
  training_name     VARCHAR(255) NOT NULL,
  job_vacancy_id    INTEGER REFERENCES job_vacancies(id),
  branch            VARCHAR(255),
  device_name       VARCHAR(255),
  trainer           VARCHAR(255) NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  training_status   VARCHAR(30) DEFAULT 'Training Scheduled'
                      CHECK (training_status IN ('Training Scheduled', 'Training Started', 'Training Completed')),
  notes             TEXT,
  created_by_user_id INTEGER,   -- FK to hr_users (no FK constraint — cross-user-type reference)
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Final column set: all columns including those added via ALTER TABLE.
-- application_source has no CHECK constraint (dropped in fixSchemaConstraints).
-- job_vacancy_id is nullable (NOT NULL dropped in fixSchemaConstraints).
-- entered_by_user_id has NO FK (FK to employees dropped in createHrUsers).
-- performed_by_user_id in audit_logs has NO FK (same reason).
CREATE TABLE IF NOT EXISTS job_applications (
  id                  SERIAL PRIMARY KEY,
  job_vacancy_id      INTEGER REFERENCES job_vacancies(id),   -- nullable
  applicant_id        INTEGER NOT NULL REFERENCES applicants(id),
  referrer_id         INTEGER REFERENCES referrers(id),
  submission_type     VARCHAR(30) NOT NULL
                        CHECK (submission_type IN ('Apply', 'Refer a Candidate')),
  application_source  VARCHAR(30) NOT NULL,                   -- no CHECK constraint
  entered_by_user_id  INTEGER,                                -- no FK
  entered_by_name     VARCHAR(255),
  current_stage       VARCHAR(30) NOT NULL DEFAULT 'Submitted'
                        CHECK (current_stage IN ('Submitted', 'Shortlisted', 'Interview', 'Training', 'Final Decision')),
  application_status  VARCHAR(30) NOT NULL DEFAULT 'New'
                        CHECK (application_status IN (
                          'New', 'In Review', 'Qualified', 'Rejected',
                          'Interview Scheduled', 'Interview Completed', 'Interview Failed',
                          'Approved',
                          'Training Scheduled', 'Training Started', 'Training Completed', 'Retraining',
                          'Passed',
                          'Final Hired', 'Final Rejected', 'Retreated'
                        )),
  stage_status        VARCHAR(30),
  decision            VARCHAR(30),
  duplicate_flag      BOOLEAN DEFAULT FALSE,
  hired_employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_escalated        BOOLEAN DEFAULT FALSE,
  escalated_at        TIMESTAMPTZ,
  is_archived         BOOLEAN DEFAULT FALSE,
  archived_at         TIMESTAMPTZ,
  internal_notes      TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- performed_by_user_id has NO FK (FK to employees dropped in createHrUsers).
-- application_id has NO FK (soft reference by design).
CREATE TABLE IF NOT EXISTS audit_logs (
  id                   SERIAL PRIMARY KEY,
  entity_type          VARCHAR(50)  NOT NULL,
  entity_id            INTEGER      NOT NULL,
  application_id       INTEGER,                 -- soft reference, no FK
  action_type          VARCHAR(100) NOT NULL,
  performed_by_role    VARCHAR(50),
  performed_by_user_id INTEGER,                 -- no FK
  old_value            TEXT,
  new_value            TEXT,
  internal_reason      TEXT,
  timestamp            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interviews (
  id               SERIAL PRIMARY KEY,
  application_id   INTEGER NOT NULL REFERENCES job_applications(id),
  interview_type   VARCHAR(30) NOT NULL
                     CHECK (interview_type IN ('HR Interview', 'Technical Interview')),
  interview_number VARCHAR(30) NOT NULL
                     CHECK (interview_number IN ('First Interview', 'Second Interview')),
  interviewer_name VARCHAR(255) NOT NULL,
  interview_date   DATE NOT NULL,
  interview_time   TIME NOT NULL,
  interview_status VARCHAR(30) DEFAULT 'Interview Scheduled'
                     CHECK (interview_status IN ('Interview Scheduled', 'Interview Completed', 'Interview Failed')),
  internal_notes   TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Final column set includes recorded_by_user_id (added in fixSchemaConstraints).
-- recorded_by_user_id has NO FK (FK to employees dropped in createHrUsers).
CREATE TABLE IF NOT EXISTS training_attendance (
  id                  SERIAL PRIMARY KEY,
  training_course_id  INTEGER NOT NULL REFERENCES training_courses(id),
  application_id      INTEGER NOT NULL REFERENCES job_applications(id),
  attendance_date     DATE NOT NULL,
  status              VARCHAR(20) NOT NULL CHECK (status IN ('Present', 'Absent')),
  recorded_by_user_id INTEGER,   -- no FK
  UNIQUE (training_course_id, application_id, attendance_date)
);

-- result_recorded_by has NO FK (FK to employees dropped in createHrUsers).
CREATE TABLE IF NOT EXISTS training_course_trainees (
  id                  SERIAL PRIMARY KEY,
  training_course_id  INTEGER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  application_id      INTEGER NOT NULL REFERENCES job_applications(id),
  result              VARCHAR(30) CHECK (result IN ('Passed', 'Retraining', 'Rejected', 'Retreated')),
  result_recorded_at  TIMESTAMPTZ,
  result_recorded_by  INTEGER,   -- no FK
  added_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (training_course_id, application_id)
);
