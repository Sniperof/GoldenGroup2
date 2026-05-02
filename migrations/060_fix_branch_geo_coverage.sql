-- ============================================================
-- Migration 060: Fix branch geo coverage for existing data
-- Links Damascus branch to Damascus governorate and backfills
-- covered_geo_ids for branches missing coverage.
-- ============================================================

-- 1. Link any branch named 'دمشق' to the Damascus governorate geo unit
UPDATE branches
   SET location_geo_id = (
         SELECT id FROM geo_units
          WHERE name = 'دمشق' AND level = 1
          LIMIT 1
       )
 WHERE name = 'دمشق'
   AND location_geo_id IS NULL;

-- 2. Backfill covered_geo_ids for branches that have location but no coverage
UPDATE branches
   SET covered_geo_ids = jsonb_build_array(location_geo_id)
 WHERE location_geo_id IS NOT NULL
   AND (
     covered_geo_ids IS NULL
     OR jsonb_typeof(covered_geo_ids) <> 'array'
     OR jsonb_array_length(covered_geo_ids) = 0
   );
