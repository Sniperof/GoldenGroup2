-- Keep older staging databases compatible with dues/contract collection ownership.
ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS collection_owner_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_installments_collection_owner_id_fkey'
      AND conrelid = 'public.contract_installments'::regclass
  ) THEN
    ALTER TABLE public.contract_installments
      ADD CONSTRAINT contract_installments_collection_owner_id_fkey
      FOREIGN KEY (collection_owner_id)
      REFERENCES public.hr_users(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_contract_installments_collection_owner
  ON public.contract_installments(collection_owner_id)
  WHERE collection_owner_id IS NOT NULL;
