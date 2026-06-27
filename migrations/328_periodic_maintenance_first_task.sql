-- ============================================================
-- 328_periodic_maintenance_first_task.sql
-- ============================================================
-- Phase 3 — DB guard for first/active periodic maintenance tasks.
--
-- Periodic maintenance allows multiple devices for one client, but only one
-- active periodic task per installed device.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_open_tasks_unique_active_per_client;

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_tasks_unique_active_per_client
  ON public.open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type NOT IN (
      'emergency_maintenance',
      'device_delivery',
      'installment_collection',
      'periodic_maintenance'
    );

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_active_periodic_per_device
  ON public.open_tasks (device_id)
  WHERE task_type = 'periodic_maintenance'
    AND device_id IS NOT NULL
    AND status NOT IN ('completed', 'closed', 'cancelled');

COMMENT ON INDEX public.open_tasks_unique_active_periodic_per_device IS
  'P-MAINT-01: at most one active periodic_maintenance open_task per installed_device.';

CREATE TABLE IF NOT EXISTS public.open_task_periodic_payload (
  open_task_id           INTEGER PRIMARY KEY REFERENCES public.open_tasks(id) ON DELETE CASCADE,
  generation_origin      VARCHAR(30) NOT NULL DEFAULT 'system',
  interval_days_snapshot INTEGER,
  manual_reason          VARCHAR(255),
  created_by             INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT open_task_periodic_payload_generation_origin_check
    CHECK (generation_origin IN ('system', 'manual'))
);

COMMIT;
