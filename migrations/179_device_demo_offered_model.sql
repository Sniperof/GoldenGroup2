-- 179_device_demo_offered_model.sql
-- GAP-055: visit_task_device_demo_results is missing offered_device_model_id.
-- Without this we cannot analyze per-device demo conversion rates.
ALTER TABLE visit_task_device_demo_results
  ADD COLUMN IF NOT EXISTS offered_device_model_id INTEGER
    REFERENCES device_models(id) ON DELETE SET NULL;
