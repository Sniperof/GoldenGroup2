-- Repair schema drift from migration 238: sale references are generated and
-- propagated across offers, task results, and contracts, so all copies need
-- the same width.

ALTER TABLE public.visit_task_device_demo_results
  ALTER COLUMN sale_reference_number TYPE varchar(32);

ALTER TABLE public.contracts
  ALTER COLUMN sale_reference_number TYPE varchar(32);
