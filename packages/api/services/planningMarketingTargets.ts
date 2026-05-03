import pool from '../db.js';
import { resolveTeamPlanningScope } from './teamPlanningScope.js';

type RouteCompositionInput = {
  routeId: number;
  startIdx: number;
  endIdx: number;
  direction: 'forward' | 'reverse';
};

export interface PlanningLead {
  id: number;
  firstName: string;
  fatherName: string | null;
  lastName: string | null;
  nickname: string | null;
  name: string;
  mobile: string | null;
  contacts: any;
  governorate: string | null;
  district: string | null;
  neighborhood: string | null;
  detailedAddress: string | null;
  gpsCoordinates: any;
  gender: string | null;
  nationalId: string | null;
  birthDate: string | null;
  occupation: string | null;
  spouseOccupation: string | null;
  dataQuality: string | null;
  waterSource: string | null;
  notes: string | null;
  rating: string | null;
  sourceChannel: string | null;
  referrerType: string | null;
  referrerId: number | null;
  referrerName: string | null;
  referralNotes: string | null;
  referrers: any;
  referralEntityId: number | null;
  referralDate: string | null;
  referralReason: string | null;
  referralSheetId: number | null;
  referralAddressText: string | null;
  createdAt: string;
  isCandidate: boolean;
  targetClient: boolean | null;
  candidateStatus: string | null;
  branchId: number;
  branchName: string;
  contactTargetId: number | null;
  contactTargetStatus: string | null;
  latestCallOutcome: string | null;
  latestAppointment: any;
  dailyTaskListItemId: number | null;
  dailyTaskListId: number | null;
  dailyItemStatus: string | null;
  dailyCallOutcome: string | null;
  queuedInCurrentTeamToday: boolean;
  queuedInAnotherTeamToday: boolean | null;
  queuedTeamKeyToday: string | null;
  assignments: any;
  openTaskId: number | null;
  openTaskType: string | null;
  openTaskFamily: string | null;
  openTaskReason: string | null;
  openTaskStatus: string | null;
  openTaskDueDate: string | null;
  openTaskPriority: string | null;
  openTaskNotes: string | null;
}

export type PlanningMarketingTargetsResponse = {
  teamKey: string;
  leads: PlanningLead[];
  candidates: [];
  countsByZone: { zoneId: number; count: number }[];
  counts: {
    leads: number;
    candidates: number;
    total: number;
  };
  zoneIds: number[];
  targetStationsCount: number;
  hasSupervisor: boolean;
  supervisorEmployeeId: number | null;
  supervisorHrUserId: number | null;
  technicianEmployeeId?: number | null;
  technicianHrUserId?: number | null;
  actorHrUserIds?: number[];
  reason: string | null;
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
  technicianEmployeeId?: number | null;
  technicianHrUserId?: number | null;
  actorHrUserIds?: number[];
  zoneIds?: number[];
}): PlanningMarketingTargetsResponse {
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
    technicianEmployeeId: params.technicianEmployeeId ?? null,
    technicianHrUserId: params.technicianHrUserId ?? null,
    actorHrUserIds: params.actorHrUserIds ?? [],
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

export async function getPlanningMarketingTargets(params: {
  date: string;
  teamKey: string;
  branchId: number;
}): Promise<PlanningMarketingTargetsResponse> {
  const { date, teamKey, branchId } = params;
  const keyMatch = teamKey.match(/^(team|solo)_(\d+)$/);

  if (!keyMatch) {
    throw new Error('teamKey must be team_X or solo_X');
  }

  if (keyMatch[1] === 'solo') {
    return buildEmptyResponse({ teamKey, reason: 'SOLO_HAS_NO_MARKETING_LOAD' });
  }

  const teamIndex = Number(keyMatch[2]);
  const { rows: scheduleRows } = await pool.query(
    'SELECT teams FROM day_schedules WHERE date = $1',
    [date],
  );

  const teams = scheduleRows[0]?.teams;
  const team = Array.isArray(teams) ? teams[teamIndex] : null;
  if (!team) {
    return buildEmptyResponse({ teamKey, reason: 'TEAM_NOT_FOUND' });
  }

  const scope = await resolveTeamPlanningScope({ supervisor: team.supervisor, technician: team.technician });

  if (scope.actorHrUserIds.length === 0) {
    return buildEmptyResponse({
      teamKey,
      reason: scope.reason ?? 'TEAM_ACTORS_HAVE_NO_ACTIVE_HR_USER',
      supervisorEmployeeId: scope.supervisorEmployeeId,
      technicianEmployeeId: scope.technicianEmployeeId,
    });
  }

  const { supervisorEmployeeId, supervisorHrUserId, technicianEmployeeId, technicianHrUserId, actorHrUserIds } = scope;

  const assignmentKey = `${date}_${teamKey}`;
  const { rows: assignmentRows } = await pool.query(
    'SELECT routes, extra_zones AS "extraZones" FROM route_assignments WHERE key = $1',
    [assignmentKey],
  );

  if (!assignmentRows[0]) {
    return buildEmptyResponse({
      teamKey,
      reason: 'ROUTE_ASSIGNMENT_NOT_FOUND',
      supervisorEmployeeId,
      supervisorHrUserId,
      technicianEmployeeId,
      technicianHrUserId,
      actorHrUserIds,
    });
  }

  const routes = normalizeRoutes(assignmentRows[0].routes);
  const extraZones = normalizeExtraZones(assignmentRows[0].extraZones);
  const zoneIds = await buildZoneIds(routes, extraZones);

  if (zoneIds.length === 0) {
    return buildEmptyResponse({
      teamKey,
      reason: 'NO_TARGET_STATIONS',
      supervisorEmployeeId,
      supervisorHrUserId,
      zoneIds,
    });
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
            AND ca.hr_user_id = ANY($3::int[])
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
    [branchId, zoneIds, actorHrUserIds],
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
        contact_target.id AS "contactTargetId",
        contact_target.status AS "contactTargetStatus",
        contact_target.latest_call_outcome AS "latestCallOutcome",
        latest_appointment."latestAppointment",
        daily_item.id AS "dailyTaskListItemId",
        daily_tl.id AS "dailyTaskListId",
        daily_item.status AS "dailyItemStatus",
        daily_item.call_outcome AS "dailyCallOutcome",
        CASE WHEN daily_item.id IS NOT NULL THEN TRUE ELSE FALSE END AS "queuedInCurrentTeamToday",
        other_itemqueued AS "queuedInAnotherTeamToday",
        other_teamkeyqueued AS "queuedTeamKeyToday",
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
        ) AS "assignments",
        ot.id AS "openTaskId",
        ot.task_type AS "openTaskType",
        ot.task_family AS "openTaskFamily",
        ot.reason AS "openTaskReason",
        ot.status AS "openTaskStatus",
        ot.due_date AS "openTaskDueDate",
        ot.priority AS "openTaskPriority",
        ot.notes AS "openTaskNotes"
      FROM clients c
      LEFT JOIN branches b ON b.id = c.branch_id
      LEFT JOIN contact_targets contact_target
        ON contact_target.branch_id = c.branch_id
       AND contact_target.target_type = 'client'
       AND contact_target.target_id = c.id
       AND contact_target.target_stage = 'lead'
       AND contact_target.visit_type = 'marketing'
       AND contact_target.source_type = 'lead'
      LEFT JOIN LATERAL (
        SELECT json_build_object(
          'id', a.id,
          'date', a.date,
          'timeSlot', a.time_slot,
          'teamKey', a.team_key
        ) AS "latestAppointment"
        FROM telemarketing_appointments a
        WHERE a.entity_type = 'client'
          AND a.entity_id = c.id
          AND a.branch_id = c.branch_id
        ORDER BY a.created_at DESC
        LIMIT 1
      ) latest_appointment ON TRUE
      LEFT JOIN telemarketing_task_lists daily_tl
        ON daily_tl.branch_id = c.branch_id
       AND daily_tl.date = $4
       AND daily_tl.team_key = $5
      LEFT JOIN telemarketing_task_list_items daily_item
        ON daily_item.task_list_id = daily_tl.id
       AND daily_item.entity_type = 'client'
       AND daily_item.entity_id = c.id
      LEFT JOIN LATERAL (
        SELECT TRUE AS other_itemqueued, other_tl.team_key AS other_teamkeyqueued
        FROM telemarketing_task_list_items other_item
        JOIN telemarketing_task_lists other_tl ON other_tl.id = other_item.task_list_id
        WHERE other_tl.branch_id = c.branch_id
          AND other_tl.date = $4
          AND other_tl.team_key <> $5
          AND other_item.entity_type = 'client'
          AND other_item.entity_id = c.id
        LIMIT 1
      ) other_queued ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, task_type, task_family, reason, status, due_date, priority, notes
        FROM open_tasks
        WHERE open_tasks.client_id = c.id
          AND open_tasks.task_type = 'device_demo'
          AND open_tasks.status IN ('open', 'in_contact_list', 'scheduled', 'in_visit', 'needs_reschedule')
        ORDER BY open_tasks.created_at DESC
        LIMIT 1
      ) ot ON TRUE
      WHERE c.is_candidate = FALSE
        AND c.branch_id = $1
        AND NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
        AND c.neighborhood::int = ANY($2::int[])
        AND EXISTS (
          SELECT 1
          FROM client_assignments ca
          WHERE ca.client_id = c.id
            AND ca.hr_user_id = ANY($3::int[])
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
    [branchId, zoneIds, actorHrUserIds, date, teamKey],
  );

  return {
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
  };
}
