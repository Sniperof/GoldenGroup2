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
