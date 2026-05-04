-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 064: Customer Call Logs
-- Stores direct call history recorded against a customer (client) from the
-- ClientProfile contacts tab. These are ad-hoc calls NOT tied to a
-- telemarketing task list.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_call_logs (
  id              VARCHAR(100)  PRIMARY KEY,
  customer_id     INTEGER       NOT NULL REFERENCES clients(id),
  contact_id      VARCHAR(100),
  contact_number  VARCHAR(50),
  contact_label   VARCHAR(255),
  caller_id       INTEGER       REFERENCES hr_users(id),
  caller_role     VARCHAR(50),
  call_date       TIMESTAMPTZ   DEFAULT NOW(),
  outcome         VARCHAR(50)   NOT NULL,
  source_type     VARCHAR(50)   DEFAULT 'direct_call',
  source_id       VARCHAR(100),
  notes           TEXT,
  branch_id       INTEGER       REFERENCES branches(id),
  action_log      JSONB         DEFAULT '{}',
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_call_logs_customer ON customer_call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_call_logs_date    ON customer_call_logs(call_date);
