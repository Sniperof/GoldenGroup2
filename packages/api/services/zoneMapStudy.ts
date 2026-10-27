import pool from '../db.js';
import type {
  ZoneMapArea,
  ZoneMapColumnKey,
  ZoneMapOwner,
  ZoneMapRequestItem,
  ZoneMapResponse,
  ZoneMapRoute,
  ZoneMapTaskItem,
} from '@golden-crm/shared';
import { eligiblePersonalOwnerCondition } from './customerOwnership.js';
import { buildOpenTaskEligibilityPredicate } from './planningMarketingTargets.js';
import { listAllGeoUnits, resolveGeoScopeForBranch } from './geoScopeService.js';

// Zone map study — the planning day's picture BEFORE team scheduling.
// Read-only: returns the day's eligible tasks with their work location and,
// for device demos, their personal owners. The page aggregates on the client
// (visits per area / per route station) so filters stay instant.

export class ZoneMapValidationError extends Error {
  code = 'INVALID_INPUT' as const;
}

// Customer's study columns → task types. A type not listed falls into «other»
// so no open work disappears from the picture.
const TASK_TYPE_COLUMN: Record<string, ZoneMapColumnKey> = {
  emergency_maintenance: 'emergency',
  installment_collection: 'collection',
  maintenance_collection: 'collection',
  device_return: 'retrieved_return',
  gift_delivery: 'gift',
  golden_warranty: 'golden_warranty',
  golden_warranty_offer: 'golden_warranty',
  golden_warranty_card_delivery: 'golden_warranty',
  periodic_maintenance: 'periodic',
  device_demo: 'demo',
};

// Service requests not yet promoted to a task: upcoming work the branch already knows of.
const REQUEST_TYPE_COLUMN: Record<string, ZoneMapColumnKey> = {
  device_request: 'request_device',
  water_check: 'request_water_check',
  periodic_maintenance: 'request_periodic',
};
const PENDING_REQUEST_STATUSES = ['received', 'in_review'];

async function loadTasks(branchId: number, date: string): Promise<ZoneMapTaskItem[]> {
  const eligibility = buildOpenTaskEligibilityPredicate('ot', 'ttc', 'planning', '$2::date');
  const { rows } = await pool.query(
    `
      SELECT
        ot.id                AS "taskId",
        ot.task_type         AS "taskType",
        COALESCE(ttc.arabic_label, ot.task_type) AS "taskLabel",
        ot.status            AS "status",
        ot.due_date::text    AS "dueDate",
        ot.expected_date::text AS "expectedDate",
        c.id                 AS "clientId",
        c.name               AS "clientName",
        inst.id              AS "deviceId",
        COALESCE(NULLIF(inst.serial_number, ''), inst.device_model_name) AS "deviceLabel",
        ttc.location_basis   AS "locationBasis",
        CASE
          WHEN ttc.location_basis IN ('contract', 'device') THEN inst.installation_geo_unit_id
          ELSE COALESCE(c.neighborhood, c.district)
        END                  AS "geoUnitId",
        CASE WHEN ot.task_type = 'device_demo' THEN COALESCE((
          SELECT ARRAY_AGG(DISTINCT ca.hr_user_id ORDER BY ca.hr_user_id)
          FROM client_assignments ca
          JOIN hr_users u ON u.id = ca.hr_user_id
          LEFT JOIN roles r ON r.id = u.role_id
          LEFT JOIN employees e ON e.id = u.employee_id
          WHERE ca.client_id = c.id
            AND ${eligiblePersonalOwnerCondition('u', 'r', 'e')}
        ), ARRAY[]::int[]) ELSE ARRAY[]::int[] END AS "ownerHrUserIds"
      FROM open_tasks ot
      JOIN clients c ON c.id = ot.client_id
      JOIN task_type_config ttc ON ttc.task_type = ot.task_type
      LEFT JOIN installed_devices inst ON inst.id = ot.device_id
      WHERE ot.branch_id = $1
        AND (c.is_active IS NULL OR c.is_active = TRUE)
        AND c.deleted_at IS NULL
        AND c.do_not_contact = FALSE
        AND (c.cooldown_until IS NULL OR c.cooldown_until < $2::date)
        AND ( ${eligibility} )
        -- Day-wide planning exclusions (DEC-015 ALL_TEAMS_DAY + legacy excluded_for_date).
        -- Team-only exclusions don't apply: no teams exist yet at study time.
        AND NOT COALESCE(ot.excluded_for_date = $2::date, FALSE)
        AND NOT EXISTS (
          SELECT 1 FROM planning_task_exclusions pte
          WHERE pte.open_task_id = ot.id
            AND pte.branch_id = ot.branch_id
            AND pte.planning_date = $2::date
            AND pte.revoked_at IS NULL
            AND pte.exclusion_scope = 'all_teams'
        )
        -- Periodic maintenance of an out-of-service device is not field work.
        AND NOT (ot.task_type = 'periodic_maintenance' AND inst.status = 'out_of_service')
      ORDER BY ot.id
    `,
    [branchId, date],
  );

  return rows.map((r: any) => {
    const dueRef: string | null = r.status === 'needs_follow_up' ? r.expectedDate : (r.dueDate ?? r.expectedDate);
    return {
      taskId: Number(r.taskId),
      taskType: String(r.taskType),
      taskLabel: String(r.taskLabel),
      column: TASK_TYPE_COLUMN[r.taskType] ?? 'other',
      clientId: Number(r.clientId),
      clientName: r.clientName ?? `#${r.clientId}`,
      deviceId: r.deviceId == null ? null : Number(r.deviceId),
      deviceLabel: r.deviceLabel ?? null,
      countsBy: r.locationBasis === 'client' ? 'client' : 'device',
      geoUnitId: r.geoUnitId == null ? null : Number(r.geoUnitId),
      ownerHrUserIds: (r.ownerHrUserIds ?? []).map(Number),
      overdue: dueRef != null && dueRef < date,
    };
  });
}

async function loadRequests(branchId: number): Promise<ZoneMapRequestItem[]> {
  const { rows } = await pool.query(
    `
      SELECT sr.id AS "requestId", sr.request_type AS "requestType",
             sr.public_ref_number AS "refNumber",
             sr.branch_resolution_geo_unit_id AS "geoUnitId",
             c.id AS "clientId", c.name AS "clientName"
      FROM service_requests sr
      LEFT JOIN clients c ON c.id = COALESCE(sr.beneficiary_client_id, sr.requester_client_id)
      WHERE sr.branch_id = $1
        AND sr.request_type = ANY($2::text[])
        AND sr.status = ANY($3::text[])
      ORDER BY sr.id
    `,
    [branchId, Object.keys(REQUEST_TYPE_COLUMN), PENDING_REQUEST_STATUSES],
  );
  return rows.map((r: any) => ({
    requestId: Number(r.requestId),
    requestType: String(r.requestType),
    column: REQUEST_TYPE_COLUMN[r.requestType],
    refNumber: r.refNumber ?? null,
    clientId: r.clientId == null ? null : Number(r.clientId),
    clientName: r.clientName ?? null,
    geoUnitId: r.geoUnitId == null ? null : Number(r.geoUnitId),
  }));
}

async function loadOwners(hrUserIds: number[]): Promise<ZoneMapOwner[]> {
  if (hrUserIds.length === 0) return [];
  const { rows } = await pool.query(
    `
      SELECT u.id AS "hrUserId",
             COALESCE(e.name, u.name, u.username) AS name,
             r.name AS "roleName",
             r.team_slot_type AS "slotType"
      FROM hr_users u
      LEFT JOIN employees e ON e.id = u.employee_id
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ANY($1::int[])
      ORDER BY name
    `,
    [hrUserIds],
  );
  return rows.map((r: any) => ({
    hrUserId: Number(r.hrUserId),
    name: String(r.name),
    roleName: r.roleName ?? null,
    slotType: r.slotType ?? null,
  }));
}

async function loadCenters(ids: number[]): Promise<Map<number, { lat: number; lng: number }>> {
  const map = new Map<number, { lat: number; lng: number }>();
  if (ids.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT id, center_lat::float8 AS lat, center_lng::float8 AS lng
       FROM geo_units WHERE id = ANY($1::int[]) AND center_lat IS NOT NULL`,
    [ids],
  );
  rows.forEach((r: any) => map.set(Number(r.id), { lat: Number(r.lat), lng: Number(r.lng) }));
  return map;
}

// Branch routes = routes whose stations all fall inside the branch's service
// area (routes carry no branch_id — same rule as the routes page's scope check).
async function loadRoutes(serviceGeoIds: Set<number>): Promise<ZoneMapRoute[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, rp.geo_unit_id AS "geoUnitId", rp.point_order AS "order"
       FROM routes r
       JOIN route_points rp ON rp.route_id = r.id
      WHERE COALESCE(r.status, 'active') = 'active'
      ORDER BY r.id, rp.point_order`,
  );
  const byRoute = new Map<number, ZoneMapRoute>();
  rows.forEach((r: any) => {
    const id = Number(r.id);
    if (!byRoute.has(id)) byRoute.set(id, { id, name: String(r.name), stationGeoUnitIds: [] });
    byRoute.get(id)!.stationGeoUnitIds.push(Number(r.geoUnitId));
  });
  return [...byRoute.values()].filter(
    route => route.stationGeoUnitIds.length > 0 && route.stationGeoUnitIds.every(id => serviceGeoIds.has(id)),
  );
}

export async function getZoneMapStudy(opts: { branchId: number; date: string }): Promise<ZoneMapResponse> {
  const { branchId, date } = opts;
  const units = await listAllGeoUnits();
  const scope = await resolveGeoScopeForBranch(branchId, units);

  const [tasks, requests, routes] = await Promise.all([
    loadTasks(branchId, date),
    loadRequests(branchId),
    loadRoutes(scope.serviceGeoIds),
  ]);

  const ownerIds = new Set<number>();
  tasks.forEach(t => t.ownerHrUserIds.forEach(id => ownerIds.add(id)));
  const owners = await loadOwners([...ownerIds]);

  // Areas the page needs: the branch's service area, plus any unit a task,
  // request or route station points at, plus their ancestors (for roll-up).
  const byId = new Map(units.map(u => [u.id, u]));
  const needed = new Set<number>(scope.serviceGeoIds);
  tasks.forEach(t => { if (t.geoUnitId != null) needed.add(t.geoUnitId); });
  requests.forEach(r => { if (r.geoUnitId != null) needed.add(r.geoUnitId); });
  routes.forEach(r => r.stationGeoUnitIds.forEach(id => needed.add(id)));
  for (const id of [...needed]) {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent != null && !needed.has(parent)) {
      needed.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }
  const centers = await loadCenters([...needed]);
  const areas: ZoneMapArea[] = [...needed]
    .map(id => byId.get(id))
    .filter((u): u is NonNullable<typeof u> => u != null)
    .map(u => ({
      geoUnitId: u.id,
      name: u.name,
      level: u.level,
      parentId: u.parentId,
      inBranchCoverage: scope.serviceGeoIds.has(u.id),
      center: centers.get(u.id) ?? null,
    }));

  return {
    date,
    branchId,
    coveredGeoUnitIds: scope.coveredGeoIds,
    areas,
    routes,
    owners,
    tasks,
    requests,
  };
}

// The branch places an area's map center by clicking on the map. Only areas
// inside the acting branch's service area — the branch cannot move another
// branch's pins.
export async function setAreaCenter(opts: {
  branchId: number;
  geoUnitId: number;
  lat: number | null;
  lng: number | null;
  userId: number;
}): Promise<{ geoUnitId: number; center: { lat: number; lng: number } | null }> {
  const { branchId, geoUnitId, lat, lng, userId } = opts;
  if (!Number.isInteger(geoUnitId) || geoUnitId <= 0) throw new ZoneMapValidationError('geoUnitId غير صالح');
  const clearing = lat == null && lng == null;
  if (!clearing) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new ZoneMapValidationError('إحداثيات غير صالحة');
    }
  }
  const scope = await resolveGeoScopeForBranch(branchId);
  if (!scope.serviceGeoIds.has(geoUnitId)) {
    throw new ZoneMapValidationError('المنطقة خارج تغطية الفرع');
  }
  await pool.query(
    `UPDATE geo_units
        SET center_lat = $2, center_lng = $3,
            center_source = CASE WHEN $2::numeric IS NULL THEN NULL ELSE 'manual' END,
            center_updated_by = $4, center_updated_at = NOW()
      WHERE id = $1`,
    [geoUnitId, clearing ? null : lat, clearing ? null : lng, userId],
  );
  return { geoUnitId, center: clearing ? null : { lat: lat as number, lng: lng as number } };
}
