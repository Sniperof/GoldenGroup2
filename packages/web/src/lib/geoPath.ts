// Pure helpers around the geo_units hierarchy.
//
// The constitution (docs/constitution/domains/geo-units.md §3 BR-1) defines
// four administrative levels:
//   1 → governorate (محافظة)
//   2 → district / city (منطقة / مدينة)
//   3 → sub-district / large neighborhood (ناحية)
//   4 → fine neighborhood / village (حي / قرية)
//
// `buildGeoPath` walks parent_id from a leaf id up to the root, returning
// the units ordered root → leaf. Defensive guards prevent cycles or runaway
// loops on bad data.

import type { GeoUnit } from './geoUnitsCache';

export const GEO_LEVEL_LABELS: Record<number, string> = {
  1: 'محافظة',
  2: 'منطقة',
  3: 'ناحية',
  4: 'حي',
};

export function geoLevelLabel(level: number): string {
  return GEO_LEVEL_LABELS[level] ?? `مستوى ${level}`;
}

/**
 * Walk parent_id chain from leafId up to the root.
 *
 * @returns ordered array root → leaf, e.g. [governorate, district, neighborhood].
 *          Empty array when leafId is unknown or not found.
 */
export function buildGeoPath(units: GeoUnit[], leafId: number | null | undefined): GeoUnit[] {
  if (leafId == null) return [];
  // Build a quick id→unit lookup once (callers tend to call this for several
  // ids in a single render; the cost amortises).
  const byId = new Map<number, GeoUnit>();
  for (const u of units) byId.set(u.id, u);

  const out: GeoUnit[] = [];
  const visited = new Set<number>();
  let cursor: GeoUnit | undefined = byId.get(Number(leafId));
  // Cap at 10 hops — the hierarchy is 4 levels deep; anything longer means
  // corrupted data and we'd rather bail than loop forever.
  for (let i = 0; cursor && i < 10; i++) {
    if (visited.has(cursor.id)) break;
    visited.add(cursor.id);
    out.unshift(cursor);
    if (cursor.parentId == null) break;
    cursor = byId.get(cursor.parentId);
  }
  return out;
}

/**
 * Render the path as a flat string with the constitution's preferred
 * separator (BR-4): "Governorate، District، Sub-district، Neighborhood".
 */
export function formatGeoPathInline(units: GeoUnit[], leafId: number | null | undefined): string {
  const path = buildGeoPath(units, leafId);
  return path.map(u => u.name).join('، ');
}
