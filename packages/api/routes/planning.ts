import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();

type RouteCompositionInput = {
  routeId: number;
  startIdx: number;
  endIdx: number;
  direction: 'forward' | 'reverse';
};

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeRoutes(value: unknown): RouteCompositionInput[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((route: any) => {
    const routeId = parsePositiveInteger(route?.routeId);
    const startIdx = parseNonNegativeInteger(route?.startIdx);
    const endIdx = parseNonNegativeInteger(route?.endIdx);
    const direction = route?.direction === 'reverse' ? 'reverse' : route?.direction === 'forward' ? 'forward' : null;

    if (routeId == null || startIdx == null || endIdx == null || direction == null || startIdx > endIdx) {
      return [];
    }

    return [{ routeId, startIdx, endIdx, direction }];
  });
}

function normalizeExtraZones(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(parsePositiveInteger)
    .filter((zoneId): zoneId is number => zoneId != null);
}

function buildEmptyResponse(params: {
  teamKey: string;
  reason: string;
  supervisorEmployeeId?: number | null;
  supervisorHrUserId?: number | null;
  zoneIds?: number[];
}) {
  const zoneIds = params.zoneIds ?? [];

  return {
    teamKey: params.teamKey,
    leads: [],
    candidates: [],
    countsByZone: zoneIds.map(zoneId => ({ zoneId, count: 0 })),
    counts: {
      leads: 0,
      candidates: 0,
      total: 0,
    },
    zoneIds,
    targetStationsCount: zoneIds.length,
    hasSupervisor: params.supervisorEmployeeId != null,
    supervisorEmployeeId: params.supervisorEmployeeId ?? null,
    supervisorHrUserId: params.supervisorHrUserId ?? null,
    reason: params.reason,
  };
}

async function buildZoneIds(routes: RouteCompositionInput[], extraZones: number[]): Promise<number[]> {
  const zoneIds = new Set<number>();
  const routeIds = Array.from(new Set(routes.map(route => route.routeId)));

  if (routeIds.length > 0) {
    const { rows } = await pool.query(
      `
        SELECT
          route_id AS "routeId",
          geo_unit_id AS "geoUnitId",
          point_order AS "order"
        FROM route_points
        WHERE route_id = ANY($1::int[])
        ORDER BY route_id, point_order
      `,
      [routeIds],
    );

    const pointsByRoute = new Map<number, { geoUnitId: number; order: number }[]>();
    rows.forEach((row: any) => {
      const routeId = Number(row.routeId);
      const points = pointsByRoute.get(routeId) ?? [];
      points.push({ geoUnitId: Number(row.geoUnitId), order: Number(row.order) });
      pointsByRoute.set(routeId, points);
    });

    routes.forEach(route => {
      const points = (pointsByRoute.get(route.routeId) ?? []).sort((a, b) => a.order - b.order);
      let slice = points.slice(route.startIdx, route.endIdx + 1);
      if (route.direction === 'reverse') {
        slice = slice.reverse();
      }
      slice.forEach(point => {
        if (Number.isInteger(point.geoUnitId) && point.geoUnitId > 0) {
          zoneIds.add(point.geoUnitId);
        }
      });
    });
  }

  extraZones.forEach(zoneId => zoneIds.add(zoneId));
  return [...zoneIds];
}

router.get('/marketing-targets', requirePermission('planning.manage'), async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const teamKey = typeof req.query.teamKey === 'string' ? req.query.teamKey : '';
    const branchId = req.authContext?.actingBranchId ?? null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const keyMatch = teamKey.match(/^(team|solo)_(\d+)$/);
    if (!keyMatch) {
      return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
    }

    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

    if (keyMatch[1] === 'solo') {
      return res.json(buildEmptyResponse({ teamKey, reason: 'SOLO_HAS_NO_MARKETING_LOAD' }));
    }

    const teamIndex = Number(keyMatch[2]);
    const { rows: scheduleRows } = await pool.query(
      'SELECT teams FROM day_schedules WHERE date = $1',
      [date],
    );

    const teams = scheduleRows[0]?.teams;
    const team = Array.isArray(teams) ? teams[teamIndex] : null;
    if (!team) {
      return res.json(buildEmptyResponse({ teamKey, reason: 'TEAM_NOT_FOUND' }));
    }

    const supervisorEmployeeId = parsePositiveInteger(team.supervisor);
    if (supervisorEmployeeId == null) {
      return res.json(buildEmptyResponse({ teamKey, reason: 'TEAM_HAS_NO_SUPERVISOR' }));
    }

    const { rows: supervisorRows } = await pool.query(
      `
        SELECT id
        FROM hr_users
        WHERE employee_id = $1
          AND is_active = TRUE
        LIMIT 1
      `,
      [supervisorEmployeeId],
    );
    const supervisorHrUserId = supervisorRows[0]?.id != null ? Number(supervisorRows[0].id) : null;

    if (supervisorHrUserId == null) {
      return res.json(buildEmptyResponse({
        teamKey,
        reason: 'SUPERVISOR_HAS_NO_ACTIVE_HR_USER',
        supervisorEmployeeId,
      }));
    }

    const assignmentKey = `${date}_${teamKey}`;
    const { rows: assignmentRows } = await pool.query(
      'SELECT routes, extra_zones AS "extraZones" FROM route_assignments WHERE key = $1',
      [assignmentKey],
    );

    if (!assignmentRows[0]) {
      return res.json(buildEmptyResponse({
        teamKey,
        reason: 'ROUTE_ASSIGNMENT_NOT_FOUND',
        supervisorEmployeeId,
        supervisorHrUserId,
      }));
    }

    const routes = normalizeRoutes(assignmentRows[0].routes);
    const extraZones = normalizeExtraZones(assignmentRows[0].extraZones);
    const zoneIds = await buildZoneIds(routes, extraZones);

    if (zoneIds.length === 0) {
      return res.json(buildEmptyResponse({
        teamKey,
        reason: 'NO_TARGET_STATIONS',
        supervisorEmployeeId,
        supervisorHrUserId,
        zoneIds,
      }));
    }

    const { rows: countsByZoneRows } = await pool.query(
      `
        SELECT
          c.neighborhood::int AS "zoneId",
          COUNT(*)::int AS count
        FROM clients c
        WHERE c.is_candidate = FALSE
          AND c.branch_id = $1
          AND NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
          AND c.neighborhood::int = ANY($2::int[])
          AND EXISTS (
            SELECT 1
            FROM client_assignments ca
            WHERE ca.client_id = c.id
              AND ca.hr_user_id = $3
          )
          AND NOT EXISTS (
            SELECT 1
            FROM contracts ct
            WHERE ct.customer_id = c.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM visits v
            WHERE v.customer_id = c.id
          )
        GROUP BY c.neighborhood::int
      `,
      [branchId, zoneIds, supervisorHrUserId],
    );

    const countsByZoneMap = new Map<number, number>();
    countsByZoneRows.forEach((row: any) => {
      countsByZoneMap.set(Number(row.zoneId), Number(row.count));
    });
    const countsByZone = zoneIds.map(zoneId => ({
      zoneId,
      count: countsByZoneMap.get(zoneId) ?? 0,
    }));

    const { rows: leads } = await pool.query(
      `
        SELECT
          c.id,
          c.first_name AS "firstName",
          c.father_name AS "fatherName",
          c.last_name AS "lastName",
          c.nickname,
          c.name,
          c.mobile,
          c.contacts,
          c.governorate,
          c.district,
          c.neighborhood,
          c.detailed_address AS "detailedAddress",
          c.gps_coordinates AS "gpsCoordinates",
          c.gender,
          c.national_id AS "nationalId",
          c.birth_date AS "birthDate",
          c.occupation,
          c.spouse_occupation AS "spouseOccupation",
          c.data_quality AS "dataQuality",
          c.water_source AS "waterSource",
          c.notes,
          c.rating,
          c.source_channel AS "sourceChannel",
          c.referrer_type AS "referrerType",
          c.referrer_id AS "referrerId",
          c.referrer_name AS "referrerName",
          c.referral_notes AS "referralNotes",
          c.referrers,
          c.referral_entity_id AS "referralEntityId",
          c.referral_date AS "referralDate",
          c.referral_reason AS "referralReason",
          c.referral_sheet_id AS "referralSheetId",
          c.referral_address_text AS "referralAddressText",
          c.created_at AS "createdAt",
          c.is_candidate AS "isCandidate",
          c.target_client AS "targetClient",
          c.candidate_status AS "candidateStatus",
          c.branch_id AS "branchId",
          b.name AS "branchName",
          COALESCE(
            (SELECT json_agg(json_build_object(
               'userId',          u2.id,
               'userName',        u2.name,
               'roleDisplayName', COALESCE(r2.display_name, u2.role)
             ) ORDER BY ca.assigned_at)
             FROM client_assignments ca
             JOIN hr_users u2  ON u2.id  = ca.hr_user_id
             LEFT JOIN roles r2 ON r2.id = u2.role_id
             WHERE ca.client_id = c.id),
            '[]'::json
          ) AS "assignments"
        FROM clients c
        LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.is_candidate = FALSE
          AND c.branch_id = $1
          AND NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
          AND c.neighborhood::int = ANY($2::int[])
          AND EXISTS (
            SELECT 1
            FROM client_assignments ca
            WHERE ca.client_id = c.id
              AND ca.hr_user_id = $3
          )
          AND NOT EXISTS (
            SELECT 1
            FROM contracts ct
            WHERE ct.customer_id = c.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM visits v
            WHERE v.customer_id = c.id
          )
        ORDER BY c.id
      `,
      [branchId, zoneIds, supervisorHrUserId],
    );

    return res.json({
      teamKey,
      leads,
      candidates: [],
      countsByZone,
      counts: {
        leads: leads.length,
        candidates: 0,
        total: leads.length,
      },
      zoneIds,
      targetStationsCount: zoneIds.length,
      hasSupervisor: true,
      supervisorEmployeeId,
      supervisorHrUserId,
      reason: null,
    });
  } catch (err: any) {
    console.error('Failed to calculate planning marketing targets:', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate marketing targets' });
  }
});

export default router;
