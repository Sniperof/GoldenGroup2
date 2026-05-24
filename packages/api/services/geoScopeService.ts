import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';
import { authorize } from './authorizationService.js';

export interface GeoUnitRow {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
}

export interface GeoScope {
  branchId: number | null;
  coveredGeoIds: number[];
  visibleGeoIds: Set<number>;
  serviceGeoIds: Set<number>;
}

type Queryable = {
  query: typeof pool.query;
};

export async function listAllGeoUnits(client: Queryable = pool): Promise<GeoUnitRow[]> {
  const { rows } = await client.query(
    'SELECT id, name, level, parent_id AS "parentId" FROM geo_units ORDER BY level, id',
  );

  return rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    level: Number(row.level),
    parentId: row.parentId == null ? null : Number(row.parentId),
  }));
}

export async function resolveGeoScope(
  authContext: AuthContext,
  permission: 'geo.view' | 'geo.manage',
  allUnits?: GeoUnitRow[],
): Promise<GeoScope | null> {
  if (authContext.isSuperAdmin && authContext.actingBranchId == null) {
    return null;
  }

  const check = authorize(authContext, { permission });
  if (!check.allowed || check.grant?.scope === 'GLOBAL' || check.reason === 'SUPER_ADMIN') {
    return null;
  }

  const branchId = authContext.actingBranchId;
  if (branchId == null) {
    return {
      branchId: null,
      coveredGeoIds: [],
      visibleGeoIds: new Set<number>(),
      serviceGeoIds: new Set<number>(),
    };
  }

  const units = allUnits ?? await listAllGeoUnits();
  const coveredGeoIds = await loadBranchCoveredGeoIds(branchId);
  const effectiveCoveredIds = coveredGeoIds.filter(id => units.some(unit => unit.id === id));
  const serviceGeoIds = buildServiceGeoIds(effectiveCoveredIds, units);
  const visibleGeoIds = buildVisibleGeoIds(effectiveCoveredIds, units);

  return {
    branchId,
    coveredGeoIds: effectiveCoveredIds,
    serviceGeoIds,
    visibleGeoIds,
  };
}

export function filterGeoUnitsByScope(units: GeoUnitRow[], scope: GeoScope | null): GeoUnitRow[] {
  if (!scope) return units;
  return units.filter(unit => scope.visibleGeoIds.has(unit.id));
}

export function areRoutePointsInsideScope(
  points: Array<{ geoUnitId: number | string | null | undefined }>,
  scope: GeoScope | null,
): boolean {
  if (!scope) return true;
  if (points.length === 0) return false;
  if (scope.serviceGeoIds.size === 0) return false;
  return points.every(point => {
    const geoUnitId = Number(point.geoUnitId);
    return Number.isInteger(geoUnitId) && scope.serviceGeoIds.has(geoUnitId);
  });
}

async function loadBranchCoveredGeoIds(branchId: number): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT b.location_geo_id AS "locationGeoId",
            COALESCE(
              ARRAY_AGG(bgc.geo_unit_id) FILTER (WHERE bgc.geo_unit_id IS NOT NULL),
              ARRAY[]::int[]
            ) AS "coveredGeoIds"
       FROM branches b
       LEFT JOIN branch_geo_coverage bgc ON bgc.branch_id = b.id
      WHERE b.id = $1
        AND b.status = 'active'
      GROUP BY b.id, b.location_geo_id`,
    [branchId],
  );

  const row = rows[0];
  if (!row) return [];

  const covered = normalizeIdArray(row.coveredGeoIds);
  if (covered.length > 0) return covered;

  const locationGeoId = toPositiveInteger(row.locationGeoId);
  return locationGeoId == null ? [] : [locationGeoId];
}

function buildVisibleGeoIds(coveredIds: number[], units: GeoUnitRow[]): Set<number> {
  const visible = buildServiceGeoIds(coveredIds, units);
  const byId = new Map(units.map(unit => [unit.id, unit]));

  for (const coveredId of coveredIds) {
    let current = byId.get(coveredId);
    while (current?.parentId != null) {
      visible.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  return visible;
}

function buildServiceGeoIds(coveredIds: number[], units: GeoUnitRow[]): Set<number> {
  const childrenByParent = new Map<number | null, GeoUnitRow[]>();
  for (const unit of units) {
    const siblings = childrenByParent.get(unit.parentId) ?? [];
    siblings.push(unit);
    childrenByParent.set(unit.parentId, siblings);
  }

  const service = new Set<number>();
  const addDescendants = (unitId: number) => {
    service.add(unitId);
    for (const child of childrenByParent.get(unitId) ?? []) {
      addDescendants(child.id);
    }
  };

  for (const coveredId of coveredIds) {
    addDescendants(coveredId);
  }

  return service;
}

function normalizeIdArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<number>();
  for (const item of value) {
    const id = toPositiveInteger(item);
    if (id != null) unique.add(id);
  }
  return [...unique];
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(numeric) && (numeric as number) > 0 ? (numeric as number) : null;
}
