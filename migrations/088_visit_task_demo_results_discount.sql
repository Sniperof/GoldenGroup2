ALTER TABLE visit_task_device_demo_results
  ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC
  CHECK (discount_percentage >= 0 AND discount_percentage <= 100);
