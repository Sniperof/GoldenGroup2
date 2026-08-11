BEGIN;

-- PostgreSQL fires triggers for the same event in alphabetical name order.
-- A fully paid cash draft exposed an unsafe order here:
--
--   draft -> active
--   1. replay_recompute_on_activation() changed the contract to completed
--   2. materialize_device_on_activation() then tried to create the device
--   3. the device integrity guard rejected the insert because the parent was
--      already completed instead of active
--
-- Make the approval sequence explicit and stable:
--   draft -> active -> materialize device -> evaluate financial completion.
DROP TRIGGER IF EXISTS trg_contracts_replay_recompute_on_activation
  ON public.contracts;
DROP TRIGGER IF EXISTS trg_materialize_device_on_activation
  ON public.contracts;
DROP TRIGGER IF EXISTS trg_10_materialize_device_on_activation
  ON public.contracts;
DROP TRIGGER IF EXISTS trg_20_replay_recompute_on_activation
  ON public.contracts;

CREATE TRIGGER trg_10_materialize_device_on_activation
AFTER UPDATE OF status
ON public.contracts
FOR EACH ROW
WHEN (
  NEW.contract_type = 'sale_contract'
  AND NEW.status = 'active'
  AND OLD.status IS DISTINCT FROM 'active'
)
EXECUTE FUNCTION public.materialize_device_on_activation();

CREATE TRIGGER trg_20_replay_recompute_on_activation
AFTER UPDATE OF status
ON public.contracts
FOR EACH ROW
WHEN (
  NEW.status = 'active'
  AND OLD.status IS DISTINCT FROM 'active'
)
EXECUTE FUNCTION public.replay_recompute_on_activation();

COMMIT;
