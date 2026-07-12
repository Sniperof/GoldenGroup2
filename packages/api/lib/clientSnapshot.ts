// ============================================================
// clientSnapshot.ts — reusable Level-2 client snapshot builder
// ============================================================
// Produces the ClientSnapshotData shape consumed by the web
// <ClientSnapshot /> component (docs/constitution/components/
// client-snapshot.md → المستوى الثاني). Mirrors the inline snapshot
// built in routes/fieldVisits.ts, but keyed by client id so it can be
// reused (e.g. showing a linked beneficiary inside a service request).
// ============================================================

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

export interface ClientSnapshotData {
  gender: 'male' | 'female' | null;
  dataQuality: string | null;
  firstName: string | null;
  fatherName: string | null;
  lastName: string | null;
  nickname: string | null;
  fullName: string | null;
  classification: string | null;
  primaryMobile: string | null;
  contacts: any[];
  address: {
    governorate: string | null;
    district: string | null;
    subArea: string | null;
    neighborhood: string | null;
    detailedAddress: string | null;
    gps: { lat?: number; lng?: number } | null;
    geoPath: Array<{ id: number; name: string; level: number }>;
  };
  occupation: string | null;
  spouseOccupation: string | null;
  committed: string | null;
  referrers: Array<{ type: string | null; name: string | null }>;
  referrersCount: number;
  notes: string | null;
  sourceChannel: string | null;
  ownership: {
    assignees: Array<{ userName: string; roleDisplay: string | null }>;
    branchName: string | null;
  };
}

export async function buildClientSnapshot(
  db: Queryable,
  clientId: number,
): Promise<ClientSnapshotData | null> {
  const { rows } = await db.query(
    `SELECT c.gender, c.data_quality, c.first_name, c.father_name, c.last_name,
            c.nickname, c.name, c.candidate_status, c.mobile, c.contacts,
            c.detailed_address, c.gps_coordinates, c.occupation, c.spouse_occupation,
            c.rating, c.referrers, c.referrer_type, c.referrer_name, c.notes,
            c.source_channel, c.governorate, c.district, c.neighborhood,
            b.name AS branch_name
       FROM clients c
       LEFT JOIN branches b ON b.id = c.branch_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [clientId],
  );
  if (rows.length === 0) return null;
  const c = rows[0];

  // Full geo ancestry from the deepest stored geo id (parent_id walk).
  const deepest = c.neighborhood ?? c.district ?? c.governorate ?? null;
  let geoPath: Array<{ id: number; name: string; level: number }> = [];
  if (Number.isInteger(deepest) && deepest) {
    const { rows: gp } = await db.query(
      `WITH RECURSIVE chain AS (
         SELECT id, name, parent_id, level FROM geo_units WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.parent_id, g.level
           FROM geo_units g JOIN chain ch ON g.id = ch.parent_id
       )
       SELECT id, name, level FROM chain ORDER BY level`,
      [deepest],
    );
    geoPath = gp.map((g: any) => ({ id: Number(g.id), name: String(g.name), level: Number(g.level) }));
  }
  const byLevel = (lvl: number) => geoPath.find((g) => g.level === lvl)?.name ?? null;

  const { rows: assigneeRows } = await db.query(
    `SELECT u.name AS user_name
       FROM client_assignments ca
       JOIN hr_users u ON u.id = ca.hr_user_id
      WHERE ca.client_id = $1
      ORDER BY ca.assigned_at ASC NULLS LAST, ca.id ASC`,
    [clientId],
  );
  const assignees = assigneeRows.map((a: any) => ({ userName: a.user_name, roleDisplay: null }));

  let referrersArr: any[] = Array.isArray(c.referrers) ? c.referrers : [];
  if (referrersArr.length === 0 && (c.referrer_name || c.referrer_type)) {
    referrersArr = [{ type: c.referrer_type ?? null, name: c.referrer_name ?? null }];
  }

  const candStatus = String(c.candidate_status ?? '').toUpperCase();
  const classification = ['OP', 'FOP'].includes(candStatus) ? candStatus : 'LEAD';

  return {
    gender: c.gender ?? null,
    dataQuality: c.data_quality ?? null,
    firstName: c.first_name ?? null,
    fatherName: c.father_name ?? null,
    lastName: c.last_name ?? null,
    nickname: c.nickname ?? null,
    fullName: c.name ?? null,
    classification,
    primaryMobile: c.mobile ?? null,
    contacts: Array.isArray(c.contacts) ? c.contacts : [],
    address: {
      governorate: byLevel(1),
      district: byLevel(2),
      subArea: byLevel(3),
      neighborhood: byLevel(4),
      detailedAddress: c.detailed_address ?? null,
      gps: c.gps_coordinates ?? null,
      geoPath,
    },
    occupation: c.occupation ?? null,
    spouseOccupation: c.spouse_occupation ?? null,
    committed: c.rating ?? null,
    referrers: referrersArr.map((r: any) => ({ type: r?.type ?? null, name: r?.name ?? null })),
    referrersCount: referrersArr.length,
    notes: c.notes ?? null,
    sourceChannel: c.source_channel ?? null,
    ownership: { assignees, branchName: c.branch_name ?? null },
  };
}
