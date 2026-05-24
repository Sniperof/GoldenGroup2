-- GAP-038: Replace branches.covered_geo_ids JSONB with proper junction table
-- This gives referential integrity: deleting a geo_unit auto-removes it from branch coverage

-- Step 1: Create the junction table
CREATE TABLE branch_geo_coverage (
  branch_id   INTEGER NOT NULL REFERENCES branches(id)   ON DELETE CASCADE,
  geo_unit_id INTEGER NOT NULL REFERENCES geo_units(id)  ON DELETE CASCADE,
  PRIMARY KEY (branch_id, geo_unit_id)
);

-- Step 2: Migrate existing data from branches.covered_geo_ids
-- Only migrate IDs that still exist in geo_units (safety against stale IDs)
INSERT INTO branch_geo_coverage (branch_id, geo_unit_id)
SELECT
  b.id,
  (elem::text)::integer
FROM branches b,
     jsonb_array_elements(COALESCE(b.covered_geo_ids, '[]'::jsonb)) AS elem
WHERE jsonb_typeof(COALESCE(b.covered_geo_ids, '[]'::jsonb)) = 'array'
  AND (elem::text)::integer > 0
  AND EXISTS (SELECT 1 FROM geo_units WHERE id = (elem::text)::integer)
ON CONFLICT DO NOTHING;

-- Step 3: Drop the old JSONB column
ALTER TABLE branches DROP COLUMN covered_geo_ids;
