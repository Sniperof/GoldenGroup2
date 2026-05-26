-- 181_device_activation_results.sql
-- GAP-057: visit_task_device_activation_results table was referenced in old docs
-- but never created in any migration (001–147 checked). This migration creates it.
-- Stores technical measurements taken during device first-activation visits.
CREATE TABLE IF NOT EXISTS visit_task_device_activation_results (
  id                    BIGSERIAL        PRIMARY KEY,
  visit_task_result_id  BIGINT           NOT NULL UNIQUE
    REFERENCES visit_task_results(id) ON DELETE CASCADE,
  tds_before            NUMERIC(8,2)     DEFAULT NULL,
  tds_after             NUMERIC(8,2)     DEFAULT NULL,
  pump_pressure         NUMERIC(6,2)     DEFAULT NULL,
  uv_status             VARCHAR(50)      DEFAULT NULL
    CHECK (uv_status IN ('working', 'faulty', 'not_applicable')),
  customer_trained      BOOLEAN          NOT NULL DEFAULT FALSE,
  activation_notes      TEXT             DEFAULT NULL,
  activated_by_employee_id INTEGER       DEFAULT NULL
    REFERENCES employees(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
