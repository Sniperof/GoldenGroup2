BEGIN;

-- Backfill the immutable intake-time branch-resolution snapshot for historical
-- account requests. No request is rejected or blocked by this classification.
WITH RECURSIVE request_geo AS (
  SELECT sr.id,
         COALESCE(
           CASE WHEN sr.service_address->>'neighborhood' ~ '^[0-9]+$'
             THEN (sr.service_address->>'neighborhood')::integer END,
           CASE WHEN sr.service_address->>'sub_area' ~ '^[0-9]+$'
             THEN (sr.service_address->>'sub_area')::integer END,
           CASE WHEN sr.service_address->>'city_or_area' ~ '^[0-9]+$'
             THEN (sr.service_address->>'city_or_area')::integer END,
           CASE WHEN sr.service_address->>'governorate' ~ '^[0-9]+$'
             THEN (sr.service_address->>'governorate')::integer END
         ) AS geo_unit_id
    FROM public.service_requests sr
   WHERE sr.request_type = 'account_creation'
     AND sr.branch_resolution_status = 'not_applicable'
),
ancestors(request_id, geo_unit_id) AS (
  SELECT id, geo_unit_id FROM request_geo WHERE geo_unit_id IS NOT NULL
  UNION ALL
  SELECT a.request_id, g.parent_id
    FROM ancestors a
    JOIN public.geo_units g ON g.id = a.geo_unit_id
   WHERE g.parent_id IS NOT NULL
),
descendants(request_id, geo_unit_id) AS (
  SELECT id, geo_unit_id FROM request_geo WHERE geo_unit_id IS NOT NULL
  UNION ALL
  SELECT d.request_id, g.id
    FROM descendants d
    JOIN public.geo_units g ON g.parent_id = d.geo_unit_id
),
related_geo AS (
  SELECT request_id, geo_unit_id FROM ancestors
  UNION
  SELECT request_id, geo_unit_id FROM descendants
),
branch_coverage AS (
  SELECT b.id AS branch_id, bgc.geo_unit_id AS coverage_geo_id
    FROM public.branches b
    JOIN public.branch_geo_coverage bgc ON bgc.branch_id = b.id
   WHERE b.status = 'active'
  UNION ALL
  SELECT b.id, b.location_geo_id
    FROM public.branches b
   WHERE b.status = 'active'
     AND b.location_geo_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.branch_geo_coverage bgc WHERE bgc.branch_id = b.id
     )
),
matches AS (
  SELECT DISTINCT rg.request_id, bc.branch_id
    FROM related_geo rg
    JOIN branch_coverage bc ON bc.coverage_geo_id = rg.geo_unit_id
),
resolution AS (
  SELECT rg.id AS request_id,
         rg.geo_unit_id,
         COUNT(m.branch_id)::integer AS match_count,
         MIN(m.branch_id) AS branch_id
    FROM request_geo rg
    LEFT JOIN matches m ON m.request_id = rg.id
   GROUP BY rg.id, rg.geo_unit_id
)
UPDATE public.service_requests sr
   SET branch_id = CASE WHEN r.match_count = 1 THEN r.branch_id ELSE NULL END,
       branch_resolution_status = CASE
         WHEN r.geo_unit_id IS NULL THEN 'missing_geo'
         WHEN r.match_count = 0 THEN 'no_coverage'
         WHEN r.match_count = 1 THEN 'resolved'
         ELSE 'ambiguous'
       END,
       branch_resolution_reason = CASE
         WHEN r.geo_unit_id IS NULL THEN 'No valid geo unit was supplied with the request.'
         WHEN r.match_count = 0 THEN 'No active branch coverage matched the request geography.'
         WHEN r.match_count = 1 THEN 'Resolved from branch geographic coverage.'
         ELSE 'More than one active branch matched the request geography.'
       END,
       branch_resolution_geo_unit_id = r.geo_unit_id,
       updated_at = NOW()
  FROM resolution r
 WHERE sr.id = r.request_id;

COMMIT;
