CREATE TABLE IF NOT EXISTS device_discounts (
  id              SERIAL PRIMARY KEY,
  device_model_id INTEGER NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
  label           VARCHAR(255) NOT NULL,
  percentage      NUMERIC NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_discounts_model ON device_discounts(device_model_id);
CREATE INDEX IF NOT EXISTS idx_device_discounts_active ON device_discounts(is_active, start_date, end_date);
