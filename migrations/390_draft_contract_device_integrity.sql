BEGIN;

-- Do not silently bless an already-invalid staging/production state. This
-- migration intentionally stops and reports the conflicting contract ids so
-- they can be reconciled as an operational decision before the guard is armed.
DO $$
DECLARE
  v_invalid_contract_ids text;
BEGIN
  SELECT string_agg(DISTINCT c.id::text, ', ' ORDER BY c.id::text)
    INTO v_invalid_contract_ids
    FROM public.contracts c
    JOIN public.installed_devices d ON d.contract_id = c.id
   WHERE c.status = 'draft'
      OR d.device_source = 'external';

  IF v_invalid_contract_ids IS NOT NULL THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'invalid contract/device links exist; reconcile contract ids before migration: %s',
          v_invalid_contract_ids
        );
  END IF;
END;
$$;

-- A company device is an operational side effect of contract approval. Keep
-- this invariant in PostgreSQL as well as in the API so a stale application
-- deployment, direct SQL call, or future writer cannot materialize a device
-- for a draft contract.
CREATE OR REPLACE FUNCTION public.assert_installed_device_contract_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_contract_status text;
BEGIN
  IF NEW.device_source = 'company_contract' AND NEW.contract_id IS NULL THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = 'company_contract device requires contract_id';
  END IF;

  IF NEW.device_source = 'external' AND NEW.contract_id IS NOT NULL THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = 'external device cannot reference a sale contract';
  END IF;

  IF NEW.contract_id IS NOT NULL THEN
    SELECT status
      INTO v_contract_status
      FROM public.contracts
     WHERE id = NEW.contract_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        USING
          ERRCODE = '23503',
          MESSAGE = format('contract %s does not exist', NEW.contract_id);
    END IF;

    IF v_contract_status <> 'active' THEN
      RAISE EXCEPTION
        USING
          ERRCODE = '23514',
          MESSAGE = format(
            'company device cannot be materialized for contract %s with status %s',
            NEW.contract_id,
            v_contract_status
          );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_installed_device_contract_integrity
  ON public.installed_devices;

CREATE TRIGGER trg_assert_installed_device_contract_integrity
BEFORE INSERT OR UPDATE OF contract_id, device_source
ON public.installed_devices
FOR EACH ROW
EXECUTE FUNCTION public.assert_installed_device_contract_integrity();

-- Preserve the invariant from the other direction as well: an already
-- materialized company device prevents moving its contract back to draft.
CREATE OR REPLACE FUNCTION public.prevent_contract_draft_with_company_device()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'draft'
     AND OLD.status IS DISTINCT FROM 'draft'
     AND EXISTS (
       SELECT 1
         FROM public.installed_devices d
        WHERE d.contract_id = NEW.id
     )
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'contract %s cannot return to draft after device materialization',
          NEW.id
        );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_contract_draft_with_company_device
  ON public.contracts;

CREATE TRIGGER trg_prevent_contract_draft_with_company_device
BEFORE UPDATE OF status
ON public.contracts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_contract_draft_with_company_device();

COMMIT;
