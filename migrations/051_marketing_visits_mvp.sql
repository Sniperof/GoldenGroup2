-- Marketing Visit MVP
-- Phase 2 only: schema foundation for isolated marketing visits/tasks.
-- This migration does NOT touch the legacy visits table.

CREATE TABLE IF NOT EXISTS marketing_visits (
  id                       VARCHAR(100) PRIMARY KEY,
  branch_id                INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  client_id                INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  visit_type               VARCHAR(50) NOT NULL DEFAULT 'marketing'
                             CHECK (visit_type IN ('marketing')),
  status                   VARCHAR(50) NOT NULL DEFAULT 'scheduled'
                             CHECK (
                               status IN (
                                 'scheduled',
                                 'completed',
                                 'not_completed',
                                 'postponed_by_company',
                                 'postponed_by_customer',
                                 'cancelled',
                                 'needs_reschedule'
                               )
                             ),
  scheduled_date           VARCHAR(50) NOT NULL,
  scheduled_time           VARCHAR(50) NOT NULL,
  source_type              VARCHAR(50) NOT NULL DEFAULT 'telemarketing_appointment'
                             CHECK (source_type IN ('telemarketing_appointment')),
  source_id                VARCHAR(100) NOT NULL,
  contact_target_id        BIGINT REFERENCES contact_targets(id) ON DELETE SET NULL,
  task_list_id             VARCHAR(100) REFERENCES telemarketing_task_lists(id) ON DELETE SET NULL,
  task_list_item_id        VARCHAR(100) REFERENCES telemarketing_task_list_items(id) ON DELETE SET NULL,
  team_key                 VARCHAR(100),
  requested_device_model_id INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  requested_device_name    TEXT,
  water_source             VARCHAR(255),
  technician_notes         TEXT,
  customer_name            VARCHAR(255),
  customer_address         TEXT,
  customer_mobile          VARCHAR(50),
  supervisor_employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  technician_employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  trainee_employee_id      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  team_snapshot            JSONB,
  created_by               INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  completed_by             INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_marketing_visits_source UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_visits_branch_date
  ON marketing_visits(branch_id, scheduled_date);

CREATE INDEX IF NOT EXISTS idx_marketing_visits_branch_status
  ON marketing_visits(branch_id, status);

CREATE INDEX IF NOT EXISTS idx_marketing_visits_client
  ON marketing_visits(client_id);

CREATE INDEX IF NOT EXISTS idx_marketing_visits_contact_target
  ON marketing_visits(contact_target_id);

CREATE TABLE IF NOT EXISTS marketing_visit_tasks (
  id                    VARCHAR(100) PRIMARY KEY,
  visit_id              VARCHAR(100) NOT NULL REFERENCES marketing_visits(id) ON DELETE CASCADE,
  task_type             VARCHAR(50) NOT NULL DEFAULT 'device_demo'
                          CHECK (task_type IN ('device_demo')),
  status                VARCHAR(50) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'not_completed')),
  result                VARCHAR(50)
                          CHECK (
                            result IS NULL OR result IN (
                              'cash_offer_closed',
                              'installment_offer_closed',
                              'cash_offer_not_closed',
                              'installment_offer_not_closed',
                              'demo_not_completed'
                            )
                          ),
  cash_offer_amount     NUMERIC,
  installment_amount    NUMERIC,
  installment_months    INTEGER,
  closed_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  result_notes          TEXT,
  contract_id           INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_marketing_visit_tasks_visit_task UNIQUE (visit_id, task_type),
  CONSTRAINT chk_marketing_visit_task_amounts_non_negative
    CHECK (
      (cash_offer_amount IS NULL OR cash_offer_amount >= 0)
      AND (installment_amount IS NULL OR installment_amount >= 0)
      AND (installment_months IS NULL OR installment_months > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_marketing_visit_tasks_visit
  ON marketing_visit_tasks(visit_id);

CREATE INDEX IF NOT EXISTS idx_marketing_visit_tasks_status
  ON marketing_visit_tasks(status);
