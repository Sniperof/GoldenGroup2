// ============================================================
// services/appAccounts/appProfileService.ts
// ============================================================
// GET /api/app/me — the logged-in customer's own profile, resolved from the
// linked clients record. Data-minimized (DEC-013 §2.1.4): exposes only what
// the customer should see about themselves; internal CRM fields (rating,
// cooldown, national id, ownership, notes, data quality…) are never returned.
// ============================================================

import pool from '../../db.js';
import { normalizePhone } from '../../utils/contactValidation.js';
import { deriveClientClassification, type ClientClassification } from '../../lib/clientClassification.js';
import type { AppAccountClaims } from './appAuthService.js';
import { pickContactDetails } from '../customerIdentity/identitySnapshot.js';

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export interface MyProfile {
  appAccountId: number;
  accountStatus: string;
  memberSince: string | null;
  firstName: string | null;
  fatherName: string | null;
  lastName: string | null;
  primaryMobile: string;
  primaryMobileHasWhatsapp: boolean;
  secondaryMobile: string | null;
  secondaryMobileHasWhatsapp: boolean;
  secondaryMobiles: string[];
  classification: ClientClassification;
  address: {
    governorateId: number | null;
    cityOrAreaId: number | null;
    subAreaId: number | null;
    neighborhoodId: number | null;
    governorate: string | null;
    cityOrArea: string | null;
    subArea: string | null;
    neighborhood: string | null;
    detailedAddress: string | null;
    mapLocation: { lat: number; lng: number } | null;
  };
  /** Deprecated compatibility alias; new clients use address.*Id. */
  addressIds: {
    governorate: number | null;
    cityOrArea: number | null;
    subArea: number | null;
    neighborhood: number | null;
  };
  /** Deepest level present — the unit branch resolution routes on. */
  geoUnitId: number | null;
}

interface GeoPathRow {
  id: number;
  level: number;
  name: string;
}

/**
 * Turns the ancestor walk into the canonical mobile address and legacy aliases.
 * Pure — exported for tests.
 *
 * The client record stores only three geo columns for a four-level tree, and
 * the deepest one holds whichever level was picked (a sub-area on some rows, a
 * neighbourhood on others). The missing level is not lost: walking up
 * `geo_units.parent_id` reconstructs the full contiguous chain, which is why no
 * schema change was needed to make the profile drive the request form.
 */
function parseStoredMapLocation(value: unknown): { lat: number; lng: number } | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const raw = candidate as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

export function buildProfileAddress(
  rows: GeoPathRow[],
  detailedAddress: string | null,
  storedMapLocation: unknown = null,
): {
  address: MyProfile['address'];
  addressIds: MyProfile['addressIds'];
  geoUnitId: number | null;
} {
  const address: MyProfile['address'] = {
    governorateId: null, cityOrAreaId: null, subAreaId: null, neighborhoodId: null,
    governorate: null, cityOrArea: null, subArea: null, neighborhood: null,
    detailedAddress,
    mapLocation: parseStoredMapLocation(storedMapLocation),
  };
  const addressIds: MyProfile['addressIds'] = {
    governorate: null, cityOrArea: null, subArea: null, neighborhood: null,
  };
  const BY_LEVEL = { 1: 'governorate', 2: 'cityOrArea', 3: 'subArea', 4: 'neighborhood' } as const;

  let deepest: { level: number; id: number } | null = null;
  for (const row of rows) {
    const key = BY_LEVEL[row.level as 1 | 2 | 3 | 4];
    if (!key) continue;
    address[key] = row.name;
    addressIds[key] = Number(row.id);
    address[`${key}Id` as 'governorateId' | 'cityOrAreaId' | 'subAreaId' | 'neighborhoodId'] = Number(row.id);
    if (!deepest || row.level > deepest.level) deepest = { level: row.level, id: Number(row.id) };
  }
  return { address, addressIds, geoUnitId: deepest?.id ?? null };
}

export async function getMyProfile(claims: AppAccountClaims): Promise<MyProfile> {
  const { rows: accRows } = await pool.query<{ status: string; created_at: string }>(
    `SELECT status, created_at FROM app_accounts WHERE id = $1 AND deleted_at IS NULL`,
    [claims.appAccountId],
  );
  if (accRows.length === 0) throw httpError(404, 'الحساب غير موجود');

  const { rows: cliRows } = await pool.query<{
    first_name: string | null;
    father_name: string | null;
    last_name: string | null;
    contacts: unknown;
    detailed_address: string | null;
    candidate_status: string | null;
    deepest_geo: number | null;
    gps_coordinates: unknown;
  }>(
    `SELECT first_name, father_name, last_name, contacts, detailed_address, gps_coordinates, candidate_status,
            COALESCE(neighborhood, district, governorate) AS deepest_geo
       FROM clients
      WHERE id = $1 AND deleted_at IS NULL`,
    [claims.clientId],
  );
  if (cliRows.length === 0) throw httpError(404, 'سجل الزبون غير موجود');
  const c = cliRows[0];

  // Resolve the address path (levels 1..4, ids + names) by walking up the tree.
  let path: GeoPathRow[] = [];
  if (c.deepest_geo != null) {
    const { rows } = await pool.query<GeoPathRow>(
      `WITH RECURSIVE p AS (
         SELECT id, name, level, parent_id FROM geo_units WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.level, g.parent_id FROM geo_units g JOIN p ON g.id = p.parent_id
       )
       SELECT id, level, name FROM p`,
      [c.deepest_geo],
    );
    path = rows;
  }
  const { address, addressIds, geoUnitId } = buildProfileAddress(path, c.detailed_address, c.gps_coordinates);

  // Extra numbers from contacts, normalized, excluding the primary + duplicates.
  const primaryNorm = normalizePhone(claims.phone);
  const contactDetails = pickContactDetails(c.contacts, primaryNorm);
  const secondaryMobiles = Array.isArray(c.contacts)
    ? [...new Set(
        (c.contacts as any[])
          .map((x) => normalizePhone(typeof x === 'string' ? x : x?.number ?? x?.value ?? x?.mobile))
          .filter((v) => v && v !== primaryNorm),
      )]
    : [];

  return {
    appAccountId: claims.appAccountId,
    accountStatus: accRows[0].status,
    memberSince: accRows[0].created_at ?? null,
    firstName: c.first_name,
    fatherName: c.father_name,
    lastName: c.last_name,
    primaryMobile: claims.phone,
    primaryMobileHasWhatsapp: contactDetails.primaryHasWhatsapp,
    secondaryMobile: contactDetails.secondaryPhone,
    secondaryMobileHasWhatsapp: contactDetails.secondaryHasWhatsapp,
    secondaryMobiles,
    classification: deriveClientClassification(c.candidate_status),
    address,
    addressIds,
    geoUnitId,
  };
}
