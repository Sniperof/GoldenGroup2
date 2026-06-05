-- ============================================================
-- 249_emergency_unique_active_per_device.sql
-- ============================================================
-- Phase 2 prerequisite — Enforce EM-UNIQ-01 at the DB layer.
--
-- Per maintenance.md §EM-UNIQ-01:
--   "One device, one active emergency_maintenance task at a time."
--   Partial UNIQUE on installed_device_id WHERE the task is non-terminal
--   AND task_type = 'emergency_maintenance'.
--
-- This index is created NOW (just before promoteService is written)
-- and NOT in Phase 0 because:
--   - Phase 0 added no data path, so the constraint was meaningless then.
--   - Legacy emergencyTickets.ts writes do NOT populate open_tasks.device_id
--     reliably (it sets contract_id only). We index on device_id, so legacy
--     rows with NULL device_id naturally fall outside the partial index —
--     they don't trigger collisions.
--
-- The promoteService in Phase 2 will populate open_tasks.device_id from
-- the service_request's installed_device_id (or the newly-created external
-- installed_device) inside the same transaction.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §EM-UNIQ-01
-- ============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_active_emergency_per_device
  ON public.open_tasks (device_id)
  WHERE task_type = 'emergency_maintenance'
    AND device_id IS NOT NULL
    AND status NOT IN ('completed', 'closed', 'cancelled');

COMMENT ON INDEX public.open_tasks_unique_active_emergency_per_device IS
  'EM-UNIQ-01: at most one active emergency_maintenance open_task per installed_device. Legacy rows with NULL device_id are excluded from the partial index.';

COMMIT;
