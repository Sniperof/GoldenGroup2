-- Migration 203: Warranty activation snapshot per DEC-CT-04
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-04)
--
-- Adds installed_devices.activated_at and a trigger that:
--   - stamps activated_at the first time the device transitions into 'active'
--   - snapshots the same instant onto every contract warranty for that device
--     (device_warranties.activated_at + status='active' + end_date computed
--      from activated_at + months)
--
-- end_date is recomputed *only* when activated_at gets stamped for the first
-- time. Subsequent status flips don't move the goalpost.
-- ----------------------------------------------------------------------

BEGIN;

-- 1. Column
ALTER TABLE installed_devices
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_installed_devices_activated_at
  ON installed_devices(activated_at)
  WHERE activated_at IS NOT NULL;

-- 2. Backfill: best-effort for devices already in 'active'.
--    Earliest known timestamp: installation_date < delivery_date < created_at.
UPDATE installed_devices
   SET activated_at = COALESCE(installation_date::timestamptz,
                               delivery_date::timestamptz,
                               created_at)
 WHERE status = 'active'
   AND activated_at IS NULL;

-- 3. Trigger function: stamp activated_at and snapshot warranty.
CREATE OR REPLACE FUNCTION trg_installed_device_activation_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Only act on the first transition into 'active'.
  IF NEW.status = 'active'
     AND (OLD.status IS DISTINCT FROM 'active')
     AND NEW.activated_at IS NULL THEN
    NEW.activated_at := v_now;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_installed_devices_activation_snapshot ON installed_devices;
CREATE TRIGGER trg_installed_devices_activation_snapshot
  BEFORE UPDATE OF status ON installed_devices
  FOR EACH ROW EXECUTE FUNCTION trg_installed_device_activation_snapshot();

-- 4. AFTER trigger: cascade activation_at into the contract warranty.
--    Splits the work so that the BEFORE trigger only touches its own row.
CREATE OR REPLACE FUNCTION trg_cascade_warranty_activation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_months INTEGER;
  v_end    DATE;
BEGIN
  -- Only when activated_at just became non-null.
  IF NEW.activated_at IS NOT NULL
     AND OLD.activated_at IS DISTINCT FROM NEW.activated_at THEN

    -- For each contract warranty on this device, snapshot the activation
    -- instant and recompute end_date from months (if available).
    UPDATE device_warranties dw
       SET activated_at = NEW.activated_at,
           status       = 'active',
           start_date   = COALESCE(start_date, NEW.activated_at::date),
           end_date     = CASE
             WHEN dw.months IS NOT NULL AND dw.months > 0
               THEN (NEW.activated_at::date + (dw.months || ' months')::interval)::date
             ELSE dw.end_date
           END
     WHERE dw.device_id     = NEW.id
       AND dw.warranty_type = 'contract'
       AND dw.status IN ('pending', 'active'); -- never resurrect cancelled/expired
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_installed_devices_cascade_warranty ON installed_devices;
CREATE TRIGGER trg_installed_devices_cascade_warranty
  AFTER UPDATE OF activated_at, status ON installed_devices
  FOR EACH ROW EXECUTE FUNCTION trg_cascade_warranty_activation();

-- 5. Backfill: snapshot already-active warranties whose device has activated_at.
UPDATE device_warranties dw
   SET activated_at = d.activated_at,
       start_date   = COALESCE(dw.start_date, d.activated_at::date),
       end_date     = CASE
         WHEN dw.months IS NOT NULL AND dw.months > 0
           THEN (d.activated_at::date + (dw.months || ' months')::interval)::date
         ELSE dw.end_date
       END
  FROM installed_devices d
 WHERE dw.device_id     = d.id
   AND dw.warranty_type = 'contract'
   AND dw.activated_at  IS NULL
   AND d.activated_at   IS NOT NULL
   AND dw.status IN ('pending', 'active');

-- 6. Auto-cancel warranties on device retrieval (DEC-CT-05 rule).
CREATE OR REPLACE FUNCTION trg_warranty_on_device_retrieval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'retrieved' AND OLD.status IS DISTINCT FROM 'retrieved' THEN
    UPDATE device_warranties
       SET status              = 'cancelled',
           cancellation_reason = 'device_retrieved',
           cancelled_at        = NOW()
     WHERE device_id = NEW.id
       AND status IN ('pending', 'active');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_installed_devices_warranty_retrieval ON installed_devices;
CREATE TRIGGER trg_installed_devices_warranty_retrieval
  AFTER UPDATE OF status ON installed_devices
  FOR EACH ROW EXECUTE FUNCTION trg_warranty_on_device_retrieval();

COMMIT;
