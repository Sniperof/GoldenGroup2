-- Keep older staging databases compatible with the current payment API/schema.
ALTER TABLE public.contract_payment_entries
    ADD COLUMN IF NOT EXISTS entry_type VARCHAR(20) NOT NULL DEFAULT 'collection',
    ADD COLUMN IF NOT EXISTS installment_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contract_payment_entries_entry_type_check'
          AND conrelid = 'public.contract_payment_entries'::regclass
    ) THEN
        ALTER TABLE public.contract_payment_entries
            ADD CONSTRAINT contract_payment_entries_entry_type_check
            CHECK (entry_type IN ('collection', 'refund'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contract_payment_entries_installment_id_fkey'
          AND conrelid = 'public.contract_payment_entries'::regclass
    ) THEN
        ALTER TABLE public.contract_payment_entries
            ADD CONSTRAINT contract_payment_entries_installment_id_fkey
            FOREIGN KEY (installment_id)
            REFERENCES public.contract_installments(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_contract_payments_installment
    ON public.contract_payment_entries(installment_id)
    WHERE installment_id IS NOT NULL;

INSERT INTO public.client_ledger_entries (
    client_id,
    entry_date,
    entry_type,
    source_type,
    source_id,
    source_entry_id,
    description,
    reference_no,
    debit_amount,
    credit_amount,
    recorded_by,
    notes
)
SELECT
    c.customer_id,
    p.received_at,
    CASE WHEN p.entry_type = 'refund' THEN 'refund' ELSE 'contract_payment' END,
    'contract',
    c.id,
    p.id,
    CASE
        WHEN p.entry_type = 'refund'
            THEN 'مبلغ مرتجع للعقد ' || COALESCE(c.contract_number, c.id::text)
        ELSE 'دفعة عقد ' || COALESCE(c.contract_number, c.id::text)
    END,
    p.reference_number,
    CASE WHEN p.entry_type = 'refund' THEN p.amount_syp ELSE 0 END,
    CASE WHEN p.entry_type = 'refund' THEN 0 ELSE p.amount_syp END,
    p.received_by_employee_id,
    p.notes
FROM public.contract_payment_entries p
JOIN public.contracts c ON c.id = p.contract_id
WHERE c.customer_id IS NOT NULL
ON CONFLICT (source_type, source_entry_id, entry_type)
    WHERE source_entry_id IS NOT NULL
DO NOTHING;

INSERT INTO public.client_ledger_entries (
    client_id,
    entry_date,
    entry_type,
    source_type,
    source_id,
    source_entry_id,
    description,
    reference_no,
    debit_amount,
    credit_amount
)
SELECT
    c.customer_id,
    i.due_date::timestamptz,
    'contract_installment',
    'contract',
    c.id,
    i.id,
    'استحقاق قسط رقم ' || i.installment_number ||
        ' للعقد ' || COALESCE(c.contract_number, c.id::text),
    c.contract_number,
    i.amount_syp,
    0
FROM public.contract_installments i
JOIN public.contracts c ON c.id = i.contract_id
WHERE c.customer_id IS NOT NULL
  AND i.due_date >= CURRENT_DATE
ON CONFLICT (source_type, source_entry_id, entry_type)
    WHERE source_entry_id IS NOT NULL
DO NOTHING;

WITH balances AS (
    SELECT
        id,
        SUM(debit_amount - credit_amount) OVER (
            PARTITION BY client_id
            ORDER BY entry_date, id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS balance
    FROM public.client_ledger_entries
)
UPDATE public.client_ledger_entries ledger
SET running_balance = balances.balance
FROM balances
WHERE balances.id = ledger.id;
