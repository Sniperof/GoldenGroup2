-- ============================================================
-- 467_backfill_imported_contract_financial_movements.sql
-- ============================================================
-- Repair contract rows imported after migration 338. Those rows already carry
-- contract_payment_entries and contract_installments, but their corresponding
-- append-only financial_movements were never materialized. Reports therefore
-- saw the full contract value even when historical payments existed.
--
-- This deliberately mirrors syncContractMovements():
--   * definitive contracts only;
--   * active/completed only (drafts have no financial effect);
--   * cancelled contracts remain excluded because their historical
--     discount/refund reconstruction requires a separate audited policy;
--   * contracts whose installment schedule exceeds final_price remain excluded
--     for manual reconciliation instead of freezing a known-wrong obligation;
--   * ON CONFLICT makes the repair safe to rerun and never mutates the ledger.
-- ============================================================

BEGIN;

-- Signing obligation = final price minus the scheduled installments. This is
-- the cash amount for cash sales and the down-payment obligation for installment
-- sales. Together with installment charges it equals the contract final price.
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, source_type, source_id,
  source_ref_id, contract_id, description, occurred_branch_id, notes
)
SELECT contract.customer_id,
       contract.created_at,
       'charge',
       (contract.final_price - COALESCE(installments.total_amount, 0))::numeric(14,2),
       'contract',
       contract.id,
       contract.id,
       contract.id,
       'استحقاق العقد ' || COALESCE(contract.contract_number, contract.id::text) || ' عند التوقيع',
       contract.branch_id,
       'ترحيل 467: استكمال دفتر الحركات للعقود التاريخية المستوردة'
  FROM public.contracts contract
  LEFT JOIN (
    SELECT installment.contract_id, SUM(installment.amount_syp) AS total_amount
      FROM public.contract_installments installment
     GROUP BY installment.contract_id
  ) installments ON installments.contract_id = contract.id
 WHERE contract.customer_id IS NOT NULL
   AND contract.status IN ('active', 'completed')
   AND contract.sale_subtype = 'definitive'
   AND COALESCE(installments.total_amount, 0) <= contract.final_price
   AND (contract.final_price - COALESCE(installments.total_amount, 0)) > 0
ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
DO NOTHING;

-- Every scheduled installment is its own obligation on its original due date.
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, source_type, source_id,
  source_ref_id, contract_id, description, occurred_branch_id, notes
)
SELECT contract.customer_id,
       installment.due_date::timestamp AT TIME ZONE 'Asia/Damascus',
       'charge',
       installment.amount_syp::numeric(14,2),
       'contract_installment',
       contract.id,
       installment.id,
       contract.id,
       'استحقاق قسط رقم ' || installment.installment_number || ' للعقد '
         || COALESCE(contract.contract_number, contract.id::text),
       contract.branch_id,
       'ترحيل 467: استكمال دفتر الحركات للعقود التاريخية المستوردة'
  FROM public.contract_installments installment
  JOIN public.contracts contract ON contract.id = installment.contract_id
 WHERE contract.customer_id IS NOT NULL
   AND contract.status IN ('active', 'completed')
   AND contract.sale_subtype = 'definitive'
   AND COALESCE((
         SELECT SUM(schedule.amount_syp)
           FROM public.contract_installments schedule
          WHERE schedule.contract_id = contract.id
       ), 0) <= contract.final_price
   AND installment.amount_syp > 0
ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
DO NOTHING;

-- Materialize each historical collection/refund exactly once. The payment entry
-- id is the provenance key, so the down payment cannot be inserted twice.
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, currency, amount_original,
  exchange_rate, source_type, source_id, source_ref_id, contract_id,
  description, reference_no, occurred_branch_id, notes
)
SELECT contract.customer_id,
       payment.received_at,
       CASE WHEN payment.entry_type = 'refund' THEN 'refund' ELSE 'payment' END,
       payment.amount_syp::numeric(14,2),
       COALESCE(payment.currency, 'SYP'),
       payment.amount_value::numeric(14,2),
       payment.exchange_rate,
       'contract_payment',
       contract.id,
       payment.id,
       contract.id,
       CASE WHEN payment.entry_type = 'refund'
            THEN 'مبلغ مرتجع للعقد '
            ELSE 'دفعة عقد '
       END || COALESCE(contract.contract_number, contract.id::text),
       payment.reference_number,
       contract.branch_id,
       'ترحيل 467: استكمال دفتر الحركات للعقود التاريخية المستوردة'
  FROM public.contract_payment_entries payment
  JOIN public.contracts contract ON contract.id = payment.contract_id
 WHERE contract.customer_id IS NOT NULL
   AND contract.status IN ('active', 'completed')
   AND contract.sale_subtype = 'definitive'
   AND COALESCE((
         SELECT SUM(schedule.amount_syp)
           FROM public.contract_installments schedule
          WHERE schedule.contract_id = contract.id
       ), 0) <= contract.final_price
   AND payment.amount_syp > 0
ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
DO NOTHING;

COMMIT;
