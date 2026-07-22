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

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export interface MyProfile {
  appAccountId: number;
  accountStatus: string;
  memberSince: string | null;
  firstName: string | null;
  lastName: string | null;
  primaryMobile: string;
  secondaryMobiles: string[];
  classification: ClientClassification;
  address: {
    governorate: string | null;
    cityOrArea: string | null;
    subArea: string | null;
    neighborhood: string | null;
    detailedAddress: string | null;
  };
}

export async function getMyProfile(claims: AppAccountClaims): Promise<MyProfile> {
  const { rows: accRows } = await pool.query<{ status: string; created_at: string }>(
    `SELECT status, created_at FROM app_accounts WHERE id = $1 AND deleted_at IS NULL`,
    [claims.appAccountId],
  );
  if (accRows.length === 0) throw httpError(404, 'الحساب غير موجود');

  const { rows: cliRows } = await pool.query<{
    first_name: string | null;
    last_name: string | null;
    contacts: unknown;
    detailed_address: string | null;
    candidate_status: string | null;
    deepest_geo: number | null;
  }>(
    `SELECT first_name, last_name, contacts, detailed_address, candidate_status,
            COALESCE(neighborhood, district, governorate) AS deepest_geo
       FROM clients
      WHERE id = $1 AND deleted_at IS NULL`,
    [claims.clientId],
  );
  if (cliRows.length === 0) throw httpError(404, 'سجل الزبون غير موجود');
  const c = cliRows[0];

  // Resolve the address path (level 1..4 names) by walking up the geo tree.
  const address: MyProfile['address'] = {
    governorate: null, cityOrArea: null, subArea: null, neighborhood: null,
    detailedAddress: c.detailed_address,
  };
  if (c.deepest_geo != null) {
    const { rows: path } = await pool.query<{ level: number; name: string }>(
      `WITH RECURSIVE p AS (
         SELECT id, name, level, parent_id FROM geo_units WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.level, g.parent_id FROM geo_units g JOIN p ON g.id = p.parent_id
       )
       SELECT level, name FROM p`,
      [c.deepest_geo],
    );
    for (const r of path) {
      if (r.level === 1) address.governorate = r.name;
      else if (r.level === 2) address.cityOrArea = r.name;
      else if (r.level === 3) address.subArea = r.name;
      else if (r.level === 4) address.neighborhood = r.name;
    }
  }

  // Extra numbers from contacts, normalized, excluding the primary + duplicates.
  const primaryNorm = normalizePhone(claims.phone);
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
    lastName: c.last_name,
    primaryMobile: claims.phone,
    secondaryMobiles,
    classification: deriveClientClassification(c.candidate_status),
    address,
  };
}
