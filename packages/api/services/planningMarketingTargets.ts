import pool from '../db.js';
import { resolveTeamPlanningScope } from './teamPlanningScope.js';
import type { CustomerOwnership } from '@golden-crm/shared';
import {
  buildClientLifecycleStatusSql,
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from './customerOwnership.js';

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
  ownership: CustomerOwnership;
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
  companyHrUserIds?: number[];
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

function normalizeNumberList(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(parsePositiveInteger)
    .filter((value): value is number => value != null);
}

async function resolveMarketingActorHrUserIds(params: {
  branchId: number;
  telemarketerEmployeeIds: unknown;
  supervisorHrUserId: number | null;
  technicianHrUserId?: number | null;
}): Promise<number[]> {
  const selectedTelemarketerEmployeeIds = normalizeNumberList(params.telemarketerEmployeeIds);

  const query = selectedTelemarketerEmployeeIds.length > 0
    ? `
        SELECT u.id
          FROM hr_users u
          JOIN employees e ON e.id = u.employee_id
         WHERE u.employee_id = ANY($1::int[])
           AND u.is_active = TRUE
           AND e.status = 'active'
           AND e.role = 'telemarketer'
      `
    : `
        SELECT u.id
          FROM hr_users u
          JOIN employees e ON e.id = u.employee_id
         WHERE u.branch_id = $1
           AND u.employee_id IS NOT NULL
           AND u.is_active = TRUE
           AND e.status = 'active'
           AND e.role = 'telemarketer'
      `;

  const { rows } = await pool.query<{ id: number }>(query, selectedTelemarketerEmployeeIds.length > 0
    ? [selectedTelemarketerEmployeeIds]
    : [params.branchId]);

  const actorIds = [
    params.supervisorHrUserId,
    params.technicianHrUserId ?? null,   // technician owns clients too
    ...rows.map(row => Number(row.id)),
  ].filter((id): id is number => Number.isInteger(id) && id > 0);

  return actorIds.filter((id, index) => actorIds.indexOf(id) === index);
}

function buildEmptyResponse(params: {
  teamKey: string;
  reason: string;
  supervisorEmployeeId?: number | null;
  supervisorHrUserId?: number | null;
  technicianEmployeeId?: number | null;
  technicianHrUserId?: number | null;
  companyHrUserIds?: number[];
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
    companyHrUserIds: params.companyHrUserIds ?? [],
    actorHrUserIds: params.actorHrUserIds ?? [],
    reason: params.reason,
  };
}

/**
 * SQL fragment that filters open_tasks by:
 *   - status IN ('open', 'needs_follow_up')  ← قيد الانتظار (RA-R001)
 *   - task type is active in task_type_config
 *   - within planning window N (derived per scheduling_pattern):
 *       immediate                       → always eligible
 *       short_window / long_window      → due_date IS NULL OR due_date <= today + N
 *       expected_window                 → expected_date IS NULL OR expected_date <= today + N
 *
 * Caller must JOIN open_tasks (aliased as otAlias) with task_type_config (aliased as ttcAlias).
 */
type PlanningTargetsMode = 'planning' | 'assigned';

function buildOpenTaskEligibilityPredicate(
  otAlias: string,
  ttcAlias: string,
  mode: PlanningTargetsMode,
): string {
  const statusClause = mode === 'assigned'
    ? `${otAlias}.status = 'assigned'`
    : `${otAlias}.status IN ('open', 'needs_follow_up')`;

  if (mode === 'assigned') {
    return `
      ${statusClause}
      AND ${ttcAlias}.is_active = TRUE
    `;
  }

  // DEC-006 D36: needs_follow_up tasks are driven by expected_date, not due_date,
  // and become eligible one day before the promised follow-up date. The configured
  // planning window applies only to fresh/open tasks.
  return `
    ${statusClause}
    AND ${ttcAlias}.is_active = TRUE
    AND (
      (${otAlias}.status = 'open' AND ${ttcAlias}.scheduling_pattern = 'immediate')
      OR (
        ${otAlias}.status = 'needs_follow_up'
        AND (
          ${otAlias}.expected_date IS NULL
          OR ${otAlias}.expected_date <= CURRENT_DATE + INTERVAL '1 day'
        )
      )
      OR (
        ${otAlias}.status = 'open'
        AND
        ${ttcAlias}.window_basis = 'due_date'
        AND (
          ${otAlias}.due_date IS NULL
          OR ${otAlias}.due_date <= CURRENT_DATE + (${ttcAlias}.planning_window_days::text || ' days')::INTERVAL
        )
      )
      OR (
        ${otAlias}.status = 'open'
        AND
        ${ttcAlias}.window_basis = 'expected_date'
        AND (
          ${otAlias}.expected_date IS NULL
          OR ${otAlias}.expected_date <= CURRENT_DATE + (${ttcAlias}.planning_window_days::text || ' days')::INTERVAL
        )
      )
    )
  `;
}

function buildTeamOwnedClientScopePredicate(clientAlias: string, assignmentAlias = 'ca'): string {
  return `
    (
      EXISTS (
        SELECT 1
        FROM client_assignments ${assignmentAlias}
        WHERE ${assignmentAlias}.client_id = ${clientAlias}.id
          AND ${assignmentAlias}.hr_user_id = ANY($3::int[])
      )
      OR NOT EXISTS (
        SELECT 1
        FROM client_assignments ${assignmentAlias}
        JOIN hr_users hu ON hu.id = ${assignmentAlias}.hr_user_id
        WHERE ${assignmentAlias}.client_id = ${clientAlias}.id
          AND hu.employee_id IS NOT NULL
      )
    )
  `;
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
  return Array.from(zoneIds);
}

export async function getPlanningMarketingTargets(params: {
  date: string;
  teamKey: string;
  branchId: number;
  mode?: PlanningTargetsMode;
}): Promise<PlanningMarketingTargetsResponse> {
  const { date, teamKey, branchId, mode = 'planning' } = params;
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

  const scope = await resolveTeamPlanningScope({
    supervisor: team.supervisor,
    technician: team.technician,
    branchId,
  });

  const {
    supervisorEmployeeId,
    supervisorHrUserId,
    technicianEmployeeId,
    technicianHrUserId,
    companyHrUserIds,
  } = scope;

  const actorHrUserIds = await resolveMarketingActorHrUserIds({
    branchId,
    telemarketerEmployeeIds: team.telemarketers,
    supervisorHrUserId,
    technicianHrUserId,   // include technician: clients personally assigned to the technician are visible
  });
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
      companyHrUserIds,
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
      technicianEmployeeId,
      technicianHrUserId,
      companyHrUserIds,
      actorHrUserIds,
      zoneIds,
    });
  }

  // ── Load calculation per zone ─────────────────────────────────────────────
  // Effective zone depends on location_basis (§PL-R008 / §PC-G001 resolution):
  //   'client'            → clients.neighborhood
  //   'device'/'contract' → open_tasks.device_id → installed_devices.installation_geo_unit_id
  //
  // Task eligibility includes BOTH:
  //   1. Waiting tasks (open/needs_follow_up) that pass the N-window check
  //   2. Already-assigned tasks for THIS team/date (post-sync idempotency fix)
  //   This prevents the zone count from dropping to 0 after syncAssignedTasks runs.
  const { rows: countsByZoneRows } = await pool.query(
    `
      SELECT
        effective_zone AS "zoneId",
        COUNT(*)::int  AS count
      FROM (
        SELECT DISTINCT ON (c.id)
          CASE
            WHEN ttc_eff.location_basis IN ('contract', 'device')
              THEN ct_loc.installation_geo_unit_id
            -- clients.neighborhood is already INTEGER; NULL means "no zone".
            ELSE c.neighborhood
          END AS effective_zone
        FROM clients c
        LEFT JOIN LATERAL (
          SELECT ot_inner.id, ot_inner.device_id, ttc_inner.location_basis
          FROM open_tasks ot_inner
          INNER JOIN task_type_config ttc_inner ON ttc_inner.task_type = ot_inner.task_type
          WHERE ot_inner.client_id = c.id
            AND (
              -- Branch 1: unsynced — still in waiting phase
              (
                ${buildOpenTaskEligibilityPredicate('ot_inner', 'ttc_inner', 'planning')}
                AND (ot_inner.excluded_for_date IS NULL OR ot_inner.excluded_for_date <> $4::date)
              )
              -- Branch 2: already synced to this team (any sync date) — still unprocessed
              OR (
                ot_inner.status = 'assigned'
                AND ot_inner.assigned_team_key = $5
                AND ttc_inner.is_active = TRUE
                AND (ot_inner.excluded_for_date IS NULL OR ot_inner.excluded_for_date <> $4::date)
              )
            )
          ORDER BY ot_inner.created_at DESC
          LIMIT 1
        ) ttc_eff ON TRUE
        -- DEC-005 D27: device-basis tasks resolve through the task's own
        -- installed_device. Do not fall back to "latest device for customer";
        -- a customer may own multiple devices in different locations.
        LEFT JOIN LATERAL (
          SELECT inst.installation_geo_unit_id
          FROM installed_devices inst
          WHERE inst.id = ttc_eff.device_id
            AND inst.installation_geo_unit_id IS NOT NULL
          LIMIT 1
        ) ct_loc ON ttc_eff.location_basis IN ('contract', 'device')
        LEFT JOIN LATERAL (
          -- Phase 4 refactor (Q-C): read from field_visits + visit_tasks instead of
          -- the legacy marketing_visits + marketing_visit_tasks pair. The bridge
          -- migration 148 backfilled visit_tasks.source_open_task_id from the
          -- legacy rows so historical unfinished detection is preserved.
          SELECT 1 AS has_unfinished_visit
          FROM visit_tasks vt
          JOIN field_visits fv ON fv.id = vt.field_visit_id
          WHERE vt.source_open_task_id = ttc_eff.id
            AND fv.status IN ('scheduled', 'in_progress', 'ended', 'not_completed')
            AND fv.scheduled_date < $4::date
          LIMIT 1
        ) unfinished_visit ON TRUE
        WHERE c.is_candidate = FALSE
          -- DEC-005 D-customer-filters: cooldown + do_not_contact (D29)
          AND c.do_not_contact = FALSE
          AND (c.cooldown_until IS NULL OR c.cooldown_until < CURRENT_DATE)
          AND c.branch_id = $1
          AND ${buildTeamOwnedClientScopePredicate('c')}
          AND ttc_eff.id IS NOT NULL
          AND unfinished_visit.has_unfinished_visit IS NULL
          AND (
            -- DEC-005 §4: NOT EXISTS visits (legacy) removed; OR-branch kept so the
            -- assigned-task scope still resolves the customer in the planning sub-query.
            TRUE
            OR EXISTS (
              SELECT 1
              FROM open_tasks ot_scope
              INNER JOIN task_type_config ttc_scope ON ttc_scope.task_type = ot_scope.task_type
              WHERE ot_scope.client_id = c.id
                AND (
                  (${buildOpenTaskEligibilityPredicate('ot_scope', 'ttc_scope', 'planning')}
                   AND (ot_scope.excluded_for_date IS NULL OR ot_scope.excluded_for_date <> $4::date))
                  OR (ot_scope.status = 'assigned' AND ot_scope.assigned_team_key = $5
                      AND ttc_scope.is_active = TRUE
                      AND (ot_scope.excluded_for_date IS NULL OR ot_scope.excluded_for_date <> $4::date))
                )
            )
          )
      ) sub
      WHERE effective_zone = ANY($2::int[])
      GROUP BY effective_zone
    `,
    [branchId, zoneIds, actorHrUserIds, date, teamKey],
  );

  const countsByZoneMap = new Map<number, number>();
  countsByZoneRows.forEach((row: any) => {
    countsByZoneMap.set(Number(row.zoneId), Number(row.count));
  });
  const countsByZone = zoneIds.map(zoneId => ({
    zoneId,
    count: countsByZoneMap.get(zoneId) ?? 0,
  }));

  const { rows: leadRows } = await pool.query(
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
        CASE
          WHEN ot.location_basis IN ('contract', 'device') THEN ct_zone.installation_geo_unit_id
          ELSE c.neighborhood
        END AS "effectiveZoneId",
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
        ${buildClientLifecycleStatusSql('c')} AS "candidateStatus",
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
        ot.notes AS "openTaskNotes",
        ${buildCustomerOwnershipSelectColumns()}
      FROM clients c
      LEFT JOIN branches b ON b.id = c.branch_id
      ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'b.name' })}
      LEFT JOIN contact_targets contact_target
        ON contact_target.branch_id = c.branch_id
       AND contact_target.target_type = 'client'
       AND contact_target.target_id = c.id
       -- DEC-005 D30: target_stage / source_type dropped (or pinned to 'lead'
       -- via CHECK). The JOIN no longer references them.
       AND contact_target.visit_type = 'marketing'
      -- Plan 2026-06-10 Phase 2.2 — switched from telemarketing_appointments
      -- to field_visits (origin_type='telemarketing'). Mirrors the same
      -- migration in routes/contactTargets.ts.
      LEFT JOIN LATERAL (
        SELECT json_build_object(
          'id', fv.id,
          'date', fv.scheduled_date,
          'timeSlot', fv.scheduled_time,
          'teamKey', fv.team_snapshot->>'teamKey'
        ) AS "latestAppointment"
        FROM field_visits fv
        WHERE fv.origin_type = 'telemarketing'
          AND fv.client_id = c.id
          AND fv.branch_id = c.branch_id
        ORDER BY fv.created_at DESC
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
        SELECT ot_inner.id, ot_inner.device_id, ot_inner.task_type, ot_inner.task_family, ot_inner.reason,
               ot_inner.status, ot_inner.due_date, ot_inner.priority, ot_inner.notes,
               ttc_inner.location_basis
        FROM open_tasks ot_inner
        INNER JOIN task_type_config ttc_inner ON ttc_inner.task_type = ot_inner.task_type
        WHERE ot_inner.client_id = c.id
          AND (
            -- Branch 1: unsynced — still in waiting phase
            (
              ${buildOpenTaskEligibilityPredicate('ot_inner', 'ttc_inner', 'planning')}
              AND (ot_inner.excluded_for_date IS NULL OR ot_inner.excluded_for_date <> $4::date)
            )
            -- Branch 2: already synced to this team (any sync date) — still unprocessed
            OR (
              ot_inner.status = 'assigned'
              AND ot_inner.assigned_team_key = $5
              AND ttc_inner.is_active = TRUE
              AND (ot_inner.excluded_for_date IS NULL OR ot_inner.excluded_for_date <> $4::date)
            )
          )
        ORDER BY ot_inner.created_at DESC
        LIMIT 1
      ) ot ON TRUE
      -- Resolve the installed-device's installation zone for device-basis tasks.
      LEFT JOIN LATERAL (
        SELECT inst.installation_geo_unit_id
        FROM installed_devices inst
        WHERE inst.id = ot.device_id
          AND inst.installation_geo_unit_id IS NOT NULL
        LIMIT 1
      ) ct_zone ON ot.location_basis IN ('contract', 'device')
      LEFT JOIN LATERAL (
        -- Phase 4 refactor (Q-C): read from field_visits + visit_tasks
        SELECT 1 AS has_unfinished_visit
        FROM visit_tasks mvt
        JOIN field_visits mv ON mv.id = mvt.field_visit_id
        WHERE mvt.source_open_task_id = ot.id
          AND mv.status IN ('scheduled', 'in_progress', 'ended', 'not_completed')
          AND mv.scheduled_date < $4::date
        LIMIT 1
      ) unfinished_visit ON TRUE
      WHERE c.is_candidate = FALSE
        -- DEC-005 D-customer-filters: cooldown + do_not_contact (D29)
        AND c.do_not_contact = FALSE
        AND (c.cooldown_until IS NULL OR c.cooldown_until < CURRENT_DATE)
        AND c.branch_id = $1
        AND ${buildTeamOwnedClientScopePredicate('c')}
        AND ot.id IS NOT NULL
        AND unfinished_visit.has_unfinished_visit IS NULL
        -- Zone filter: use the task's actual execution location.
        -- Device-basis tasks with missing device/location do not silently fall
        -- back to the client address.
        AND (
          (ot.location_basis IN ('contract', 'device') AND ct_zone.installation_geo_unit_id = ANY($2::int[]))
          OR
          (COALESCE(ot.location_basis, 'client') = 'client'
            AND c.neighborhood = ANY($2::int[]))
        )
        AND (
          -- DEC-005 §4: legacy NOT EXISTS visits filter removed
          TRUE
          OR EXISTS (
            SELECT 1
            FROM open_tasks ot_scope
            INNER JOIN task_type_config ttc_scope ON ttc_scope.task_type = ot_scope.task_type
            WHERE ot_scope.client_id = c.id
              AND (
                (${buildOpenTaskEligibilityPredicate('ot_scope', 'ttc_scope', 'planning')}
                 AND (ot_scope.excluded_for_date IS NULL OR ot_scope.excluded_for_date <> $4::date))
                OR (ot_scope.status = 'assigned' AND ot_scope.assigned_team_key = $5
                    AND ttc_scope.is_active = TRUE
                    AND (ot_scope.excluded_for_date IS NULL OR ot_scope.excluded_for_date <> $4::date))
              )
          )
        )
      ORDER BY c.id
    `,
    [branchId, zoneIds, actorHrUserIds, date, teamKey],
  );

  const leads = leadRows.map((row: any) => ({
    ...row,
    ownership: mapCustomerOwnership(row),
  }));

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
    hasSupervisor: supervisorEmployeeId != null,
    supervisorEmployeeId,
    supervisorHrUserId,
    technicianEmployeeId,
    technicianHrUserId,
    companyHrUserIds,
    actorHrUserIds,
    reason: null,
  };
}

export type WorkScopeTask = {
  openTaskId: number;
  clientId: number;
  clientName: string;
  clientMobile: string | null;
  clientNeighborhood: string | null;
  taskType: string;
  taskFamily: string;
  origin: string | null;
  status: string;
  dueDate: string | null;
  priority: string | null;
  notes: string | null;
  ownershipType: string;
  ownerLabel: string;
  assignedPersonName: string | null;
};

export type WorkScopeResponse = {
  scopeId: number | null;
  teamKey: string;
  date: string;
  branchId: number;
  zoneIds: number[];
  tasks: WorkScopeTask[];
  counts: { marketing: number; emergency: number; service: number; other: number; total: number };
  supervisorHrUserId: number | null;
  technicianHrUserId: number | null;
  actorHrUserIds: number[];
};

export async function getPlanningWorkScope(params: {
  date: string;
  teamKey: string;
  branchId: number;
}): Promise<WorkScopeResponse> {
  const { date, teamKey, branchId } = params;

  const keyMatch = teamKey.match(/^(team|solo)_(\d+)$/);
  if (!keyMatch) throw new Error('teamKey must be team_X or solo_X');

  const teamIndex = Number(keyMatch[2]);
  const { rows: scheduleRows } = await pool.query(
    'SELECT teams, solos FROM day_schedules WHERE date = $1',
    [date],
  );

  const scheduleData = scheduleRows[0];
  const teams = scheduleData?.teams ?? [];
  const solos = scheduleData?.solos ?? [];
  const teamEntry = keyMatch[1] === 'team' ? teams[teamIndex] : solos[teamIndex];

  const empty: WorkScopeResponse = {
    scopeId: null,
    teamKey,
    date,
    branchId,
    zoneIds: [],
    tasks: [],
    counts: { marketing: 0, emergency: 0, service: 0, other: 0, total: 0 },
    supervisorHrUserId: null,
    technicianHrUserId: null,
    actorHrUserIds: [],
  };

  if (!teamEntry) return empty;

  const scope = await resolveTeamPlanningScope({
    supervisor: teamEntry.supervisor,
    technician: teamEntry.technician,
    branchId,
  });

  const { actorHrUserIds, supervisorHrUserId, technicianHrUserId } = scope;

  // Get zone IDs from route assignment
  const assignmentKey = `${date}_${teamKey}`;
  const { rows: assignmentRows } = await pool.query(
    'SELECT routes, extra_zones AS "extraZones" FROM route_assignments WHERE key = $1',
    [assignmentKey],
  );

  let zoneIds: number[] = [];
  if (assignmentRows[0]) {
    zoneIds = await buildZoneIds(
      normalizeRoutes(assignmentRows[0].routes),
      normalizeExtraZones(assignmentRows[0].extraZones),
    );
  }

  // Look up the work_scope record if it exists
  const { rows: scopeRows } = await pool.query(
    'SELECT id FROM work_scopes WHERE date = $1 AND team_key = $2 AND branch_id = $3',
    [date, teamKey, branchId],
  );
  const scopeId: number | null = scopeRows[0]?.id ?? null;

  // Build task scope bottom-up from the task's actual execution location:
  //   1) client-basis task  -> clients.neighborhood
  //   2) device-basis task  -> open_tasks.device_id -> installed_devices.installation_geo_unit_id
  // Ownership is a separate eligibility condition; it must not replace the
  // task-location check.
  // DEC-006 D31: solo teams (EmergencySlot) only carry emergency_maintenance.
  const isSoloTeam = keyMatch[1] === 'solo';
  const queryParams: any[] = [branchId, zoneIds, actorHrUserIds, date, isSoloTeam, teamKey];

  const { rows: taskRows } = await pool.query(
    `SELECT
       ot.id               AS "openTaskId",
       ot.client_id        AS "clientId",
       ot.task_type        AS "taskType",
       ot.task_family      AS "taskFamily",
       ot.origin           AS "origin",
       ot.status,
       ot.due_date         AS "dueDate",
       ot.priority,
       ot.notes,
       CASE
         WHEN ttc.location_basis IN ('contract', 'device') THEN inst.installation_geo_unit_id
         ELSE c.neighborhood
       END                 AS "effectiveZoneId",
       c.name              AS "clientName",
       c.mobile            AS "clientMobile",
       c.neighborhood      AS "clientNeighborhood",
       ${buildClientLifecycleStatusSql('c')} AS "candidateStatus",
       b.name              AS "branchName",
       CASE
         WHEN (${buildClientLifecycleStatusSql('c')}) IN ('OP', 'FOP') THEN 'company_branch'
         WHEN NOT EXISTS (
           SELECT 1 FROM client_assignments ca2
           JOIN hr_users u2 ON u2.id = ca2.hr_user_id
           WHERE ca2.client_id = c.id AND u2.employee_id IS NOT NULL AND u2.is_active = TRUE
         ) THEN 'company_branch'
         ELSE 'personal'
       END AS "ownershipType",
       COALESCE(
         CASE
           WHEN (${buildClientLifecycleStatusSql('c')}) IN ('OP', 'FOP') THEN b.name
           WHEN NOT EXISTS (
             SELECT 1 FROM client_assignments ca3
             JOIN hr_users u3 ON u3.id = ca3.hr_user_id
             WHERE ca3.client_id = c.id AND u3.employee_id IS NOT NULL AND u3.is_active = TRUE
           ) THEN b.name
           ELSE (
             SELECT string_agg(u4.name, ' + ' ORDER BY ca4.assigned_at)
             FROM client_assignments ca4
             JOIN hr_users u4 ON u4.id = ca4.hr_user_id
             WHERE ca4.client_id = c.id AND u4.employee_id IS NOT NULL AND u4.is_active = TRUE
           )
         END,
         b.name
       ) AS "ownerLabel"
     FROM open_tasks ot
     JOIN clients c ON c.id = ot.client_id
     JOIN task_type_config ttc ON ttc.task_type = ot.task_type
     LEFT JOIN installed_devices inst
       ON inst.id = ot.device_id
      AND ttc.location_basis IN ('contract', 'device')
     LEFT JOIN branches b ON b.id = c.branch_id
     WHERE ot.branch_id = $1
      AND (
        ${buildOpenTaskEligibilityPredicate('ot', 'ttc', 'planning')}
        OR (ot.status = 'assigned' AND ot.assigned_team_key = $6)
        OR (
          ot.status IN ('in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended')
          AND ot.assigned_team_key = $6
        )
      )
      AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $4::date)
      AND (c.is_active IS NULL OR c.is_active = TRUE)
       AND c.deleted_at IS NULL
       -- DEC-006 D31: EmergencySlot capability is exclusively emergency_maintenance
       AND ($5::boolean = FALSE OR ot.task_type = 'emergency_maintenance')
       AND (
         (ttc.location_basis IN ('contract', 'device') AND inst.installation_geo_unit_id = ANY($2::int[]))
         OR
         (COALESCE(ttc.location_basis, 'client') = 'client' AND c.neighborhood = ANY($2::int[]))
       )
       AND (
         (${buildClientLifecycleStatusSql('c')}) IN ('OP', 'FOP')
         OR NOT EXISTS (
           SELECT 1
           FROM client_assignments ca5
           JOIN hr_users u5 ON u5.id = ca5.hr_user_id
           WHERE ca5.client_id = c.id
             AND u5.employee_id IS NOT NULL
             AND u5.is_active = TRUE
         )
         OR (cardinality($3::int[]) > 0 AND EXISTS (
           SELECT 1 FROM client_assignments ca
           WHERE ca.client_id = ot.client_id
             AND ca.hr_user_id = ANY($3::int[])
         ))
       )
     ORDER BY ot.created_at DESC`,
    queryParams,
  );

  const companyOwnedSet = new Set(
    taskRows
      .filter((r: any) => r.ownershipType === 'company_branch')
      .map((r: any) => Number(r.clientId)),
  );

  const tasks: WorkScopeTask[] = taskRows.map((r: any) => ({
    openTaskId: r.openTaskId,
    clientId: r.clientId,
    clientName: r.clientName,
    clientMobile: r.clientMobile,
    clientNeighborhood: r.clientNeighborhood,
    taskType: r.taskType,
    taskFamily: r.taskFamily,
    origin: r.origin,
    status: r.status,
    dueDate: r.dueDate,
    priority: r.priority,
    notes: r.notes,
    ownershipType: companyOwnedSet.has(r.clientId) ? 'company_branch' : 'personal',
    ownerLabel: companyOwnedSet.has(r.clientId)
      ? (r.branchName ? `فرع ${r.branchName}` : 'الشركة')
      : r.ownerLabel,
    assignedPersonName: companyOwnedSet.has(r.clientId) ? null : r.ownerLabel,
  }));

  const counts = tasks.reduce(
    (acc, t) => {
      if (t.taskFamily === 'marketing') acc.marketing++;
      else if (t.taskFamily === 'emergency') acc.emergency++;
      else if (t.taskFamily === 'service') acc.service++;
      else acc.other++;
      acc.total++;
      return acc;
    },
    { marketing: 0, emergency: 0, service: 0, other: 0, total: 0 },
  );

  return {
    scopeId,
    teamKey,
    date,
    branchId,
    zoneIds,
    tasks,
    counts,
    supervisorHrUserId,
    technicianHrUserId,
    actorHrUserIds,
  };
}

/**
 * Returns assigned leads for generate-from-plan by querying open_tasks directly
 * via assigned_team_key + assigned_for_date.
 *
 * WHY this exists: getPlanningMarketingTargets filters clients by zone_ids from
 * route_assignments. A task can be assigned to a team whose route does not cover
 * the client's neighbourhood (e.g. the manager narrowed the route slice after
 * the sync). Querying by assignment metadata rather than re-deriving the zone
 * list ensures every assigned task is included in the generated contact list.
 */
export async function getAssignedLeadsForTeam(params: {
  date: string;
  teamKey: string;
  branchId: number;
}): Promise<{ leads: PlanningLead[]; supervisorHrUserId: number | null; reason: string | null }> {
  const { date, teamKey, branchId } = params;

  // Resolve supervisor for contact-target creation (same as in getPlanningMarketingTargets)
  const keyMatch = teamKey.match(/^(team|solo)_(\d+)$/);
  if (!keyMatch || keyMatch[1] === 'solo') {
    return { leads: [], supervisorHrUserId: null, reason: 'SOLO_HAS_NO_MARKETING_LOAD' };
  }

  const teamIndex = Number(keyMatch[2]);
  const { rows: scheduleRows } = await pool.query(
    'SELECT teams FROM day_schedules WHERE date = $1',
    [date],
  );
  const teams = scheduleRows[0]?.teams;
  const team = Array.isArray(teams) ? teams[teamIndex] : null;

  let supervisorHrUserId: number | null = null;
  if (team) {
    const scope = await resolveTeamPlanningScope({
      supervisor: team.supervisor,
      technician: team.technician,
      branchId,
    });
    supervisorHrUserId = scope.supervisorHrUserId;
  }

  // Direct query: all assigned tasks for this team + date, joined with client data
  const { rows: leadRows } = await pool.query(
    `
      SELECT
        c.id,
        c.first_name       AS "firstName",
        c.father_name      AS "fatherName",
        c.last_name        AS "lastName",
        c.nickname,
        c.name,
        c.mobile,
        c.contacts,
        c.neighborhood,
        CASE
          WHEN ttc.location_basis IN ('contract', 'device') THEN inst.installation_geo_unit_id
          ELSE c.neighborhood
        END AS "effectiveZoneId",
        c.detailed_address AS "detailedAddress",
        c.referral_address_text AS "referralAddressText",
        c.branch_id        AS "branchId",
        c.is_candidate     AS "isCandidate",
        c.target_client    AS "targetClient",
        ${buildClientLifecycleStatusSql('c')} AS "candidateStatus",
        ct.id              AS "contactTargetId",
        ct.status          AS "contactTargetStatus",
        ct.latest_call_outcome AS "latestCallOutcome",
        ot.id              AS "openTaskId",
        ot.task_type       AS "openTaskType",
        ot.task_family     AS "openTaskFamily",
        ot.reason          AS "openTaskReason",
        ot.status          AS "openTaskStatus",
        ot.due_date        AS "openTaskDueDate",
        ot.priority        AS "openTaskPriority",
        ot.notes           AS "openTaskNotes",
        COALESCE(ttc.contact_target_visit_type, 'marketing') AS "contactTargetVisitType",
        ${buildCustomerOwnershipSelectColumns()}
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      JOIN task_type_config ttc ON ttc.task_type = ot.task_type
      LEFT JOIN installed_devices inst
        ON inst.id = ot.device_id
       AND ttc.location_basis IN ('contract', 'device')
      ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'NULL' })}
      LEFT JOIN contact_targets ct
        ON ct.branch_id    = c.branch_id
       AND ct.target_type  = 'client'
       AND ct.target_id    = c.id
       AND ct.date         = $2::date
       AND ct.team_key     = $1
       AND ct.work_location_geo_unit_id IS NOT DISTINCT FROM (
         CASE
           WHEN ttc.location_basis IN ('contract', 'device') THEN inst.installation_geo_unit_id
           ELSE c.neighborhood
         END
       )
      WHERE ot.status            = 'assigned'
        AND ot.assigned_team_key = $1
        AND ot.assigned_for_date = $2
        AND ot.branch_id         = $3
      ORDER BY c.id
    `,
    [teamKey, date, branchId],
  );

  const leads = leadRows.map((row: any) => ({
    ...row,
    gpsCoordinates: null,
    gender: null,
    nationalId: null,
    birthDate: null,
    occupation: null,
    spouseOccupation: null,
    dataQuality: null,
    waterSource: null,
    notes: null,
    rating: null,
    sourceChannel: null,
    referrerType: null,
    referrerId: null,
    referrerName: null,
    referralNotes: null,
    referrers: null,
    referralEntityId: null,
    referralDate: null,
    referralReason: null,
    referralSheetId: null,
    createdAt: null,
    governorate: null,
    district: null,
    latestAppointment: null,
    dailyTaskListItemId: null,
    dailyTaskListId: null,
    dailyItemStatus: null,
    dailyCallOutcome: null,
    queuedInCurrentTeamToday: false,
    queuedInAnotherTeamToday: null,
    queuedTeamKeyToday: null,
    assignments: [],
    ownership: mapCustomerOwnership(row),
  }));

  return { leads, supervisorHrUserId, reason: null };
}
