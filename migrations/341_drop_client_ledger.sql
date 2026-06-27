-- ============================================================
-- 341_drop_client_ledger.sql
-- ============================================================
-- إسقاط النسخة المُجسّدة القديمة لكشف الحساب (client_ledger_entries + triggers
-- + recalculate_client_balance) بعد اعتماد سجل الحركات الموحّد financial_movements
-- (migr 338) كمصدر حقيقة وحيد. كشف الحساب صار مشتقاً مباشرةً منه (clients.ts).
--
-- خلفية: 257/258/259 أنشأت جدول ledger مُجسّداً مع triggers تعيد حساب رصيد
-- الزبون كاملاً عند كل دفعة/قسط — يخالف DEC-CT-10، يطرح المقدّم مرّتين، ولا يرى
-- أموال المهام. لم يعد أي كود يقرأه (أُعيد توجيه /clients/:id/account-statement).
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_contract_payment_entries_ledger ON public.contract_payment_entries;
DROP TRIGGER IF EXISTS trg_contract_installments_ledger    ON public.contract_installments;

DO $$
BEGIN
  IF to_regclass('public.financial_transactions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_financial_transactions_ledger ON public.financial_transactions';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.sync_contract_payment_ledger()       CASCADE;
DROP FUNCTION IF EXISTS public.sync_contract_installment_ledger()   CASCADE;
DROP FUNCTION IF EXISTS public.sync_financial_transaction_ledger()  CASCADE;
DROP FUNCTION IF EXISTS public.recalculate_client_balance(integer)  CASCADE;

DROP TABLE IF EXISTS public.client_ledger_entries;

COMMIT;
