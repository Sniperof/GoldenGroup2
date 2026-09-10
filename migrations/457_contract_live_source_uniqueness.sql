BEGIN;

-- One accepted offer / sale reference may back at most one live contract.
-- Historical cancelled/discarded contracts deliberately do not reserve the
-- source, while a NULL status is treated conservatively as a live legacy row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.contracts
     WHERE source_task_offer_id IS NOT NULL
       AND COALESCE(status, 'draft') NOT IN ('cancelled', 'discarded')
     GROUP BY source_task_offer_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce live contract offer uniqueness: duplicate source_task_offer_id values exist';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.contracts
     WHERE NULLIF(BTRIM(sale_reference_number), '') IS NOT NULL
       AND COALESCE(status, 'draft') NOT IN ('cancelled', 'discarded')
     GROUP BY BTRIM(sale_reference_number)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce live contract sale-reference uniqueness: duplicate sale_reference_number values exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_live_source_task_offer
  ON public.contracts (source_task_offer_id)
  WHERE source_task_offer_id IS NOT NULL
    AND COALESCE(status, 'draft') NOT IN ('cancelled', 'discarded');

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_live_sale_reference
  ON public.contracts (BTRIM(sale_reference_number))
  WHERE NULLIF(BTRIM(sale_reference_number), '') IS NOT NULL
    AND COALESCE(status, 'draft') NOT IN ('cancelled', 'discarded');

COMMIT;
