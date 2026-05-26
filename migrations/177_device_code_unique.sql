-- 177_device_code_unique.sql
-- GAP-061: device_models.code lacks UNIQUE constraint.
-- Partial index — only enforces uniqueness when code IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_models_code_unique
  ON device_models (code)
  WHERE code IS NOT NULL;
