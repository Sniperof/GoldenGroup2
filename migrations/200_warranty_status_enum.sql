-- Migration 200: Warranty status enum + cancellation metadata per DEC-CT-05
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-05)
--
-- Replaces device_warranties.is_active with a richer state machine:
--   pending   — warranty rights exist but device not yet active
--   active    — device.activated_at set; coverage running
--   cancelled — explicitly terminated (contract_cancelled / device_retrieved / manual)
--   expired   — end_date passed
--
-- Adds:
--   status (VARCHAR + CHECK)
--   cancellation_reason (VARCHAR + CHECK NULLable)
--   cancelled_at  TIMESTAMPTZ
--   cancelled_by  INTEGER FK -> employees
--   activated_at  TIMESTAMPTZ (DEC-CT-04 snapshot; written when activation task closes)
--
-- Keeps the legacy is_active column for one release as a denormalized read
-- cache (status='active' ⇔ is_active=true). It is dropped in a later migration.
-- ----------------------------------------------------------------------

BEGIN;

-- 1. New columns
ALTER TABLE device_warranties
  ADD COLUMN IF NOT EXISTS status              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(30),
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by        INTEGER
                            REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at        TIMESTAMPTZ;

-- 2. Backfill status from is_active + dates.
--    Rule:
--      is_active=false                 -> 'cancelled' (reason='manual' if unknown)
--      is_active=true  + end<NOW       -> 'expired'
--      is_active=true  + start<=NOW    -> 'active'
--      is_active=true  + start>NOW/NULL-> 'pending'
UPDATE device_warranties
   SET status = CASE
       WHEN is_active = FALSE                                                 THEN 'cancelled'
       WHEN end_date  IS NOT NULL AND end_date  <  CURRENT_DATE               THEN 'expired'
       WHEN start_date IS NOT NULL AND start_date <= CURRENT_DATE             THEN 'active'
       ELSE 'pending'
     END
 WHERE status IS NULL;

-- 3. Backfill cancellation_reason for legacy cancelled rows.
UPDATE device_warranties
   SET cancellation_reason = 'manual'
 WHERE status = 'cancelled'
   AND cancellation_reason IS NULL;

-- 4. Backfill activated_at for rows that were already active and have a start_date.
--    This is a best-effort snapshot — production triggers (DEC-CT-04) will
--    write activated_at going forward at the moment of device activation.
UPDATE device_warranties
   SET activated_at = (start_date::timestamp AT TIME ZONE 'UTC')
 WHERE status = 'active'
   AND activated_at IS NULL
   AND start_date  IS NOT NULL;

-- 5. Constraints
ALTER TABLE device_warranties
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_status_check;

ALTER TABLE device_warranties
  ADD CONSTRAINT device_warranties_status_check
  CHECK (status IN ('pending', 'active', 'cancelled', 'expired'));

ALTER TABLE device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_cancellation_reason_check;

ALTER TABLE device_warranties
  ADD CONSTRAINT device_warranties_cancellation_reason_check
  CHECK (
    cancellation_reason IS NULL
    OR cancellation_reason IN ('contract_cancelled', 'device_retrieved', 'manual')
  );

-- Cross-field invariant: cancelled rows must carry a reason; non-cancelled must not.
ALTER TABLE device_warranties
  DROP CONSTRAINT IF EXISTS device_warranties_cancellation_consistency;

ALTER TABLE device_warranties
  ADD CONSTRAINT device_warranties_cancellation_consistency
  CHECK (
    (status =  'cancelled' AND cancellation_reason IS NOT NULL AND cancelled_at IS NOT NULL)
    OR
    (status <> 'cancelled' AND cancellation_reason IS NULL     AND cancelled_at IS NULL)
  );

-- 6. Keep is_active in sync via trigger for backward compatibility.
--    (Dropped together with is_active in a later cleanup migration.)
CREATE OR REPLACE FUNCTION sync_device_warranty_is_active()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_warranties_sync_is_active ON device_warranties;
CREATE TRIGGER trg_device_warranties_sync_is_active
  BEFORE INSERT OR UPDATE OF status ON device_warranties
  FOR EACH ROW EXECUTE FUNCTION sync_device_warranty_is_active();

-- One-shot sync after backfill.
UPDATE device_warranties
   SET is_active = (status = 'active')
 WHERE is_active IS DISTINCT FROM (status = 'active');

-- 7. Indices
CREATE INDEX IF NOT EXISTS idx_device_warranties_status
  ON device_warranties(status);

CREATE INDEX IF NOT EXISTS idx_device_warranties_activated_at
  ON device_warranties(activated_at)
  WHERE activated_at IS NOT NULL;

COMMIT;
