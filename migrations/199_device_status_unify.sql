-- Migration 199: Unify device status dictionary per DEC-CT-03
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-03)
--
-- Constitution dictionary:
--   registered, pending_delivery, delivered, installed, active,
--   faulty, in_workshop, ready, out_of_service, retrieved
--
-- Legacy → new mapping:
--   under_maintenance → in_workshop
--   disconnected      → out_of_service
--
-- Applies to both:
--   - contracts.device_status (extended in 178)
--   - installed_devices.status (the authoritative store after Phase 4)
-- ----------------------------------------------------------------------

BEGIN;

-- ============================================================
-- contracts.device_status
-- ============================================================

ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_device_status_check;

UPDATE contracts SET device_status = 'in_workshop'    WHERE device_status = 'under_maintenance';
UPDATE contracts SET device_status = 'out_of_service' WHERE device_status = 'disconnected';

ALTER TABLE contracts
  ADD CONSTRAINT contracts_device_status_check
  CHECK (device_status IN (
    'registered',
    'pending_delivery',
    'delivered',
    'installed',
    'active',
    'faulty',
    'in_workshop',
    'ready',
    'out_of_service',
    'retrieved'
  ));

-- ============================================================
-- installed_devices.status
-- ============================================================
-- Only touch if the column exists and currently carries a CHECK.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'installed_devices'
       AND column_name = 'status'
  ) THEN
    -- Drop any existing CHECK on status (name may vary)
    EXECUTE 'ALTER TABLE installed_devices DROP CONSTRAINT IF EXISTS installed_devices_status_check';

    UPDATE installed_devices SET status = 'in_workshop'    WHERE status = 'under_maintenance';
    UPDATE installed_devices SET status = 'out_of_service' WHERE status = 'disconnected';

    EXECUTE $check$
      ALTER TABLE installed_devices
        ADD CONSTRAINT installed_devices_status_check
        CHECK (status IN (
          'registered',
          'pending_delivery',
          'delivered',
          'installed',
          'active',
          'faulty',
          'in_workshop',
          'ready',
          'out_of_service',
          'retrieved'
        ))
    $check$;
  END IF;
END$$;

COMMIT;
