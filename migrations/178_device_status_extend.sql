-- 178_device_status_extend.sql
-- GAP-060: contracts.device_status is missing faulty/retrieved/disconnected/under_maintenance.
-- Drops the old CHECK and adds an extended one.
BEGIN;

ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_device_status_check;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_device_status_check
  CHECK (device_status IN (
    'pending_delivery',
    'delivered',
    'installed',
    'active',
    'under_maintenance',
    'faulty',
    'retrieved',
    'disconnected'
  ));

COMMIT;
