-- Migration 121: Structured payment entries + installment schedule

-- ── 1. Payment entries (partial payments) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_payment_entries (
  id                  SERIAL PRIMARY KEY,
  costs_id            INTEGER NOT NULL REFERENCES emergency_result_costs(id) ON DELETE CASCADE,
  method              VARCHAR(20) NOT NULL,          -- 'hand' | 'transfer' | 'barter'
  amount_value        NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency            VARCHAR(5)  DEFAULT 'syp',     -- 'syp' | 'usd'
  exchange_rate       NUMERIC(10,2),
  amount_syp          NUMERIC(12,2) NOT NULL DEFAULT 0,
  transfer_company_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  barter_description  TEXT,
  sort_order          INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Installment schedule ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_installments (
  id                  SERIAL PRIMARY KEY,
  costs_id            INTEGER NOT NULL REFERENCES emergency_result_costs(id) ON DELETE CASCADE,
  open_task_id        INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL,
  installment_number  INTEGER NOT NULL,
  due_date            DATE NOT NULL,
  amount_syp          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status              VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'paid'
  due_id              INTEGER REFERENCES dues(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Flags on emergency_result_costs ────────────────────────────────────────
ALTER TABLE emergency_result_costs
  ADD COLUMN IF NOT EXISTS has_first_payment       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS installments_count      INTEGER,
  ADD COLUMN IF NOT EXISTS installments_confirmed  BOOLEAN DEFAULT FALSE;
