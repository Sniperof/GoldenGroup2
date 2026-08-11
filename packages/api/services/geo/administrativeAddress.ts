// ============================================================
// services/geo/administrativeAddress.ts
// ============================================================
// THE validator for an administrative address arriving from a public channel.
// Every mobile intake path must go through it — it is the single definition of
// "this address is real".
//
// The mobile app must send canonical geo_units IDs (picked via
// GET /api/public/areas), NOT free text. We verify every provided id exists at
// its expected level and that the chain is contiguous (each child's parent is
// the level above), then return both the canonical integer ids AND a resolved
// names snapshot so the admin comparison view is readable and stable even if
// the geo tree changes later.
//
//   Level map:  1 = governorate · 2 = city/area · 3 = sub-area · 4 = neighborhood
//
// History: this started life as `services/appAccounts/addressValidation.ts`,
// serving account_creation only, while water_check accepted any positive
// integer as a geo id — same app, same picker, two standards. Moved here (a
// neutral module, no appAccounts↔serviceRequests dependency) so reuse is the
// path of least resistance for the next request type too.
//
// Kept pure + single-query so it is unit-testable in isolation from any
// request-insert transaction.
// ============================================================

import pool from '../../db.js';

export interface RawAddressInput {
  governorate: number | string | null | undefined;
  cityOrArea?: number | string | null;
  subArea?: number | string | null;
  neighborhood?: number | string | null;
}

export interface ResolvedAddress {
  ids: {
    governorate: number;
    cityOrArea: number | null;
    subArea: number | null;
    neighborhood: number | null;
  };
  /** Resolved level names, snapshotted at submit time for admin comparison. */
  labels: {
    governorate: string;
    cityOrArea: string | null;
    subArea: string | null;
    neighborhood: string | null;
  };
}

interface Queryable {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

interface GeoRow {
  id: number;
  name: string;
  level: number;
  parent_id: number | null;
  status: string;
}

const LABEL_AR: Record<string, string> = {
  governorate: 'المحافظة',
  cityOrArea: 'المنطقة',
  subArea: 'الناحية',
  neighborhood: 'الحي',
};

const PARENT_LABEL: Record<string, string> = {
  cityOrArea: 'المحافظة',
  subArea: 'المنطقة',
  neighborhood: 'الناحية',
};

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/** null when absent; throws 400 when present-but-not-a-positive-integer. */
function parseOptionalId(value: unknown, key: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw httpError(400, `${LABEL_AR[key]} يجب أن تكون مُعرّفاً رقمياً صحيحاً من قائمة المناطق`);
  }
  return n;
}

/**
 * Validate + resolve the four administrative levels. `governorate` is required;
 * the deeper levels are optional but must be contiguous (no gaps) and each must
 * exist at its level and descend from the one above.
 *
 * @param db optional queryable (a transaction client); defaults to the pool.
 */
export async function resolveAndValidateAddress(
  input: RawAddressInput,
  db: Queryable = pool,
): Promise<ResolvedAddress> {
  const governorate = parseOptionalId(input.governorate, 'governorate');
  const cityOrArea = parseOptionalId(input.cityOrArea, 'cityOrArea');
  const subArea = parseOptionalId(input.subArea, 'subArea');
  const neighborhood = parseOptionalId(input.neighborhood, 'neighborhood');

  if (governorate === null) throw httpError(400, 'المحافظة مطلوبة');

  // Contiguity: a cascading picker never yields a deeper level without its parent.
  if (neighborhood !== null && subArea === null) {
    throw httpError(400, 'لا يمكن تحديد الحي دون تحديد الناحية');
  }
  if (subArea !== null && cityOrArea === null) {
    throw httpError(400, 'لا يمكن تحديد الناحية دون تحديد المنطقة');
  }

  const wanted: { key: string; id: number; level: number; parent: number | null }[] = [
    { key: 'governorate', id: governorate, level: 1, parent: null },
    { key: 'cityOrArea', id: cityOrArea!, level: 2, parent: governorate },
    { key: 'subArea', id: subArea!, level: 3, parent: cityOrArea },
    { key: 'neighborhood', id: neighborhood!, level: 4, parent: subArea },
  ].filter((x) => x.id != null);

  const { rows } = await db.query(
    `SELECT id, name, level, parent_id, status FROM geo_units WHERE id = ANY($1)`,
    [wanted.map((w) => w.id)],
  );
  const byId = new Map((rows as GeoRow[]).map((r) => [Number(r.id), r]));

  const names: Record<string, string> = {};
  for (const w of wanted) {
    const unit = byId.get(w.id);
    if (!unit) throw httpError(400, `${LABEL_AR[w.key]}: الوحدة الجغرافية غير موجودة`);
    if (unit.status !== 'active') {
      throw httpError(400, `${LABEL_AR[w.key]}: الوحدة الجغرافية غير مفعّلة`);
    }
    if (Number(unit.level) !== w.level) {
      throw httpError(400, `${LABEL_AR[w.key]}: المستوى الإداري غير مطابق`);
    }
    if (w.parent !== null && Number(unit.parent_id) !== w.parent) {
      throw httpError(400, `${LABEL_AR[w.key]} لا تتبع ${PARENT_LABEL[w.key]} المحددة`);
    }
    names[w.key] = unit.name;
  }

  return {
    ids: { governorate, cityOrArea, subArea, neighborhood },
    labels: {
      governorate: names.governorate,
      cityOrArea: names.cityOrArea ?? null,
      subArea: names.subArea ?? null,
      neighborhood: names.neighborhood ?? null,
    },
  };
}
