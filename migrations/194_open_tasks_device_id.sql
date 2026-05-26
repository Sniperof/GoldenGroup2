-- Phase 3: link open_tasks directly to installed_devices.
-- Allows querying all tasks for a physical device without going through contracts.

ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS device_id INTEGER
    REFERENCES installed_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_id
  ON open_tasks(device_id);

-- Backfill: every task that has a contract_id gets the matching installed_device
UPDATE open_tasks ot
SET device_id = d.id
FROM installed_devices d
WHERE d.contract_id = ot.contract_id
  AND ot.contract_id IS NOT NULL
  AND ot.device_id IS NULL;
