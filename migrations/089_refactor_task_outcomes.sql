ALTER TABLE marketing_visit_tasks
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)
    CHECK (outcome IN ('offer_presented', 'device_sold', 'rescheduled', 'cancelled')),
  ADD COLUMN IF NOT EXISTS offer_type VARCHAR(20)
    CHECK (offer_type IN ('cash', 'installment')),
  ADD COLUMN IF NOT EXISTS sale_reference_number VARCHAR(5) UNIQUE,
  ADD COLUMN IF NOT EXISTS cancellation_reason_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reschedule_reason_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_due_date DATE,
  ADD COLUMN IF NOT EXISTS has_discount BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_device_sold BOOLEAN DEFAULT FALSE;

ALTER TABLE visit_task_device_demo_results
  ADD COLUMN IF NOT EXISTS sale_reference_number VARCHAR(5),
  ADD COLUMN IF NOT EXISTS is_device_sold BOOLEAN DEFAULT FALSE;
