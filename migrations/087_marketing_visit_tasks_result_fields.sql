ALTER TABLE marketing_visit_tasks
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'SYP',
  ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  ADD COLUMN IF NOT EXISTS sold_device_model_id INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_closing_reason TEXT;
