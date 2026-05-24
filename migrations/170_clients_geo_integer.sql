-- GAP-003: Migrate clients geo columns (governorate, district, neighborhood) VARCHAR → INTEGER FK → geo_units
-- Data audit confirmed: governorate (36 non-empty, all valid IDs), district (0 non-empty, all ''), neighborhood (36 non-empty, all valid IDs)

-- Step 1: Add new INTEGER columns
ALTER TABLE clients ADD COLUMN governorate_id INTEGER;
ALTER TABLE clients ADD COLUMN district_id    INTEGER;
ALTER TABLE clients ADD COLUMN neighborhood_id INTEGER;

-- Step 2: Populate from VARCHAR — cast only valid positive-integer strings that exist in geo_units
UPDATE clients
SET governorate_id = CASE
      WHEN governorate ~ '^[0-9]+$' AND governorate::integer > 0
           AND EXISTS (SELECT 1 FROM geo_units WHERE id = governorate::integer)
      THEN governorate::integer
      ELSE NULL
    END,
    district_id = CASE
      WHEN district ~ '^[0-9]+$' AND district::integer > 0
           AND EXISTS (SELECT 1 FROM geo_units WHERE id = district::integer)
      THEN district::integer
      ELSE NULL
    END,
    neighborhood_id = CASE
      WHEN neighborhood ~ '^[0-9]+$' AND neighborhood::integer > 0
           AND EXISTS (SELECT 1 FROM geo_units WHERE id = neighborhood::integer)
      THEN neighborhood::integer
      ELSE NULL
    END;

-- Step 3: Drop old VARCHAR columns
ALTER TABLE clients DROP COLUMN governorate;
ALTER TABLE clients DROP COLUMN district;
ALTER TABLE clients DROP COLUMN neighborhood;

-- Step 4: Rename new columns to canonical names
ALTER TABLE clients RENAME COLUMN governorate_id  TO governorate;
ALTER TABLE clients RENAME COLUMN district_id     TO district;
ALTER TABLE clients RENAME COLUMN neighborhood_id TO neighborhood;

-- Step 5: Add FK constraints (SET NULL so deleting a geo_unit doesn't orphan clients)
ALTER TABLE clients ADD CONSTRAINT clients_governorate_fkey
  FOREIGN KEY (governorate) REFERENCES geo_units(id) ON DELETE SET NULL;
ALTER TABLE clients ADD CONSTRAINT clients_district_fkey
  FOREIGN KEY (district) REFERENCES geo_units(id) ON DELETE SET NULL;
ALTER TABLE clients ADD CONSTRAINT clients_neighborhood_fkey
  FOREIGN KEY (neighborhood) REFERENCES geo_units(id) ON DELETE SET NULL;
