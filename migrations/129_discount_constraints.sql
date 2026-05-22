CREATE UNIQUE INDEX IF NOT EXISTS idx_device_discounts_unique_label
ON device_discounts(device_model_id, label);
