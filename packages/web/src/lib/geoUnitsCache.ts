// Module-level cache for the full geo_units NAME map (display only).
//
// Rationale: many consumers (task tables, client profile, device profile, geo
// path display…) need the *complete* tree to resolve a leaf id into a path of
// ancestor names. The list is small (a few hundred rows for Syria), changes
// rarely, and is identical for every component on a page. Fetching it once
// per session and de-duplicating concurrent requests avoids the N+1 we'd
// otherwise see when many small geo-aware widgets mount together.
//
// SCOPE (branch-scope-and-visibility-standard.md §3): reference labels (a
// neighbourhood / district NAME) are global — anyone who may see a record may
// read its address. So this cache is fed by the GLOBAL names endpoint
// (`/geo-units/names`, every unit, no branch scope) and keyed by TOKEN ONLY.
// It previously called the scoped `list()` keyed by branch+path, which made a
// row's address render "--" whenever it fell outside the current branch filter
// (ثغرة 1). Pickers stay scoped via `api.geoUnits.list(branchId)` — NOT here.

import { api } from './api';

export interface GeoUnit {
  id: number;
  name: string;
  level: number;         // 1=governorate, 2=district, 3=sub-district, 4=neighborhood (per geo-units constitution §3 BR-1)
  parentId: number | null;
  status?: string;
}

let cached: GeoUnit[] | null = null;
let cachedKey: string | null = null;
let inflight: Promise<GeoUnit[]> | null = null;
let inflightKey: string | null = null;

function getCacheKey(): string {
  // Token only — the names map is global (§3), so it must NOT vary by branch
  // context or page path (that was the source of the stale-address bug).
  return localStorage.getItem('hr_token') ?? '';
}

export async function getGeoUnits(): Promise<GeoUnit[]> {
  const key = getCacheKey();
  if (cached && cachedKey === key) return cached;
  if (inflight && inflightKey === key) return inflight;
  inflightKey = key;
  inflight = api.geoUnits
    .names()
    .then((rows: any[]) => {
      // Normalize shape: API returns `parentId` already (see geo-units constitution §7.1).
      cached = rows.map(r => ({
        id:       Number(r.id),
        name:     String(r.name),
        level:    Number(r.level),
        parentId: r.parentId == null ? null : Number(r.parentId),
        status:   r.status,
      }));
      cachedKey = key;
      return cached;
    })
    .finally(() => {
      inflight = null;
      inflightKey = null;
    });
  return inflight;
}

/**
 * Reset the cache. Call this from admin pages that mutate geo_units so the
 * next consumer reads fresh data. No-op in the device profile flow.
 */
export function invalidateGeoUnitsCache(): void {
  cached = null;
  cachedKey = null;
}
