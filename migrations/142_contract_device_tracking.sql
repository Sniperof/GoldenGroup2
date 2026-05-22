-- 142_contract_device_tracking.sql
-- Enables all canonical task types on open_tasks and implements device lifecycle tracking.

BEGIN;

-- 1. Remove the restrictive CHECK constraint on open_tasks.task_type
ALTER TABLE open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_task_type_check;

-- 2. Add foreign key from open_tasks(task_type) to task_type_config(task_type)
-- This ensures full type integrity using the config table instead of ad-hoc CHECK constraints.
ALTER TABLE open_tasks
  ADD CONSTRAINT open_tasks_task_type_fk
  FOREIGN KEY (task_type) REFERENCES task_type_config(task_type)
  ON DELETE RESTRICT;

-- 3. Add device_status column to contracts table
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS device_status VARCHAR(50) DEFAULT 'pending_delivery'
  CONSTRAINT contracts_device_status_check CHECK (device_status IN ('pending_delivery', 'delivered', 'installed', 'active'));

-- 4. Set existing active contracts to 'active' device status, and historical ones appropriately
UPDATE contracts SET device_status = 'active' WHERE status = 'active';
UPDATE contracts SET device_status = 'pending_delivery' WHERE status = 'temporary';

-- 5. Add is_installed to contract_line_items to track physical part/accessory installation
ALTER TABLE contract_line_items
  ADD COLUMN IF NOT EXISTS is_installed BOOLEAN DEFAULT FALSE;

COMMIT;
