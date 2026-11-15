-- 495: USD-linked maintenance installments (periodic + emergency) — stage 2
--
-- Mirrors 493/494 for the deferred part of a maintenance bill:
--   * emergency_result_costs.usd_rate_snapshot — central rate (SYP per 1 USD)
--     taken when the maintenance schedule is confirmed.
--   * emergency_installments.amount_usd — fixed USD per installment,
--     round(amount_syp / snapshot, 2), computed server-side.
--   * emergency_payment_entries gains the 493 USD-link columns (collected_syp,
--     usd_settled, day_rate — USD-linked installment collections only) and the
--     494 reference columns (ref_rate, ref_usd — every new payment, spot cash
--     included, informational only, filled by trigger).
--   * branch_fx_differences accepts source_kind 'maintenance_installment',
--     keyed by the maintenance installment / payment entry / task. Branch =
--     the maintenance task's branch (there is no contract).
-- Cash paid on the spot is NOT linked (only the deferred amount is). Schedules
-- confirmed before this migration stay legacy (NULL = today's behaviour).
-- Golden-warranty installments are out of scope and untouched.

BEGIN;

-- ── 1) Schedule snapshot + fixed USD per installment ───────────────────────
ALTER TABLE public.emergency_result_costs
  ADD COLUMN IF NOT EXISTS usd_rate_snapshot    NUMERIC(14,4) NULL,
  ADD COLUMN IF NOT EXISTS usd_rate_snapshot_at TIMESTAMPTZ NULL;
ALTER TABLE public.emergency_result_costs
  DROP CONSTRAINT IF EXISTS emergency_result_costs_usd_rate_snapshot_ck;
ALTER TABLE public.emergency_result_costs
  ADD CONSTRAINT emergency_result_costs_usd_rate_snapshot_ck
  CHECK (usd_rate_snapshot IS NULL OR usd_rate_snapshot > 0);

ALTER TABLE public.emergency_installments
  ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(14,2) NULL;
ALTER TABLE public.emergency_installments
  DROP CONSTRAINT IF EXISTS emergency_installments_amount_usd_ck;
ALTER TABLE public.emergency_installments
  ADD CONSTRAINT emergency_installments_amount_usd_ck
  CHECK (amount_usd IS NULL OR amount_usd >= 0);

-- ── 2) Payment entries: USD-link columns + reference columns ───────────────
ALTER TABLE public.emergency_payment_entries
  ADD COLUMN IF NOT EXISTS collected_syp NUMERIC(14,2) NULL,
  ADD COLUMN IF NOT EXISTS usd_settled   NUMERIC(18,6) NULL,
  ADD COLUMN IF NOT EXISTS day_rate      NUMERIC(14,4) NULL,
  ADD COLUMN IF NOT EXISTS ref_rate      NUMERIC(14,4) NULL,
  ADD COLUMN IF NOT EXISTS ref_usd       NUMERIC(14,2) NULL;
-- exchange_rate was NUMERIC(10,2): too narrow for a 4-decimal central rate.
ALTER TABLE public.emergency_payment_entries
  ALTER COLUMN exchange_rate TYPE NUMERIC(14,4);

ALTER TABLE public.emergency_payment_entries
  DROP CONSTRAINT IF EXISTS emergency_payment_entries_fx_ck;
ALTER TABLE public.emergency_payment_entries
  ADD CONSTRAINT emergency_payment_entries_fx_ck
  CHECK (
    (collected_syp IS NULL AND usd_settled IS NULL AND day_rate IS NULL)
    OR (collected_syp >= 0 AND usd_settled >= 0 AND day_rate > 0)
  );
ALTER TABLE public.emergency_payment_entries
  DROP CONSTRAINT IF EXISTS emergency_payment_entries_ref_fx_ck;
ALTER TABLE public.emergency_payment_entries
  ADD CONSTRAINT emergency_payment_entries_ref_fx_ck
  CHECK ((ref_rate IS NULL AND ref_usd IS NULL) OR (ref_rate > 0 AND ref_usd >= 0));

-- Same rule as 494's fn_payment_entry_fx_reference (no entry_type / received_at
-- on this table: every row is a payment, dated by created_at).
CREATE OR REPLACE FUNCTION public.fn_maintenance_payment_entry_fx_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  IF NEW.ref_rate IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.day_rate IS NOT NULL THEN
    NEW.ref_rate := NEW.day_rate;
    NEW.ref_usd  := ROUND(COALESCE(NEW.collected_syp, NEW.amount_syp) / NEW.day_rate, 2);
    RETURN NEW;
  END IF;
  SELECT r.rate INTO v_rate
    FROM public.exchange_rates r
   WHERE r.effective_from <= (COALESCE(NEW.created_at, NOW()) AT TIME ZONE 'Asia/Damascus')::date
   ORDER BY r.effective_from DESC, r.id DESC
   LIMIT 1;
  IF v_rate IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.ref_rate := v_rate;
  NEW.ref_usd  := CASE
    WHEN upper(COALESCE(NEW.currency, 'SYP')) = 'USD' AND NEW.method <> 'barter'
      THEN ROUND(NEW.amount_value, 2)
    ELSE ROUND(NEW.amount_syp / v_rate, 2)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_payment_entry_fx_reference ON public.emergency_payment_entries;
CREATE TRIGGER trg_maintenance_payment_entry_fx_reference
  BEFORE INSERT ON public.emergency_payment_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_maintenance_payment_entry_fx_reference();

-- ── 3) FX differences ledger: maintenance source ───────────────────────────
ALTER TABLE public.branch_fx_differences
  ADD COLUMN IF NOT EXISTS maintenance_installment_id INTEGER NULL
    REFERENCES public.emergency_installments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS maintenance_payment_entry_id INTEGER NULL
    REFERENCES public.emergency_payment_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS open_task_id INTEGER NULL
    REFERENCES public.open_tasks(id) ON DELETE SET NULL;

ALTER TABLE public.branch_fx_differences
  DROP CONSTRAINT IF EXISTS branch_fx_differences_source_kind_ck;
ALTER TABLE public.branch_fx_differences
  ADD CONSTRAINT branch_fx_differences_source_kind_ck
  CHECK (source_kind IN ('contract_installment', 'maintenance_installment'));

CREATE INDEX IF NOT EXISTS idx_branch_fx_differences_maintenance_installment
  ON public.branch_fx_differences (maintenance_installment_id)
  WHERE maintenance_installment_id IS NOT NULL;

COMMIT;
