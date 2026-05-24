-- Migration 149: Unified post-sale result tables under visit_task_results
-- Part of Phase 3: Unified Result Pattern.
-- Adds delivery_result child columns, creates installation + activation tables,
-- and expands visit_tasks.task_type to include post-sale types.

BEGIN;

-- 1. Add missing columns to existing visit_task_device_delivery_results
ALTER TABLE visit_task_device_delivery_results
  ADD COLUMN IF NOT EXISTS outcome           VARCHAR(50)
    CHECK (outcome IN (
      'delivered_successfully', 'customer_not_available',
      'wrong_address', 'refused_delivery'
    )),
  ADD COLUMN IF NOT EXISTS delivery_lat      NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS delivery_lng      NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS notes             TEXT;

-- 2. Create visit_task_device_installation_results
CREATE TABLE IF NOT EXISTS visit_task_device_installation_results (
  id                       BIGSERIAL    PRIMARY KEY,
  visit_task_result_id     BIGINT       NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtdir_result UNIQUE (visit_task_result_id),

  outcome                  VARCHAR(50)  NOT NULL
    CHECK (outcome IN ('installed_successfully', 'installation_incomplete', 'site_not_ready')),

  water_source_type        VARCHAR(50),
  pipe_type                VARCHAR(50),
  pipe_length_meters       NUMERIC(8,2),
  electrical_connection    BOOLEAN      NOT NULL DEFAULT FALSE,
  wall_mounting_done       BOOLEAN      NOT NULL DEFAULT FALSE,
  installed_accessories    JSONB        NOT NULL DEFAULT '[]',
  installation_start_date  DATE,
  installation_end_date    DATE,
  before_photos            JSONB        NOT NULL DEFAULT '[]',
  after_photos             JSONB        NOT NULL DEFAULT '[]',
  technical_notes          TEXT,
  installed_by_employee_id INTEGER      REFERENCES employees(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 3. Create visit_task_device_activation_results
CREATE TABLE IF NOT EXISTS visit_task_device_activation_results (
  id                       BIGSERIAL    PRIMARY KEY,
  visit_task_result_id     BIGINT       NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtdar_result UNIQUE (visit_task_result_id),

  outcome                  VARCHAR(50)  NOT NULL
    CHECK (outcome IN ('activated_successfully', 'activation_failed', 'device_issue')),

  tds_before               NUMERIC,
  tds_after                NUMERIC,
  pump_pressure            NUMERIC,
  membrane_output          VARCHAR(50),
  tank_pressure            NUMERIC,
  uv_status                VARCHAR(50),
  customer_trained         BOOLEAN      NOT NULL DEFAULT FALSE,
  training_notes           TEXT,
  activation_photos        JSONB        NOT NULL DEFAULT '[]',
  activated_by_employee_id INTEGER      REFERENCES employees(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 4. Expand visit_tasks.task_type to include post-sale types
ALTER TABLE visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_task_type_check;

ALTER TABLE visit_tasks
  ADD CONSTRAINT visit_tasks_task_type_check
  CHECK (task_type IN (
    'device_demo',
    'emergency_maintenance',
    'device_delivery',
    'device_installation',
    'device_activation'
  ));

COMMIT;
