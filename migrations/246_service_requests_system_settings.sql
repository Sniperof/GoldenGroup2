-- ============================================================
-- 246_service_requests_system_settings.sql
-- ============================================================
-- Phase 0.8 — Seed tunable settings for service_requests.
--
-- Per maintenance.md §٠.٤.ج + §٠.١٥.أ:
--   All six knobs are tunable from /system-settings without
--   migrations, so operations can adjust sensitivity over time.
--
-- Keys seeded:
--   - service_request_awaiting_auto_cancel_days     (default 7)
--   - service_request_duplicate_threshold           (default 0.75)
--   - service_request_duplicate_window_hours        (default 72)
--   - service_request_duplicate_phone_weight        (default 0.50)
--   - service_request_duplicate_device_weight       (default 0.25)
--   - service_request_duplicate_problem_weight      (default 0.25)
--
-- Idempotent via ON CONFLICT (key) DO NOTHING.
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.٤.ج, §٠.١٥.أ
-- ============================================================

BEGIN;

-- Make the upsert deterministic — system_settings.key should be unique.
-- If a prior migration already created this constraint, this is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS system_settings_key_unique
  ON public.system_settings (key);

INSERT INTO public.system_settings (key, value, value_type, category, description, is_editable)
VALUES
  ('service_request_awaiting_auto_cancel_days', '7', 'integer', 'service_requests',
   'Days after which a request in awaiting_customer_info auto-cancels (٠.٤.ج).', true),

  ('service_request_duplicate_threshold', '0.75', 'string', 'service_requests',
   'Score threshold (0..1) to set duplicate_flag automatically (٠.١٥.أ).', true),

  ('service_request_duplicate_window_hours', '72', 'integer', 'service_requests',
   'Lookback window for duplicate matching against older requests (٠.١٥.أ).', true),

  ('service_request_duplicate_phone_weight', '0.50', 'string', 'service_requests',
   'Weight of the phone-match component in the duplicate score (٠.١٥.أ).', true),

  ('service_request_duplicate_device_weight', '0.25', 'string', 'service_requests',
   'Weight of the device-match component in the duplicate score (٠.١٥.أ).', true),

  ('service_request_duplicate_problem_weight', '0.25', 'string', 'service_requests',
   'Weight of the problem-text similarity component (pg_trgm) in the duplicate score (٠.١٥.أ).', true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
