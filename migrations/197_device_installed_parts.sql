-- Phase 5: device_installed_parts — spare-parts history per device.
-- Each row is one part line used in one service task on a specific device.
-- Populated/synced by application code when emergency_result_parts are saved.
-- Backfill from existing emergency_result_parts via open_tasks.device_id.

CREATE TABLE IF NOT EXISTS device_installed_parts (
  id                  SERIAL PRIMARY KEY,
  device_id           INTEGER NOT NULL
                        REFERENCES installed_devices(id) ON DELETE CASCADE,
  open_task_id        INTEGER
                        REFERENCES open_tasks(id) ON DELETE SET NULL,
  spare_part_id       INTEGER
                        REFERENCES spare_parts(id) ON DELETE SET NULL,
  part_name_snapshot  VARCHAR(255) NOT NULL,
  part_code_snapshot  VARCHAR(100),
  maintenance_type    VARCHAR(50),
  unit_price          NUMERIC(12,2),
  quantity            INTEGER NOT NULL DEFAULT 1,
  line_total          NUMERIC(12,2),
  event_type          VARCHAR(20) NOT NULL DEFAULT 'replaced'
                        CHECK (event_type IN ('installed', 'replaced', 'removed')),
  event_date          DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_installed_parts_device
  ON device_installed_parts(device_id);

CREATE INDEX IF NOT EXISTS idx_device_installed_parts_task
  ON device_installed_parts(open_task_id);

-- Backfill from emergency_result_parts where the task has a device_id
INSERT INTO device_installed_parts (
  device_id, open_task_id, spare_part_id,
  part_name_snapshot, part_code_snapshot,
  maintenance_type, unit_price, quantity, line_total,
  event_date
)
SELECT
  ot.device_id,
  erp.open_task_id,
  erp.spare_part_id,
  erp.part_name_snapshot,
  erp.part_code_snapshot,
  erp.maintenance_type,
  erp.unit_price,
  erp.quantity,
  erp.line_total,
  ot.updated_at::date
FROM emergency_result_parts erp
JOIN open_tasks ot ON ot.id = erp.open_task_id
WHERE ot.device_id IS NOT NULL;
