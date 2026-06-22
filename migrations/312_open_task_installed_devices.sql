-- ============================================================
-- 312_open_task_installed_devices.sql
-- ============================================================
-- A golden-warranty offer task can target MULTIPLE physical installed devices
-- (one task for all of a customer's golden-eligible devices). open_tasks.device_id
-- holds a single device and open_task_devices is product-model level, so neither
-- fits — this join table links an open_task to many installed_devices.
-- Constitution: 02b §13.6 + DEC-CT-17 (CT-IMPL-017).
--
-- Idempotent / safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.open_task_installed_devices (
  id                  SERIAL PRIMARY KEY,
  task_id             INTEGER NOT NULL REFERENCES public.open_tasks(id) ON DELETE CASCADE,
  installed_device_id INTEGER NOT NULL REFERENCES public.installed_devices(id) ON DELETE RESTRICT,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT open_task_installed_devices_unique UNIQUE (task_id, installed_device_id)
);

CREATE INDEX IF NOT EXISTS idx_open_task_installed_devices_task
  ON public.open_task_installed_devices(task_id);
