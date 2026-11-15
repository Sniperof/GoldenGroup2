-- 494: Reference exchange rate on every contract payment (2026-11-12)
--
-- Every contract payment (entry_type = 'collection') written from now on keeps,
-- as REFERENCE information only, the central rate in effect on the payment day
-- and the payment's USD equivalent. Nothing reads these columns for any
-- calculation: balances, validation, the USD-linked due (usd_settled) and the
-- FX ledger are untouched. They exist so the customer statement can show the
-- USD value and rate of each payment.
--
-- Column semantics (deliberately separate from 493's USD-link columns):
--   ref_rate  SYP per 1 USD — the central rate in effect on the payment day
--             (received_at, Damascus date). For a USD-linked collection it is
--             the day rate used for the collection (= day_rate).
--   ref_usd   USD equivalent of the money ACTUALLY received in this entry:
--             a USD entry → its face value (amount_value); a USD-linked entry →
--             collected_syp / day_rate; any other entry → amount_syp / ref_rate.
-- 493's collected_syp / usd_settled / day_rate stay exclusive to USD-linked
-- collections (their CHECK and loadInstallmentUsdStates are unaffected).
--
-- Filled by a BEFORE INSERT trigger so every write path (signing / down
-- payment, draft payment entries, trial settlement, legacy and USD-linked
-- collections) gets it without each route repeating the rule. No central rate
-- in effect → both stay NULL (never blocks). Historical rows are NOT backfilled.

BEGIN;

ALTER TABLE public.contract_payment_entries
  ADD COLUMN IF NOT EXISTS ref_rate NUMERIC(14,4) NULL,
  ADD COLUMN IF NOT EXISTS ref_usd  NUMERIC(14,2) NULL;

ALTER TABLE public.contract_payment_entries
  DROP CONSTRAINT IF EXISTS contract_payment_entries_ref_fx_ck;
ALTER TABLE public.contract_payment_entries
  ADD CONSTRAINT contract_payment_entries_ref_fx_ck
  CHECK ((ref_rate IS NULL AND ref_usd IS NULL) OR (ref_rate > 0 AND ref_usd >= 0));

CREATE OR REPLACE FUNCTION public.fn_payment_entry_fx_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  IF NEW.entry_type IS DISTINCT FROM 'collection' OR NEW.ref_rate IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.day_rate IS NOT NULL THEN
    -- USD-linked collection: the rate of the collection is the reference.
    NEW.ref_rate := NEW.day_rate;
    NEW.ref_usd  := ROUND(COALESCE(NEW.collected_syp, NEW.amount_syp) / NEW.day_rate, 2);
    RETURN NEW;
  END IF;

  SELECT r.rate INTO v_rate
    FROM public.exchange_rates r
   WHERE r.effective_from <= (COALESCE(NEW.received_at, NOW()) AT TIME ZONE 'Asia/Damascus')::date
   ORDER BY r.effective_from DESC, r.id DESC
   LIMIT 1;

  IF v_rate IS NULL THEN
    RETURN NEW;   -- no central rate: leave the reference empty, never block
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

DROP TRIGGER IF EXISTS trg_payment_entry_fx_reference ON public.contract_payment_entries;
CREATE TRIGGER trg_payment_entry_fx_reference
  BEFORE INSERT ON public.contract_payment_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_entry_fx_reference();

COMMIT;
