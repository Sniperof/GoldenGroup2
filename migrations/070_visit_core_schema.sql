-- Migration 070: Visit Core Schema
-- Adds the general field_visits / visit_tasks / visit_task_results nucleus.
-- Phase 1 supports task types: device_demo, emergency_maintenance.
-- Purely additive — no existing table is touched.
-- Note: table is named field_visits (not visits) to avoid the legacy visits table.

-- ── 1. field_visits ───────────────────────────────────────────────────────────
-- Represents a single field visit, regardless of type.
-- status values include all marketing-visit statuses so bridging is loss-free.
CREATE TABLE IF NOT EXISTS field_visits (
  id                  BIGSERIAL       PRIMARY KEY,
  visit_type          VARCHAR(50)     NOT NULL
                        CHECK (visit_type IN ('marketing', 'emergency')),
  visit_family        VARCHAR(50)     NOT NULL
                        CHECK (visit_family IN ('marketing', 'service')),
  status              VARCHAR(50)     NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN (
                          'scheduled',
                          'in_progress',
                          'completed',
                          'not_completed',
                          'postponed_by_company',
                          'postponed_by_customer',
                          'cancelled',
                          'needs_reschedule'
                        )),
  client_id           INTEGER         NOT NULL REFERENCES clients(id)  ON DELETE RESTRICT,
  branch_id           INTEGER         NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  scheduled_date      DATE,
  scheduled_time      VARCHAR(50),
  -- Strangler bridge: trace back to the originating legacy record
  source_legacy_type  VARCHAR(50),    -- 'marketing_visit' | 'emergency_ticket'
  source_legacy_id    VARCHAR(100),
  team_snapshot       JSONB,
  field_notes         TEXT,
  closed_by           INTEGER         REFERENCES hr_users(id) ON DELETE SET NULL,
  closed_at           TIMESTAMPTZ,
  created_by          INTEGER         REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_field_visits_legacy UNIQUE (source_legacy_type, source_legacy_id)
);

CREATE INDEX IF NOT EXISTS idx_field_visits_client
  ON field_visits(client_id);
CREATE INDEX IF NOT EXISTS idx_field_visits_branch_date
  ON field_visits(branch_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_field_visits_status
  ON field_visits(status);
CREATE INDEX IF NOT EXISTS idx_field_visits_legacy
  ON field_visits(source_legacy_type, source_legacy_id);


-- ── 2. visit_tasks ────────────────────────────────────────────────────────────
-- Operational record of a single task executed within a field visit.
-- A visit may contain multiple tasks; each task is independent.
-- The true completion of a task is recorded in visit_task_results — not here.
CREATE TABLE IF NOT EXISTS visit_tasks (
  id                  BIGSERIAL       PRIMARY KEY,
  field_visit_id      BIGINT          NOT NULL REFERENCES field_visits(id) ON DELETE CASCADE,
  source_open_task_id INTEGER         REFERENCES open_tasks(id) ON DELETE SET NULL,
  task_type           VARCHAR(50)     NOT NULL
                        CHECK (task_type IN ('device_demo', 'emergency_maintenance')),
  task_family         VARCHAR(50)     NOT NULL
                        CHECK (task_family IN ('marketing', 'service')),
  sequence_no         INTEGER         NOT NULL DEFAULT 1,
  status              VARCHAR(50)     NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',
                          'in_progress',
                          'completed',
                          'not_completed',
                          'cancelled'
                        )),
  execution_notes     TEXT,
  -- Strangler bridge: trace back to the originating legacy task record
  source_legacy_type  VARCHAR(50),    -- 'marketing_visit_task'
  source_legacy_id    VARCHAR(100),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_visit_tasks_legacy UNIQUE (source_legacy_type, source_legacy_id)
);

CREATE INDEX IF NOT EXISTS idx_visit_tasks_field_visit
  ON visit_tasks(field_visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_tasks_open_task
  ON visit_tasks(source_open_task_id);
CREATE INDEX IF NOT EXISTS idx_visit_tasks_status
  ON visit_tasks(status);


-- ── 3. visit_task_results ─────────────────────────────────────────────────────
-- One general result per visit_task (UNIQUE on visit_task_id).
-- Specialized financial/technical details live in the tables below.
CREATE TABLE IF NOT EXISTS visit_task_results (
  id              BIGSERIAL       PRIMARY KEY,
  visit_task_id   BIGINT          NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
  CONSTRAINT uq_visit_task_results_task UNIQUE (visit_task_id),
  -- For device_demo: one of the 5 MarketingVisitTaskResult codes.
  -- For non-completed visits: 'not_completed'.
  final_decision  VARCHAR(100)    NOT NULL,
  -- Captures the visit-level reason when final_decision = 'not_completed'
  -- (e.g. 'postponed_by_company', 'cancelled', 'needs_reschedule').
  reason_code     VARCHAR(100),
  closing_notes   TEXT,
  closed_by       INTEGER         REFERENCES hr_users(id) ON DELETE SET NULL,
  closed_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_task_results_task
  ON visit_task_results(visit_task_id);


-- ── 4a. visit_task_device_demo_results ───────────────────────────────────────
-- Financial and closure details specific to a device_demo task result.
-- Only created when an offer was actually presented (not for demo_not_completed).
CREATE TABLE IF NOT EXISTS visit_task_device_demo_results (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_result_id  BIGINT      NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtddr_result UNIQUE (visit_task_result_id),
  offer_type            VARCHAR(50)
                          CHECK (offer_type IS NULL OR offer_type IN ('cash', 'installment')),
  offer_amount          NUMERIC
                          CHECK (offer_amount IS NULL OR offer_amount >= 0),
  installment_months    INTEGER
                          CHECK (installment_months IS NULL OR installment_months > 0),
  closed_by_employee_id INTEGER     REFERENCES employees(id) ON DELETE SET NULL,
  contract_id           INTEGER     REFERENCES contracts(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 4b. visit_task_emergency_technical_states ────────────────────────────────
-- Technical diagnostic snapshot for an emergency_maintenance task.
-- One record per visit_task (UNIQUE on visit_task_id).
CREATE TABLE IF NOT EXISTS visit_task_emergency_technical_states (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_id         BIGINT      NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtets_task UNIQUE (visit_task_id),
  problem_confirmed     BOOLEAN,
  technical_notes       TEXT,
  water_tds_before      NUMERIC,
  water_tds_after       NUMERIC,
  pump_pressure         NUMERIC,
  membrane_output       VARCHAR(50)
                          CHECK (membrane_output IS NULL
                                 OR membrane_output IN ('Good', 'Weak', 'Dead')),
  tank_pressure         NUMERIC,
  low_pressure_switch   VARCHAR(100),
  high_pressure_switch  VARCHAR(100),
  solenoid_valve        VARCHAR(100),
  uv_status             VARCHAR(100),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vtets_task
  ON visit_task_emergency_technical_states(visit_task_id);


-- ── 4c. visit_task_emergency_parts_used ──────────────────────────────────────
-- Parts consumed during an emergency_maintenance visit task.
-- Multiple rows per visit_task are allowed (one per part line).
CREATE TABLE IF NOT EXISTS visit_task_emergency_parts_used (
  id                    BIGSERIAL    PRIMARY KEY,
  visit_task_id         BIGINT       NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
  spare_part_id         INTEGER      REFERENCES spare_parts(id) ON DELETE SET NULL,
  part_name_snapshot    VARCHAR(255) NOT NULL,
  quantity              INTEGER      NOT NULL DEFAULT 1
                           CHECK (quantity > 0),
  unit_price            NUMERIC
                           CHECK (unit_price IS NULL OR unit_price >= 0),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vtepu_task
  ON visit_task_emergency_parts_used(visit_task_id);


-- ── 4d. visit_task_emergency_financials ──────────────────────────────────────
-- Aggregated financial record for an emergency_maintenance task.
-- One record per visit_task (UNIQUE on visit_task_id).
CREATE TABLE IF NOT EXISTS visit_task_emergency_financials (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_id         BIGINT      NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtef_task UNIQUE (visit_task_id),
  labor_cost            NUMERIC     CHECK (labor_cost       IS NULL OR labor_cost       >= 0),
  parts_cost            NUMERIC     CHECK (parts_cost       IS NULL OR parts_cost       >= 0),
  total_cost            NUMERIC     CHECK (total_cost       IS NULL OR total_cost       >= 0),
  payment_method        VARCHAR(50),
  collected_amount      NUMERIC     CHECK (collected_amount IS NULL OR collected_amount >= 0),
  invoice_notes         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
