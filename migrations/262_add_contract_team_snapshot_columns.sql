-- Keep older staging databases compatible with the current contracts API.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_referrers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sale_owner_id INTEGER,
  ADD COLUMN IF NOT EXISTS offer_team_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS draft_device_payload JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_sale_owner_id_fkey'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_sale_owner_id_fkey
      FOREIGN KEY (sale_owner_id)
      REFERENCES public.hr_users(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_contracts_sale_owner
  ON public.contracts(sale_owner_id)
  WHERE sale_owner_id IS NOT NULL;
