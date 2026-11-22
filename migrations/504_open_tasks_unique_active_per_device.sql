-- ============================================================
-- 504_open_tasks_unique_active_per_device.sql
-- ============================================================
-- Planning stage 1 (2026-11-22 audit F11). The planning grain is
-- (client + effective work location + D), and device/contract-basis tasks take
-- their work location from open_tasks.device_id. The active-task guard from
-- migration 393 was still (client_id, task_type), so a client with two devices
-- could not hold two active tasks of the same type (e.g. two disconnections
-- at two locations).
--
-- The guard now includes the device. Client-basis tasks (device_demo, ...)
-- carry device_id NULL, which COALESCE folds to 0, so they stay one-per-client
-- exactly as before. The index NAME is unchanged because
-- giftDeliveryTaskCreation.ts maps 23505 errors by constraint name. The
-- excluded record-scoped families are unchanged from 393.
--
-- This only relaxes the guard, so existing rows cannot violate it.
-- CREATE INDEX (not CONCURRENTLY) — the runner wraps each migration in a
-- transaction; open_tasks is small.
-- ============================================================

DROP INDEX IF EXISTS public.idx_open_tasks_unique_active_per_client;

CREATE UNIQUE INDEX idx_open_tasks_unique_active_per_client
  ON public.open_tasks (client_id, task_type, COALESCE(device_id, 0))
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type NOT IN (
      'emergency_maintenance',
      'device_delivery',
      'installment_collection',
      'periodic_maintenance',
      'golden_warranty_card_delivery',
      'gift_delivery'
    );

COMMENT ON INDEX public.idx_open_tasks_unique_active_per_client IS
  'Client/type/device guard: one active task per client, type and device (device_id NULL = client-basis, one per client). Record-scoped families are excluded.';

-- Planning reconciliation and the freeze checks look up "is this task already
-- in a call list?" by open_task_id (routes/planning.ts reconcile). Only
-- contact_target_id was indexed.
CREATE INDEX IF NOT EXISTS idx_telemarketing_task_list_items_open_task
  ON public.telemarketing_task_list_items (open_task_id)
  WHERE open_task_id IS NOT NULL;
