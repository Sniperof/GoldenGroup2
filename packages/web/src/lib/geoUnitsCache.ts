// Module-level cache for the full geo_units list.
//
// Rationale: many consumers (client profile, device profile, candidate forms,
// branches…) need the *complete* tree to resolve a leaf id into a path of
// ancestor names. The list is small (a few hundred rows for Syria), changes
// rarely, and is identical for every component on a page. Fetching it once
// per session and de-duplicating concurrent requests avoids the N+1 we'd
// otherwise see when many small geo-aware widgets mount together.
//
// The cache is intentionally process-local and trusts the API's auth +
// branch-scope filtering — we never persist it to localStorage.

import { api } from './api';

export interface GeoUnit {
  id: number;
  name: string;
  level: number;         // 1=governorate, 2=district, 3=sub-district, 4=neighborhood (per geo-units constitution §3 BR-1)
  parentId: number | null;
  status?: string;
}

let cached: GeoUnit[] | null = null;
let inflight: Promise<GeoUnit[]> | null = null;

export async function getGeoUnits(): Promise<GeoUnit[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = api.geoUnits
    .list()
    .then((rows: any[]) => {
      // Normalize shape: API returns `parentId` already (see geo-units constitution §7.1).
      cached = rows.map(r => ({
        id:       Number(r.id),
        name:     String(r.name),
        level:    Number(r.level),
        parentId: r.parentId == null ? null : Number(r.parentId),
        status:   r.status,
      }));
      return cached;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * Reset the cache. Call this from admin pages that mutate geo_units so the
 * next consumer reads fresh data. No-op in the device profile flow.
 */
export function invalidateGeoUnitsCache(): void {
  cached = null;
}
