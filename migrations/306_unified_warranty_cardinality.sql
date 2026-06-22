-- ============================================================
-- 306_unified_warranty_cardinality.sql
-- ============================================================
-- Phase 1 of the unified warranty model (CT-IMPL-016).
-- Constitution: docs/constitution/contracts/02b-contract-warranties.md §13
--                + 08-resolved-decisions.md DEC-CT-16.
--
-- Reframes device_warranties cardinality:
--   - contract warranty: at most ONE per device   (partial unique index)
--   - golden warranty:   MANY per device, sequential, non-overlapping
--   - GLOBAL rule: at most one ACTIVE warranty per device at any moment
--     (exclusion constraint over the coverage date range).
--
-- The old UNIQUE (device_id, warranty_type) blocked multiple golden rows, so it
-- is dropped and replaced by the contract-only partial index. The matching
-- ON CONFLICT in syncContractWarrantySnapshot (packages/api/routes/contracts.ts)
-- is updated in the same phase.
--
-- Idempotent / safe to re-run.
-- ============================================================

-- 1. Drop the old all-types unique constraint (blocks multiple golden) --------
ALTER TABLE public.device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_device_id_warranty_type_key;

-- 2. Contract warranty: at most one per device -------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_warranties_one_contract
  ON public.device_warranties (device_id)
  WHERE warranty_type = 'contract';

-- 3. One ACTIVE warranty per device at any moment (no overlapping coverage) ---
--    daterange default bounds '[)' let a new warranty start on the same day a
--    previous one ends (sequential, back-to-back) without registering overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_no_overlap_active;
ALTER TABLE public.device_warranties
  ADD CONSTRAINT device_warranties_no_overlap_active
  EXCLUDE USING gist (
    device_id WITH =,
    daterange(start_date, end_date) WITH &&
  )
  WHERE (status = 'active');
