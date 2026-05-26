-- Phase 4: device_warranties — sub-entity for device warranty records.
-- Stores one row per warranty type per device (contract | golden).
-- The flat warranty fields on installed_devices remain as a denormalized
-- summary cache for fast reads; device_warranties is the authoritative store.

CREATE TABLE IF NOT EXISTS device_warranties (
  id              SERIAL PRIMARY KEY,
  device_id       INTEGER NOT NULL
                    REFERENCES installed_devices(id) ON DELETE CASCADE,
  warranty_type   VARCHAR(20) NOT NULL
                    CHECK (warranty_type IN ('contract', 'golden')),
  start_date      DATE,
  end_date        DATE,
  months          INTEGER,        -- duration months (contract warranty)
  visits          INTEGER,        -- maintenance visits included
  source_task_id  INTEGER         -- golden: the delivery open_task that activated it
                    REFERENCES open_tasks(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One active warranty record per type per device
  UNIQUE (device_id, warranty_type)
);

CREATE INDEX IF NOT EXISTS idx_device_warranties_device
  ON device_warranties(device_id);

CREATE INDEX IF NOT EXISTS idx_device_warranties_end
  ON device_warranties(end_date)
  WHERE is_active = TRUE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_device_warranties_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_device_warranties_updated_at ON device_warranties;
CREATE TRIGGER trg_device_warranties_updated_at
  BEFORE UPDATE ON device_warranties
  FOR EACH ROW EXECUTE FUNCTION set_device_warranties_updated_at();

-- Backfill: contract warranties where data exists
INSERT INTO device_warranties (device_id, warranty_type, end_date, months, visits)
SELECT
  d.id,
  'contract',
  d.contract_warranty_end_date,
  d.warranty_months,
  d.warranty_visits
FROM installed_devices d
WHERE d.contract_warranty_end_date IS NOT NULL
   OR d.warranty_months IS NOT NULL
ON CONFLICT (device_id, warranty_type) DO NOTHING;

-- Backfill: golden warranties
INSERT INTO device_warranties (device_id, warranty_type, end_date)
SELECT d.id, 'golden', d.golden_warranty_end_date
FROM installed_devices d
WHERE d.is_golden_warranty = TRUE
ON CONFLICT (device_id, warranty_type) DO NOTHING;
