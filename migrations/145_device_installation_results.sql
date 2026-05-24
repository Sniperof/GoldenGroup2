-- 145_device_installation_results.sql
BEGIN;

CREATE TABLE IF NOT EXISTS open_task_installation_results (
  id                       BIGSERIAL   PRIMARY KEY,
  open_task_id             INTEGER     NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
  CONSTRAINT uq_open_task_installation_result UNIQUE (open_task_id),

  outcome                  VARCHAR(50) NOT NULL CHECK (outcome IN (
    'installed_successfully', 'installation_incomplete', 'site_not_ready'
  )),

  water_source_type        VARCHAR(50),
  pipe_type                VARCHAR(50),
  pipe_length_meters       NUMERIC(8,2),
  electrical_connection    BOOLEAN NOT NULL DEFAULT FALSE,
  wall_mounting_done       BOOLEAN NOT NULL DEFAULT FALSE,
  installed_accessories    JSONB NOT NULL DEFAULT '[]',

  installation_start_date  DATE,
  installation_end_date    DATE,

  before_photos            JSONB NOT NULL DEFAULT '[]',
  after_photos             JSONB NOT NULL DEFAULT '[]',
  technical_notes          TEXT,

  installed_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('tasks.installation.view',   'tasks', 'installation', 'view',   'عرض نتائج التركيب',   305),
  ('tasks.installation.result', 'tasks', 'installation', 'result', 'تسجيل نتيجة تركيب',   306)
ON CONFLICT (key) DO NOTHING;

COMMIT;
