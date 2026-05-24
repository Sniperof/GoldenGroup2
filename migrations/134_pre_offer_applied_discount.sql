ALTER TABLE open_task_pre_offers
  ADD COLUMN IF NOT EXISTS applied_device_discount_id INTEGER REFERENCES device_discounts(id) ON DELETE SET NULL;
