BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS old_contract_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS old_device_condition VARCHAR(20);

COMMENT ON COLUMN public.contracts.old_contract_number IS
  'Statistical snapshot entered for a trade-in sale. This is not a foreign key and has no lifecycle effect on the old contract.';

COMMENT ON COLUMN public.contracts.old_device_condition IS
  'Statistical condition of the old device in a trade-in sale: good or damaged. It does not change any installed-device record.';

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_tradein_statistics_check;

-- Historical trade-in rows predate these fields, so keep the constraint NOT
-- VALID: PostgreSQL enforces it for all new/updated rows without inventing
-- values for old data. A later reconciliation may validate it after backfill.
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_tradein_statistics_check
  CHECK (
    (
      sale_type = 'tradein'
      AND NULLIF(BTRIM(old_contract_number), '') IS NOT NULL
      AND old_device_condition IN ('good', 'damaged')
    )
    OR
    (
      sale_type <> 'tradein'
      AND old_contract_number IS NULL
      AND old_device_condition IS NULL
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_contracts_tradein_device_condition
  ON public.contracts (branch_id, old_device_condition)
  WHERE sale_type = 'tradein';

COMMIT;
