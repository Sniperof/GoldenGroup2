DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_models' AND column_name = 'is_offer_included'
  ) THEN
    ALTER TABLE device_models RENAME COLUMN is_offer_included TO is_featured;
  ELSE
    ALTER TABLE device_models ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
