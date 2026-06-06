-- ============================================================
-- 260 — Backfill device_snapshot.location.geoPath
-- ============================================================
-- Constitution: docs/constitution/domains/geo-units.md BR-4
--   Full Address = Governorate → District → Neighborhood → Detailed
-- Adds geoPath array to existing device_snapshot.location so the
-- frontend can render the full address chain (not just the leaf).
-- ============================================================

WITH paths AS (
  SELECT
    d.id AS device_id,
    COALESCE(
      jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'level', g.level) ORDER BY g.level)
        FILTER (WHERE g.id IS NOT NULL),
      '[]'::jsonb
    ) AS geo_path
  FROM installed_devices d
  LEFT JOIN LATERAL (
    WITH RECURSIVE chain AS (
      SELECT id, name, level, parent_id FROM geo_units WHERE id = d.installation_geo_unit_id
      UNION ALL
      SELECT g.id, g.name, g.level, g.parent_id FROM geo_units g JOIN chain c ON g.id = c.parent_id
    )
    SELECT * FROM chain
  ) g ON true
  GROUP BY d.id
)
UPDATE public.open_tasks ot
   SET device_snapshot = jsonb_set(
        device_snapshot,
        '{location,geoPath}',
        paths.geo_path,
        true
   )
  FROM paths
 WHERE ot.device_id = paths.device_id
   AND ot.device_snapshot IS NOT NULL;
