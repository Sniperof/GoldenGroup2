BEGIN;

-- Contract completion is a financial lifecycle transition:
--   * installment contracts complete when every installment is paid;
--   * cash contracts complete when net collections cover the final price.
-- Draft/cancelled/discarded/completed contracts are never overwritten here.
CREATE OR REPLACE FUNCTION public.recompute_contract_completion(p_contract_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status        VARCHAR(50);
  v_payment_type  VARCHAR(50);
  v_final_price   NUMERIC;
  v_total         INTEGER;
  v_paid          INTEGER;
  v_net_payments  NUMERIC;
BEGIN
  IF p_contract_id IS NULL THEN
    RETURN;
  END IF;

  SELECT status, payment_type, final_price
    INTO v_status, v_payment_type, v_final_price
    FROM public.contracts
   WHERE id = p_contract_id
   FOR UPDATE;

  -- Only auto-advance from active. Terminal and pre-approval states are stable.
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN;
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'paid')
    INTO v_total, v_paid
    FROM public.contract_installments
   WHERE contract_id = p_contract_id;

  IF v_total > 0 THEN
    IF v_total = v_paid THEN
      UPDATE public.contracts
         SET status = 'completed'
       WHERE id = p_contract_id
         AND status = 'active';
    END IF;
    RETURN;
  END IF;

  IF v_payment_type = 'cash' AND v_final_price IS NOT NULL THEN
    SELECT COALESCE(SUM(
             CASE
               WHEN entry_type = 'refund' THEN -amount_syp
               ELSE amount_syp
             END
           ), 0)
      INTO v_net_payments
      FROM public.contract_payment_entries
     WHERE contract_id = p_contract_id;

    IF v_net_payments >= v_final_price THEN
      UPDATE public.contracts
         SET status = 'completed'
       WHERE id = p_contract_id
         AND status = 'active';
    END IF;
  END IF;
END;
$$;

-- Payment rows are the source of truth for both installment balances and cash
-- settlement. Re-evaluate contract completion after every payment mutation.
CREATE OR REPLACE FUNCTION public.trg_payment_entry_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.installment_id IS NOT NULL THEN
    PERFORM public.recompute_installment_balance(NEW.installment_id);
  END IF;

  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE')
     AND OLD.installment_id IS NOT NULL
     AND (
       TG_OP = 'DELETE'
       OR OLD.installment_id IS DISTINCT FROM NEW.installment_id
     ) THEN
    PERFORM public.recompute_installment_balance(OLD.installment_id);
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM public.recompute_contract_completion(NEW.contract_id);
  END IF;

  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE')
     AND (
       TG_OP = 'DELETE'
       OR OLD.contract_id IS DISTINCT FROM NEW.contract_id
     ) THEN
    PERFORM public.recompute_contract_completion(OLD.contract_id);
  END IF;

  RETURN NULL;
END;
$$;

-- Draft payment entries have no financial effect. When approval activates the
-- contract, replay installment balances and then evaluate cash completion too.
CREATE OR REPLACE FUNCTION public.replay_recompute_on_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_inst RECORD;
BEGIN
  FOR v_inst IN
    SELECT id
      FROM public.contract_installments
     WHERE contract_id = NEW.id
  LOOP
    PERFORM public.recompute_installment_balance(v_inst.id);
  END LOOP;

  PERFORM public.recompute_contract_completion(NEW.id);
  RETURN NULL;
END;
$$;

-- Reconcile historical active contracts that already satisfy their financial
-- obligation. The function is deliberately idempotent and fail-closed.
SELECT public.recompute_contract_completion(c.id)
  FROM public.contracts c
 WHERE c.status = 'active';

COMMIT;
