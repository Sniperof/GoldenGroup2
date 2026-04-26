-- Backfill branch geo coverage for older branches.
-- If a branch has no explicit coverage yet, its main location becomes its
-- effective coverage root so branch-scoped geo and routes are not wide open.

UPDATE branches
   SET covered_geo_ids = jsonb_build_array(location_geo_id)
 WHERE location_geo_id IS NOT NULL
   AND (
     covered_geo_ids IS NULL
     OR jsonb_typeof(covered_geo_ids) <> 'array'
     OR jsonb_array_length(covered_geo_ids) = 0
   );

UPDATE branches
   SET covered_geo_ids = '[]'::jsonb
 WHERE covered_geo_ids IS NULL
    OR jsonb_typeof(covered_geo_ids) <> 'array';
