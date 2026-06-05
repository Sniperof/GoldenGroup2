-- Store the sale reference on the offer row itself so the lifecycle remains
-- traceable from pre-offer -> customer response -> task result -> contract.

ALTER TABLE public.customer_device_pre_offers
  ADD COLUMN IF NOT EXISTS sale_reference_number character varying(32);

ALTER TABLE public.open_task_pre_offers
  ADD COLUMN IF NOT EXISTS sale_reference_number character varying(32);

ALTER TABLE public.visit_task_device_demo_results
  ALTER COLUMN sale_reference_number TYPE character varying(32);

ALTER TABLE public.contracts
  ALTER COLUMN sale_reference_number TYPE character varying(32);

CREATE INDEX IF NOT EXISTS idx_cdpo_sale_reference_number
  ON public.customer_device_pre_offers (sale_reference_number)
  WHERE sale_reference_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_otpo_sale_reference_number
  ON public.open_task_pre_offers (sale_reference_number)
  WHERE sale_reference_number IS NOT NULL;
