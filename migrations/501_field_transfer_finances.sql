-- 501: The field device_transfer task moves the finances too (2026-11-20)
--
-- A successful device_transfer to another customer moved the device, its
-- possession and its periodic tasks, but the contract installments, the golden
-- warranty remainder and their collection tasks stayed on the old holder.
-- Product owner, 2026-11-20: unify with the administrative transfer (500).
--   D1  the field result runs the same finance move (services/
--       devicePossessionTransfer.recordFieldTransferFinances) and is recorded
--       in device_possession_transfers with source = 'field_task'.
--   D2  the field work is done, so nothing blocks: collection tasks already
--       planned into a visit stay with the old holder, listed in left_task_ids.
--   D3  one record per visit result (unique), so a result edit that re-runs
--       the applier does not move the debt twice.

BEGIN;

ALTER TABLE public.device_possession_transfers
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'field_task')),
  ADD COLUMN IF NOT EXISTS visit_task_result_id integer REFERENCES public.visit_task_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS left_task_ids integer[] NOT NULL DEFAULT '{}';

ALTER TABLE public.device_possession_transfers
  ALTER COLUMN reason_code DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_possession_transfers_visit_result
  ON public.device_possession_transfers (visit_task_result_id)
  WHERE visit_task_result_id IS NOT NULL;

COMMIT;
