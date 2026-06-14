import pool from '../db.js';
import type {
  ZoneStudyMode,
  ZoneStudyRow,
  ZoneStudySnapshotData,
  ZoneStudyResponse,
} from '@golden-crm/shared';
import { resolveTeamPlanningScope } from './teamPlanningScope.js';
import { buildClientLifecycleStatusSql } from './customerOwnership.js';
import { buildOpenTaskEligibilityPredicate } from './planningMarketingTargets.js';

// ── Errors (mapped to HTTP codes by the route layer) ─────────────────────────
export class ZoneStudyFrozenError extends Error {
  code = 'SNAPSHOT_FROZEN' as const;
  constructor() {
    super('لا يمكن تعديل snapshot ليوم سابق (مجمَّد بعد منتصف الليل)');
  }
}
export class ZoneStudyConflictError extends Error {
  code = 'ZONE_ALREADY_PICKED' as const;
  constructor() {
    super('المنطقة مضافة بالفعل إلى الاستكشاف');
  }
}
export class ZoneStudyValidationError extends Error {
  code = 'INVALID_ZONE' as const;
  constructor(message: string) {
    super(message);
  }
}

interface ResolvedTeam {
  teamKey: string;
  teamLabel: string;
  ownerHrUserIds: number[];
}

// ── Date helpers (freeze boundary uses DB CURRENT_DATE per DEC-008 D46) ───────
async function getDbToday(): Promise<string> {
  const { rows } = await pool.query<{ today: string }>('SELECT CURRENT_DATE::text AS today');
  return rows[0].today;
}
function isFrozenDate(date: string, today: string): boolean {
  // YYYY-MM-DD strings compare lexicographically in calendar order.
  return date < today;
}

// ── Team resolution from day_schedules ───────────────────────────────────────
async function resolveTeams(date: string, branchId: number): Promise<{ teams: ResolvedTeam[]; schedulePresent: boolean }> {
  const { rows } = await pool.query<{ teams: any }>(
    'SELECT teams FROM day_schedules WHERE date = $1',
    [date],
  );
  const teamsRaw: any[] = Array.isArray(rows[0]?.teams) ? rows[0].teams : [];
  if (teamsRaw.length === 0) {
    return { teams: [], schedulePresent: false };
  }

  // Resolve owner hr_user ids per team (supervisor + technician).
  const scopes = await Promise.all(
    teamsRaw.map(team =>
      resolveTeamPlanningScope({
        supervisor: team?.supervisor,
        technician: team?.technician,
        branchId,
      }),
    ),
  );

  // Batch-load employee names for team labels.
  const employeeIds = new Set<number>();
  teamsRaw.forEach(team => {
    if (team?.supervisor != null) employeeIds.add(Number(team.supervisor));
    if (team?.technician != null) employeeIds.add(Number(team.technician));
  });
  const nameByEmployee = new Map<number, string>();
  if (employeeIds.size > 0) {
    const { rows: empRows } = await pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM employees WHERE id = ANY($1::int[])',
      [Array.from(employeeIds)],
    );
    empRows.forEach(r => nameByEmployee.set(Number(r.id), r.name));
  }

  const teams: ResolvedTeam[] = teamsRaw.map((team, index) => {
    const scope = scopes[index];
    const ownerHrUserIds = [scope.supervisorHrUserId, scope.technicianHrUserId].filter(
      (id): id is number => id != null,
    );
    const supName = team?.supervisor != null ? nameByEmployee.get(Number(team.supervisor)) : undefined;
    const techName = team?.technician != null ? nameByEmployee.get(Number(team.technician)) : undefined;
    const teamLabel = supName ? `فريق ${supName}` : techName ? `فريق ${techName}` : `فريق ${index + 1}`;
    return { teamKey: `team_${index}`, teamLabel, ownerHrUserIds };
  });

  return { teams, schedulePresent: true };
}

// ── Company eligible tasks per zone (all task types, company-owned clients) ───
async function loadCompanyEligibleByZone(branchId: number): Promise<Map<number, number>> {
  const eligibility = buildOpenTaskEligibilityPredicate('ot', 'ttc', 'planning');
  const lifecycle = buildClientLifecycleStatusSql('c');
  const { rows } = await pool.query<{ zoneId: number; count: number }>(
    `
      SELECT effective_zone AS "zoneId", COUNT(*)::int AS count
      FROM (
        SELECT
          ot.id,
          CASE
            WHEN ttc.location_basis IN ('contract', 'device')
              THEN inst.installation_geo_unit_id
            ELSE c.neighborhood
          END AS effective_zone
        FROM open_tasks ot
        JOIN clients c ON c.id = ot.client_id AND c.branch_id = ot.branch_id
        JOIN task_type_config ttc ON ttc.task_type = ot.task_type
        LEFT JOIN installed_devices inst
          ON inst.id = ot.device_id
         AND ttc.location_basis IN ('contract', 'device')
        WHERE ot.branch_id = $1
          AND (c.is_active IS NULL OR c.is_active = TRUE)
          AND c.deleted_at IS NULL
          AND ( ${eligibility} )
          AND (
            ( ${lifecycle} ) IN ('OP', 'FOP')
            OR NOT EXISTS (
              SELECT 1
              FROM client_assignments ca
              JOIN hr_users u ON u.id = ca.hr_user_id
              WHERE ca.client_id = c.id
                AND u.employee_id IS NOT NULL
                AND u.is_active = TRUE
            )
          )
      ) t
      WHERE effective_zone IS NOT NULL
      GROUP BY effective_zone
    `,
    [branchId],
  );
  const map = new Map<number, number>();
  rows.forEach(r => map.set(Number(r.zoneId), Number(r.count)));
  return map;
}

// ── Per-team X/Y by zone (device_demo only, personally-owned LEAD clients) ────
async function loadTeamZoneStats(
  branchId: number,
  ownerHrUserIds: number[],
): Promise<Map<number, { x: number; y: number }>> {
  const map = new Map<number, { x: number; y: number }>();
  if (ownerHrUserIds.length === 0) return map;

  const lifecycle = buildClientLifecycleStatusSql('c');
  const eligibility = buildOpenTaskEligibilityPredicate('ot', 'ttc', 'planning');
  const { rows } = await pool.query<{ zoneId: number; x: number; y: number }>(
    `
      WITH team_clients AS (
        SELECT c.id AS client_id, c.neighborhood AS zone_id
        FROM clients c
        WHERE c.branch_id = $1
          AND (c.is_active IS NULL OR c.is_active = TRUE)
          AND c.deleted_at IS NULL
          AND c.neighborhood IS NOT NULL
          AND ( ${lifecycle} ) = 'LEAD'
          AND EXISTS (
            SELECT 1
            FROM client_assignments ca
            JOIN hr_users u ON u.id = ca.hr_user_id
            JOIN roles r ON r.id = u.role_id
            JOIN employees e ON e.id = u.employee_id
            WHERE ca.client_id = c.id
              AND ca.hr_user_id = ANY($2::int[])
              AND u.is_active = TRUE
              AND u.employee_id IS NOT NULL
              AND r.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')
              AND e.status = 'active'
          )
      )
      SELECT
        tc.zone_id AS "zoneId",
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM open_tasks ot
            WHERE ot.client_id = tc.client_id
              AND ot.task_type = 'device_demo'
              AND ot.status IN ('open', 'needs_follow_up')
          )
        )::int AS x,
        COALESCE(SUM((
          SELECT COUNT(*)
          FROM open_tasks ot
          JOIN task_type_config ttc ON ttc.task_type = ot.task_type
          WHERE ot.client_id = tc.client_id
            AND ot.task_type = 'device_demo'
            AND ( ${eligibility} )
        )), 0)::int AS y
      FROM team_clients tc
      GROUP BY tc.zone_id
    `,
    [branchId, ownerHrUserIds],
  );
  rows.forEach(r => map.set(Number(r.zoneId), { x: Number(r.x), y: Number(r.y) }));
  return map;
}

async function loadZoneNames(zoneIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (zoneIds.length === 0) return map;
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM geo_units WHERE id = ANY($1::int[])',
    [zoneIds],
  );
  rows.forEach(r => map.set(Number(r.id), r.name));
  return map;
}

// ── Core computation (no DB writes) ──────────────────────────────────────────
export async function computeZoneStudy(opts: {
  date: string;
  branchId: number;
  mode: ZoneStudyMode;
  pickedZoneIds?: number[];
}): Promise<ZoneStudySnapshotData> {
  const { date, branchId, mode } = opts;
  const pickedZoneIds = Array.from(new Set(opts.pickedZoneIds ?? []));

  const [{ teams, schedulePresent }, companyByZone] = await Promise.all([
    resolveTeams(date, branchId),
    loadCompanyEligibleByZone(branchId),
  ]);

  const zoneIds = mode === 'auto' ? Array.from(companyByZone.keys()) : pickedZoneIds;

  const teamZoneStats = new Map<string, Map<number, { x: number; y: number }>>();
  await Promise.all(
    teams.map(async t => {
      teamZoneStats.set(t.teamKey, await loadTeamZoneStats(branchId, t.ownerHrUserIds));
    }),
  );

  const zoneNames = await loadZoneNames(zoneIds);

  const zones: ZoneStudyRow[] = zoneIds.map(zoneId => ({
    zoneId,
    zoneName: zoneNames.get(zoneId) ?? `#${zoneId}`,
    companyEligibleCount: companyByZone.get(zoneId) ?? 0,
    teams: teams.map(t => {
      const s = teamZoneStats.get(t.teamKey)?.get(zoneId);
      return {
        teamKey: t.teamKey,
        teamLabel: t.teamLabel,
        untappedLeads: s?.x ?? 0,
        eligibleDeviceDemos: s?.y ?? 0,
      };
    }),
  }));

  zones.sort(
    (a, b) =>
      b.companyEligibleCount - a.companyEligibleCount ||
      a.zoneName.localeCompare(b.zoneName, 'ar'),
  );

  const data: ZoneStudySnapshotData = {
    branchSchedulePresent: schedulePresent,
    computedAt: new Date().toISOString(),
    zones,
  };
  if (mode === 'manual') {
    data.pickedZoneIds = pickedZoneIds;
  }
  return data;
}

// ── Snapshot persistence ─────────────────────────────────────────────────────
interface SnapshotRow {
  id: number;
  branch_id: number;
  date: string;
  user_id: number | null;
  mode: ZoneStudyMode;
  snapshot_data: ZoneStudySnapshotData;
  refreshed_at: string;
}

async function readSnapshotRow(
  branchId: number,
  date: string,
  mode: ZoneStudyMode,
  userId: number | null,
): Promise<SnapshotRow | null> {
  const { rows } = await pool.query<SnapshotRow>(
    `SELECT id, branch_id, date::text AS date, user_id, mode, snapshot_data, refreshed_at::text AS refreshed_at
       FROM zone_study_snapshots
      WHERE branch_id = $1 AND date = $2::date AND mode = $3
        AND COALESCE(user_id, 0) = COALESCE($4::int, 0)
      LIMIT 1`,
    [branchId, date, mode, userId],
  );
  return rows[0] ?? null;
}

async function upsertSnapshot(
  branchId: number,
  date: string,
  mode: ZoneStudyMode,
  userId: number | null,
  data: ZoneStudySnapshotData,
): Promise<SnapshotRow> {
  const { rows } = await pool.query<SnapshotRow>(
    `INSERT INTO zone_study_snapshots (branch_id, date, user_id, mode, snapshot_data)
     VALUES ($1, $2::date, $3, $4, $5::jsonb)
     ON CONFLICT (branch_id, date, mode, COALESCE(user_id, 0))
     DO UPDATE SET snapshot_data = EXCLUDED.snapshot_data, refreshed_at = NOW()
     RETURNING id, branch_id, date::text AS date, user_id, mode, snapshot_data, refreshed_at::text AS refreshed_at`,
    [branchId, date, userId, mode, JSON.stringify(data)],
  );
  return rows[0];
}

function toResponse(
  row: SnapshotRow | null,
  frozen: boolean,
  date: string,
  branchId: number,
  mode: ZoneStudyMode,
  userId: number | null,
): ZoneStudyResponse {
  if (!row) {
    return { date, branchId, mode, userId, refreshedAt: null, isFrozen: frozen, snapshot: null };
  }
  return {
    date: row.date,
    branchId: row.branch_id,
    mode: row.mode,
    userId: row.user_id,
    refreshedAt: row.refreshed_at,
    isFrozen: frozen,
    snapshot: row.snapshot_data,
  };
}

// GET — read snapshot, lazily creating it for the current/future day (ZS-R012).
export async function getOrCreateSnapshot(opts: {
  date: string;
  branchId: number;
  mode: ZoneStudyMode;
  userId: number;
}): Promise<ZoneStudyResponse> {
  const { date, branchId, mode } = opts;
  const effUserId = mode === 'manual' ? opts.userId : null;
  const today = await getDbToday();
  const frozen = isFrozenDate(date, today);

  const existing = await readSnapshotRow(branchId, date, mode, effUserId);
  if (existing) {
    return toResponse(existing, frozen, date, branchId, mode, effUserId);
  }

  // Past day with no stored snapshot → never create one (ZS-R012 exception).
  if (frozen) {
    return toResponse(null, true, date, branchId, mode, effUserId);
  }

  const data = await computeZoneStudy({ date, branchId, mode, pickedZoneIds: [] });
  const row = await upsertSnapshot(branchId, date, mode, effUserId, data);
  return toResponse(row, false, date, branchId, mode, effUserId);
}

// POST /refresh — recompute (current/future day only).
export async function refreshSnapshot(opts: {
  date: string;
  branchId: number;
  mode: ZoneStudyMode;
  userId: number;
}): Promise<ZoneStudyResponse> {
  const { date, branchId, mode } = opts;
  const effUserId = mode === 'manual' ? opts.userId : null;
  const today = await getDbToday();
  if (isFrozenDate(date, today)) throw new ZoneStudyFrozenError();

  let pickedZoneIds: number[] = [];
  if (mode === 'manual') {
    const existing = await readSnapshotRow(branchId, date, mode, effUserId);
    pickedZoneIds = existing?.snapshot_data?.pickedZoneIds ?? [];
  }

  const data = await computeZoneStudy({ date, branchId, mode, pickedZoneIds });
  const row = await upsertSnapshot(branchId, date, mode, effUserId, data);
  return toResponse(row, false, date, branchId, mode, effUserId);
}

// geo_units are GLOBAL (no branch_id), and Mode 2's whole purpose is to explore
// zones the branch does NOT currently work — including quiet zones with no tasks
// or clients yet. Restricting picks to zones that already host branch data would
// defeat exploration, so validation is intentionally limited to existence +
// active. (Branch/geo scoping is not enforceable at the schema level — see the
// TC-13 reconciliation note in features/zone-study.md.)
async function assertZoneSelectable(zoneId: number): Promise<void> {
  if (!Number.isInteger(zoneId) || zoneId <= 0) {
    throw new ZoneStudyValidationError('zoneId is required');
  }
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM geo_units WHERE id = $1 AND status = 'active' LIMIT 1`,
    [zoneId],
  );
  if (!rows[0]) {
    throw new ZoneStudyValidationError('zoneId غير صالح أو غير فعّال');
  }
}

// POST /manual/pick — add a zone to the manual exploration (manual, per-user).
export async function pickZone(opts: {
  date: string;
  branchId: number;
  userId: number;
  zoneId: number;
}): Promise<ZoneStudyResponse> {
  const { date, branchId, userId, zoneId } = opts;
  const today = await getDbToday();
  if (isFrozenDate(date, today)) throw new ZoneStudyFrozenError();

  await assertZoneSelectable(zoneId);

  const existing = await readSnapshotRow(branchId, date, 'manual', userId);
  const picked = new Set<number>(existing?.snapshot_data?.pickedZoneIds ?? []);
  if (picked.has(zoneId)) throw new ZoneStudyConflictError();
  picked.add(zoneId);

  const data = await computeZoneStudy({ date, branchId, mode: 'manual', pickedZoneIds: [...picked] });
  const row = await upsertSnapshot(branchId, date, 'manual', userId, data);
  return toResponse(row, false, date, branchId, 'manual', userId);
}

// DELETE /manual/pick/:zoneId — remove a zone (idempotent).
export async function unpickZone(opts: {
  date: string;
  branchId: number;
  userId: number;
  zoneId: number;
}): Promise<ZoneStudyResponse> {
  const { date, branchId, userId, zoneId } = opts;
  const today = await getDbToday();
  if (isFrozenDate(date, today)) throw new ZoneStudyFrozenError();

  const existing = await readSnapshotRow(branchId, date, 'manual', userId);
  const picked = new Set<number>(existing?.snapshot_data?.pickedZoneIds ?? []);
  picked.delete(zoneId);

  const data = await computeZoneStudy({ date, branchId, mode: 'manual', pickedZoneIds: [...picked] });
  const row = await upsertSnapshot(branchId, date, 'manual', userId, data);
  return toResponse(row, false, date, branchId, 'manual', userId);
}
