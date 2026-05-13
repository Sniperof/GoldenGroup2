CREATE TABLE IF NOT EXISTS marketing_visit_task_offers (
  id                    BIGSERIAL       PRIMARY KEY,
  task_id               VARCHAR(100)    NOT NULL REFERENCES marketing_visit_tasks(id) ON DELETE CASCADE,
  device_model_id       INTEGER         NOT NULL,
  offer_type            VARCHAR(50)     NOT NULL
                          CHECK (offer_type IN ('cash', 'installment')),
  quantity              INTEGER         NOT NULL DEFAULT 1
                          CHECK (quantity > 0),
  total_amount          NUMERIC         NOT NULL
                          CHECK (total_amount >= 0),
  first_payment_amount  NUMERIC
                          CHECK (first_payment_amount IS NULL OR first_payment_amount >= 0),
  installment_months    INTEGER
                          CHECK (installment_months IS NULL OR installment_months > 0),
  currency              VARCHAR(10)     NOT NULL,
  discount_percentage   NUMERIC
                          CHECK (discount_percentage IS NULL OR discount_percentage >= 0),
  closed_by_employee_id INTEGER         REFERENCES hr_users(id) ON DELETE SET NULL,
  no_closing_reason     TEXT,
  customer_response     VARCHAR(50)
                          CHECK (customer_response IS NULL OR customer_response IN ('accepted', 'rejected', 'extension_requested')),
  rejection_reason_id   INTEGER,
  extension_reason_id   INTEGER,
  extension_due_date    DATE,
  sale_reference_number VARCHAR(100),
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mvto_task ON marketing_visit_task_offers(task_id);
