-- Phase 2C: physical device field writes now go directly to installed_devices.
-- The sync trigger is no longer needed and is removed here.
DROP TRIGGER IF EXISTS trg_sync_installed_device ON contracts;
DROP FUNCTION IF EXISTS sync_installed_device_from_contract();
