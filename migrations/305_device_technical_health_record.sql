-- ============================================================
-- 305_device_technical_health_record.sql
-- ============================================================
-- Phase 1 of the Device Technical Health Record model.
-- Constitution: docs/constitution/contracts/01i-device-technical-health-record.md
--
-- Reframes device_technical_states from a CONTRACT-keyed maintenance artifact
-- into a PHYSICAL-DEVICE-keyed lifetime health record.
--
-- Decisions implemented (see constitution §4):
--   3. installed_device_id + open_task_id are required going forward; contract_id
--      stays an optional contextual reference; task_type captured as a snapshot.
--   2. phase expanded: pre / post / diagnostic / baseline (replaces 'standalone').
--   1. device_models.has_sterilization flag drives the optional sterilization block.
--
-- Legacy rows that predate the device link are GRANDFATHERED via NOT VALID checks
-- (enforced on new/updated rows only) — no destructive deletes.
--
-- Idempotent / safe to re-run.
-- ============================================================

-- 1. New columns on the health record ------------------------------------------
ALTER TABLE public.device_technical_states
  ADD COLUMN IF NOT EXISTS installed_device_id INTEGER
    REFERENCES public.installed_devices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS task_type_snapshot VARCHAR(40);

-- 2. Backfill the device link from the contract (1:1 via installed_devices) -----
UPDATE public.device_technical_states dts
   SET installed_device_id = idv.id
  FROM public.installed_devices idv
 WHERE idv.contract_id = dts.contract_id
   AND dts.contract_id IS NOT NULL
   AND dts.installed_device_id IS NULL;

-- 3. Expand the phase vocabulary -----------------------------------------------
--    'standalone' -> 'baseline'; add 'diagnostic'. Drop old check, migrate, re-add.
ALTER TABLE public.device_technical_states
  DROP CONSTRAINT IF EXISTS device_technical_states_phase_check;

UPDATE public.device_technical_states
   SET phase = 'baseline'
 WHERE phase = 'standalone';

ALTER TABLE public.device_technical_states
  ADD CONSTRAINT device_technical_states_phase_check
  CHECK (phase IN ('pre', 'post', 'diagnostic', 'baseline'));

-- 4. Enforce "no health reading without a device + task" GOING FORWARD ----------
--    NOT VALID: new/updated rows must comply; the 2 legacy orphan rows (no
--    contract, no task) are grandfathered until reconciled separately.
ALTER TABLE public.device_technical_states
  DROP CONSTRAINT IF EXISTS device_technical_states_device_required_ck;
ALTER TABLE public.device_technical_states
  ADD CONSTRAINT device_technical_states_device_required_ck
  CHECK (installed_device_id IS NOT NULL) NOT VALID;

ALTER TABLE public.device_technical_states
  DROP CONSTRAINT IF EXISTS device_technical_states_task_required_ck;
ALTER TABLE public.device_technical_states
  ADD CONSTRAINT device_technical_states_task_required_ck
  CHECK (open_task_id IS NOT NULL) NOT VALID;

-- 5. Read paths key on the device ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_device_technical_states_device
  ON public.device_technical_states(installed_device_id, created_at DESC);

-- 6. Sterilization capability flag on the catalog model ------------------------
--    Default true preserves current behavior (sterilization block shown); models
--    without sterilization are marked false to hide the block.
ALTER TABLE public.device_models
  ADD COLUMN IF NOT EXISTS has_sterilization BOOLEAN NOT NULL DEFAULT true;
