-- 1. Add description_en column
ALTER TABLE device_models
  ADD COLUMN IF NOT EXISTS description_en TEXT;

-- 2. Handle existing NULL name_en values before making it NOT NULL
UPDATE device_models
  SET name_en = COALESCE(NULLIF(TRIM(name_en), ''), name_ar, 'Unknown')
WHERE name_en IS NULL OR TRIM(name_en) = '';

-- 3. Make name_en NOT NULL
ALTER TABLE device_models
  ALTER COLUMN name_en SET NOT NULL;
