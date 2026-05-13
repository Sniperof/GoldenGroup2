CREATE TABLE IF NOT EXISTS open_task_pre_offers (
  id                    BIGSERIAL       PRIMARY KEY,
  open_task_id          INTEGER         NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
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
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otpo_task ON open_task_pre_offers(open_task_id);
