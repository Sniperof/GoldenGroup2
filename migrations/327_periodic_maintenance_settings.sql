-- ============================================================
-- 327_periodic_maintenance_settings.sql
-- ============================================================
-- Phase 2 — Seed tunable settings for periodic maintenance.
--
-- These settings are operational switches only. They do not implement
-- periodic task generation yet; later phases consume them.
--
-- Reference: docs/constitution/features/tasks/periodic-maintenance.md
-- ============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS system_settings_key_unique
  ON public.system_settings (key);

INSERT INTO public.system_settings (key, value, value_type, category, description, is_editable)
VALUES
  ('periodic_auto_generate_enabled', 'true', 'boolean', 'periodic_maintenance',
   'Enable automatic generation of periodic maintenance tasks.', true),

  ('periodic_manual_creation_enabled', 'true', 'boolean', 'periodic_maintenance',
   'Allow users with permission to create periodic maintenance tasks manually.', true),

  ('periodic_default_interval_months', '6', 'integer', 'periodic_maintenance',
   'Fallback interval in months only when device/contract interval data is unavailable.', true),

  ('periodic_attach_warning_days', '14', 'integer', 'periodic_maintenance',
   'Warn when attaching an emergency request to a scheduled periodic task within this many days.', true),

  ('periodic_attach_allowed_statuses', '["open","assigned","in_scheduling","scheduled","waiting_execution"]', 'json', 'periodic_maintenance',
   'Periodic open_task statuses that allow attaching/covering an emergency request.', true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
