import type { AuthContext } from '@golden-crm/shared';
import {
  areRoutePointsInsideScope,
  resolveGeoScope,
  type GeoScope,
  type GeoUnitRow,
} from '../services/geoScopeService.js';

/**
 * Routes domain policy (engineering standard §4.1, §4.3, §6).
 *
 * Routes (خطوط السير) are a BRANCH-operational entity. Unlike most domains the
 * subject is NOT a `branch_id` column — the branch dimension is expressed
 * GEOGRAPHICALLY: a route's points must fall inside the actor's branch
 * coverage. So capability + subject authorization are:
 *
 *   - capability: `routes.view` / `routes.manage` (requirePermission in routes.ts)
 *   - subject:    the grant scope, translated by `resolveGeoScope` into either
 *                 GLOBAL (null scope → no geo limit) or the branch coverage set,
 *                 then enforced point-by-point via `areRoutePointsInsideScope`.
 *
 * This file centralizes the permission-key ↔ geo-scope mapping so route routes
 * never hardcode which geo permission backs which action. `geoScopeService` is
 * the shared geo-policy layer these helpers delegate to.
 */
export type RouteAction = 'view' | 'manage';

function routePermissionFor(action: RouteAction): 'routes.view' | 'routes.manage' {
  return action === 'manage' ? 'routes.manage' : 'routes.view';
}

/**
 * Resolve the geographic scope that bounds a route action for this actor.
 * Returns `null` for GLOBAL / super-admin (no geographic restriction).
 */
export function resolveRouteGeoScope(
  context: AuthContext,
  action: RouteAction,
  units?: GeoUnitRow[],
): Promise<GeoScope | null> {
  return resolveGeoScope(context, routePermissionFor(action), units);
}

/**
 * Subject check: every route point must be inside the resolved scope. A `null`
 * scope (GLOBAL) passes; an empty point list or empty coverage is rejected for
 * branch-scoped actors (see `areRoutePointsInsideScope`).
 */
export function areRoutePointsInScope(
  points: Array<{ geoUnitId: number | string | null | undefined }>,
  scope: GeoScope | null,
): boolean {
  return areRoutePointsInsideScope(points, scope);
}
