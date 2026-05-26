-- 180_devices_soft_delete.sql
-- GAP-052: device_models and spare_parts lack soft-delete.
-- Hard-deleting a device model orphans contract history (device_model_id → NULL).
BEGIN;

ALTER TABLE device_models
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE spare_parts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

COMMIT;
