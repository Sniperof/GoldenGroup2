-- 496: Collection reversal («عكس التحصيل») + RESTRICT on FX references (2026-11-13)
--
-- D3 — a recorded installment collection (contract or maintenance; golden
-- warranty out of scope) is corrected by REVERSAL, never by editing or deleting
-- ledger rows. Reversal appends opposite rows:
--   * a refund-type payment entry per reversed entry (reverses_entry_id), so the
--     balance recompute restores the installment (and usd_settled restores the
--     remaining USD on a USD-linked one);
--   * a financial_movements line (kind = refund, reverses_id) per entry;
--   * an opposite branch_fx_differences row (reverses_id).
--   Every collection entry now carries visit_task_result_id so a whole result
--   (several payment parts) can be reversed together.
-- D7 — rows that branch_fx_differences / exchange_rates point at can no longer
--   be deleted silently (SET NULL would also hit the append-only trigger and
--   fail with a raw error): the FKs become RESTRICT and the routes answer with
--   a clear Arabic message.
-- Permission collections.reverse is DEFINED only — no role grants.

BEGIN;

-- ── 1) Permission (no grants) ───────────────────────────────────────────────
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('collections.reverse', 'tasks', 'collections', 'reverse',
   'عكس تحصيل قسط', 215, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- ── 2) Contract payment entries: result link + reversal link ───────────────
ALTER TABLE public.contract_payment_entries
  ADD COLUMN IF NOT EXISTS visit_task_result_id BIGINT NULL
    REFERENCES public.visit_task_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverses_entry_id INTEGER NULL
    REFERENCES public.contract_payment_entries(id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX IF NOT EXISTS ux_contract_payment_entries_reverses
  ON public.contract_payment_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_payment_entries_vtr
  ON public.contract_payment_entries (visit_task_result_id) WHERE visit_task_result_id IS NOT NULL;

-- ── 3) Maintenance payment entries: refund support + links ─────────────────
ALTER TABLE public.emergency_payment_entries
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR(20) NOT NULL DEFAULT 'collection',
  ADD COLUMN IF NOT EXISTS visit_task_result_id BIGINT NULL
    REFERENCES public.visit_task_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverses_entry_id INTEGER NULL
    REFERENCES public.emergency_payment_entries(id) ON DELETE NO ACTION,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL;
ALTER TABLE public.emergency_payment_entries
  DROP CONSTRAINT IF EXISTS emergency_payment_entries_entry_type_ck;
ALTER TABLE public.emergency_payment_entries
  ADD CONSTRAINT emergency_payment_entries_entry_type_ck
  CHECK (entry_type IN ('collection', 'refund'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_emergency_payment_entries_reverses
  ON public.emergency_payment_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emergency_payment_entries_vtr
  ON public.emergency_payment_entries (visit_task_result_id) WHERE visit_task_result_id IS NOT NULL;

-- Balance recompute: a refund entry subtracts (same rule as contracts).
CREATE OR REPLACE FUNCTION public.recompute_maintenance_installment_balance(p_installment_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_amount NUMERIC; v_due DATE; v_paid NUMERIC; v_remaining NUMERIC;
BEGIN
  IF p_installment_id IS NULL THEN RETURN; END IF;
  SELECT amount_syp, due_date INTO v_amount, v_due
    FROM public.emergency_installments WHERE id = p_installment_id;
  IF v_amount IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END), 0) INTO v_paid
    FROM public.emergency_payment_entries WHERE installment_id = p_installment_id;
  v_remaining := GREATEST(v_amount - v_paid, 0);
  UPDATE public.emergency_installments
     SET paid_amount = v_paid,
         remaining_balance = v_remaining,
         status = CASE
           WHEN v_remaining <= 0                    THEN 'paid'
           WHEN v_paid > 0                          THEN 'partial'
           WHEN v_due < CURRENT_DATE                THEN 'overdue'
           ELSE 'pending' END
   WHERE id = p_installment_id;
END;
$function$;

-- ── 4) Collector side table: reversal stamp of the current result ──────────
ALTER TABLE public.visit_task_installment_collection_results
  ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reversed_by     INTEGER NULL REFERENCES public.hr_users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT NULL;

-- ── 5) FX ledger: reversal link + RESTRICT references (D7) ─────────────────
ALTER TABLE public.branch_fx_differences
  ADD COLUMN IF NOT EXISTS reverses_id BIGINT NULL
    REFERENCES public.branch_fx_differences(id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX IF NOT EXISTS ux_branch_fx_differences_reverses
  ON public.branch_fx_differences (reverses_id) WHERE reverses_id IS NOT NULL;

ALTER TABLE public.branch_fx_differences
  DROP CONSTRAINT IF EXISTS branch_fx_differences_contract_id_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_installment_id_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_payment_entry_id_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_visit_task_result_id_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_recorded_by_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_maintenance_installment_id_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_maintenance_payment_entry_id_fkey,
  DROP CONSTRAINT IF EXISTS branch_fx_differences_open_task_id_fkey;
ALTER TABLE public.branch_fx_differences
  ADD CONSTRAINT branch_fx_differences_contract_id_fkey
    FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_installment_id_fkey
    FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_payment_entry_id_fkey
    FOREIGN KEY (payment_entry_id) REFERENCES public.contract_payment_entries(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_visit_task_result_id_fkey
    FOREIGN KEY (visit_task_result_id) REFERENCES public.visit_task_results(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_recorded_by_fkey
    FOREIGN KEY (recorded_by) REFERENCES public.hr_users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_maintenance_installment_id_fkey
    FOREIGN KEY (maintenance_installment_id) REFERENCES public.emergency_installments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_maintenance_payment_entry_id_fkey
    FOREIGN KEY (maintenance_payment_entry_id) REFERENCES public.emergency_payment_entries(id) ON DELETE RESTRICT,
  ADD CONSTRAINT branch_fx_differences_open_task_id_fkey
    FOREIGN KEY (open_task_id) REFERENCES public.open_tasks(id) ON DELETE RESTRICT;

ALTER TABLE public.exchange_rates
  DROP CONSTRAINT IF EXISTS exchange_rates_created_by_fkey;
ALTER TABLE public.exchange_rates
  ADD CONSTRAINT exchange_rates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.hr_users(id) ON DELETE RESTRICT;

COMMIT;
