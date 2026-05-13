ALTER TABLE marketing_visit_tasks
  ADD COLUMN IF NOT EXISTS offered_device_model_id INTEGER REFERENCES device_models(id) ON DELETE SET NULL;
