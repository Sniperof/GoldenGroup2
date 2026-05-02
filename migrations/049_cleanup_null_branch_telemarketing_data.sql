-- ============================================================
-- Migration 049: Cleanup null-branch telemarketing data
--
-- Old telemarketing records created before branch_id was enforced
-- have NULL branch_id values. These are not useful for the current
-- business workflow and would require weakening TM-4A authorization
-- to display. Deleting them is the safe approach.
--
-- This migration:
--   1. Deletes call logs linked to null-branch task lists
--   2. Deletes call logs with NULL branch_id
--   3. Deletes appointments linked to null-branch task lists
--   4. Deletes appointments with NULL branch_id
--   5. Deletes task list items belonging to null-branch task lists
--   6. Deletes null-branch task lists themselves
--
-- It does NOT delete:
--   - contact_targets (historical data, used across features)
--   - clients (core business data)
--   - Valid telemarketing records with branch_id IS NOT NULL
-- ============================================================

-- Step 1: Delete call logs linked to null-branch task lists
-- (even if call_logs.branch_id itself is not NULL)
DELETE FROM telemarketing_call_logs
WHERE task_list_id IN (
    SELECT id FROM telemarketing_task_lists WHERE branch_id IS NULL
);

-- Step 2: Delete call logs with NULL branch_id (standalone, not linked to a task list)
DELETE FROM telemarketing_call_logs
WHERE branch_id IS NULL;

-- Step 3: Delete appointments with NULL branch_id
-- (appointments table does not have task_list_id column, so filter by branch_id only)
DELETE FROM telemarketing_appointments
WHERE branch_id IS NULL;

-- Step 4: Delete appointments with NULL branch_id
DELETE FROM telemarketing_appointments
WHERE branch_id IS NULL;

-- Step 5: Delete task list items belonging to null-branch task lists
DELETE FROM telemarketing_task_list_items
WHERE task_list_id IN (
    SELECT id FROM telemarketing_task_lists WHERE branch_id IS NULL
);

-- Step 6: Delete null-branch task lists
DELETE FROM telemarketing_task_lists
WHERE branch_id IS NULL;

-- Step 7: Null out stale references in contact_targets
-- latest_task_list_item_id and latest_appointment_id are VARCHAR(100)
-- references that may point to deleted items/appointments.
-- Set them to NULL for safety.
UPDATE contact_targets
SET latest_task_list_item_id = NULL,
    updated_at = NOW()
WHERE latest_task_list_item_id IS NOT NULL
  AND latest_task_list_item_id NOT IN (
    SELECT id FROM telemarketing_task_list_items WHERE id IS NOT NULL
  );

UPDATE contact_targets
SET latest_appointment_id = NULL,
    updated_at = NOW()
WHERE latest_appointment_id IS NOT NULL
  AND latest_appointment_id NOT IN (
    SELECT id FROM telemarketing_appointments WHERE id IS NOT NULL
  );