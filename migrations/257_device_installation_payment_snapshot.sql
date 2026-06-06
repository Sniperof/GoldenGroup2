-- Store installation-sale payment snapshot with the installation result.
-- Full ledger integration can be promoted later; this keeps the visit result
-- self-contained and printable like maintenance receipts.

ALTER TABLE public.visit_task_device_installation_results
  ADD COLUMN IF NOT EXISTS installation_payment jsonb DEFAULT '{}'::jsonb NOT NULL;
