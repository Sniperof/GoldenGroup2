ALTER TABLE device_models
  DROP COLUMN IF EXISTS discount_percent,
  DROP COLUMN IF EXISTS discounted_price;
