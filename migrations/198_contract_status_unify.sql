-- Migration 198: Unify ContractStatus per DEC-CT-01
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-01)
--
-- Changes:
--  1. Move `temporary` status values into sale_subtype='temporary' + status='draft'.
--  2. Replace contracts.status CHECK with the unified dictionary:
--       draft / active / cancelled / completed / discarded
--
-- Notes:
--  - Existing rows with status='active' or 'cancelled' are kept as-is.
--  - draft/completed/discarded transitions are app-layer responsibilities
--    handled by routes/triggers in subsequent steps.
-- ----------------------------------------------------------------------

BEGIN;

-- 1. Move legacy `temporary` status into sale_subtype + draft.
--    A contract that was 'temporary' becomes a draft of subtype 'temporary'.
UPDATE contracts
   SET sale_subtype = 'temporary',
       status       = 'draft'
 WHERE status = 'temporary';

-- 2. Swap the CHECK constraint atomically.
ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_status_check;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'active', 'cancelled', 'completed', 'discarded'));

COMMIT;
