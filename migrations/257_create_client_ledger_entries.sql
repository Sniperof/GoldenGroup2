CREATE TABLE public.client_ledger_entries (
    id              SERIAL PRIMARY KEY,
    client_id       INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    entry_date      TIMESTAMP WITH TIME ZONE NOT NULL,
    entry_type      VARCHAR(50) NOT NULL CHECK (entry_type IN (
        'contract_payment',
        'maintenance_payment',
        'contract_installment',
        'contract_discount',
        'refund',
        'opening_balance'
    )),
    source_type     VARCHAR(50),
    source_id       INTEGER,
    source_entry_id INTEGER,
    description     TEXT NOT NULL,
    reference_no    VARCHAR(100),
    debit_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
    credit_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
    running_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
    recorded_by     INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT client_ledger_nonnegative_amounts CHECK (
        debit_amount >= 0 AND credit_amount >= 0
    )
);

CREATE INDEX idx_ledger_client_date
    ON public.client_ledger_entries(client_id, entry_date, id);

CREATE INDEX idx_ledger_source
    ON public.client_ledger_entries(source_type, source_id);

CREATE UNIQUE INDEX idx_ledger_source_entry
    ON public.client_ledger_entries(source_type, source_entry_id, entry_type)
    WHERE source_entry_id IS NOT NULL;
