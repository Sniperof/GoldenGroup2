-- 1. Payment entries (multiple payments per contract)
CREATE TABLE IF NOT EXISTS contract_payment_entries (
  id                  SERIAL PRIMARY KEY,
  contract_id         INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  method              VARCHAR(50) NOT NULL
    CHECK (method IN ('cash', 'sham_cash', 'syriatel_cash', 'mtn_cash', 'alharam', 'bank_transfer', 'barter', 'usd_cash')),
  currency            VARCHAR(10) NOT NULL DEFAULT 'SYP',
  amount_value        NUMERIC NOT NULL CHECK (amount_value >= 0),
  exchange_rate       NUMERIC CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  amount_syp          NUMERIC NOT NULL CHECK (amount_syp >= 0),
  reference_number    VARCHAR(255),
  barter_name         VARCHAR(255),
  barter_value_syp    NUMERIC CHECK (barter_value_syp >= 0),
  received_by_employee_id INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_payments_contract ON contract_payment_entries(contract_id);

-- 2. Installment schedule
CREATE TABLE IF NOT EXISTS contract_installments (
  id                  SERIAL PRIMARY KEY,
  contract_id         INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  installment_number  INTEGER NOT NULL,
  due_date            DATE NOT NULL,
  amount_syp          NUMERIC NOT NULL CHECK (amount_syp >= 0),
  status              VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'partial', 'overdue')),
  paid_amount         NUMERIC NOT NULL DEFAULT 0,
  remaining_balance   NUMERIC NOT NULL DEFAULT 0,
  confirmed           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_contract_installments_contract ON contract_installments(contract_id);

-- 3. Add closing fields to contracts
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS closing_employee_id INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closing_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_notes TEXT,
  ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(100);
