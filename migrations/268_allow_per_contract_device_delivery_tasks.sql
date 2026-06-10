-- 2026-06-10
-- Background:
--   The unique constraint idx_open_tasks_unique_active enforced
--     UNIQUE (client_id, task_type) WHERE status IN ('open','needs_follow_up')
--                                     AND task_type <> 'emergency_maintenance'
--   This blocked approving a second sale contract for a customer whose
--   previous device_delivery task was still open — exactly the case a
--   customer buying multiple devices hits.
--
-- Decision (Ibrahim, 2026-06-10):
--   device_delivery becomes per-contract uniqueness. All other task types
--   keep the existing per-client rule (e.g. you still cannot have two open
--   lead_follow_up tasks for the same client).
--
-- This is reversible: drop the two new partial indexes and recreate the
-- original one to roll back.

BEGIN;

-- 1. Drop the broad per-client unique index.
DROP INDEX IF EXISTS idx_open_tasks_unique_active;

-- 2. Per-client uniqueness for every task type EXCEPT device_delivery
--    and emergency_maintenance (kept as a non-unique exception, as before).
CREATE UNIQUE INDEX idx_open_tasks_unique_active_per_client
  ON open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type NOT IN ('emergency_maintenance', 'device_delivery');

-- 3. Per-contract uniqueness for device_delivery only — so each contract
--    gets exactly one open delivery task, and a customer with multiple
--    contracts can have multiple open deliveries (one per contract).
CREATE UNIQUE INDEX idx_open_tasks_unique_active_device_delivery
  ON open_tasks (contract_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type = 'device_delivery'
    AND contract_id IS NOT NULL;

COMMIT;
