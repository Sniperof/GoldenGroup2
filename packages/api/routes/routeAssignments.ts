import { Router } from 'express';
import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { syncAssignedTasks } from '../services/assignedTasks.js';
import { resolveTeamZoneIds, resolveZoneIdsForAssignment } from '../services/planningMarketingTargets.js';
import {
  canManageAssignment,
  canViewAssignment,
  getAssignmentListAccessPlan,
  resolveAssignmentOwningBranch,
  resolveOwningBranchesForKeys,
} from '../policies/routeAssignmentPolicy.js';

const router = Router();
router.use(requireAuth);

function buildAssignmentResponse(row: any) {
  return { routes: row.routes, extraZones: row.extra_zones, stationOrder: row.station_order || [] };
}

function getAuthContext(req: any): AuthContext {
  if (!req.authContext) throw new Error('AuthContext is required');
  return req.authContext as AuthContext;
}

function getKeyParam(req: any): string {
  return Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
}


function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validateRouteAssignmentPayload(body: any): { ok: true; routes: any[]; extraZones: number[]; stationOrder: number[] } | { ok: false; error: string } {
  const routes = body?.routes ?? [];
  const extraZones = body?.extraZones ?? [];
  const stationOrder = body?.stationOrder ?? [];

  if (!Array.isArray(routes)) {
    return { ok: false, error: 'routes must be an array' };
  }

  if (!Array.isArray(extraZones)) {
    return { ok: false, error: 'extraZones must be an array' };
  }

  if (!Array.isArray(stationOrder)) {
    return { ok: false, error: 'stationOrder must be an array' };
  }

  const seenRouteIds = new Set<number>();
  for (let index = 0; index < routes.length; index += 1) {
    const comp = routes[index];
    if (!comp || typeof comp !== 'object' || Array.isArray(comp)) {
      return { ok: false, error: `Route composition ${index + 1} is invalid` };
    }

    if (!isPositiveInteger(comp.routeId)) {
      return { ok: false, error: `Route composition ${index + 1} must include a valid routeId` };
    }

    if (seenRouteIds.has(comp.routeId)) {
      return { ok: false, error: `Route ${comp.routeId} is duplicated in this work coverage` };
    }
    seenRouteIds.add(comp.routeId);

    if (!isNonNegativeInteger(comp.startIdx) || !isNonNegativeInteger(comp.endIdx)) {
      return { ok: false, error: `Route composition ${index + 1} must include valid startIdx and endIdx` };
    }

    if (comp.startIdx > comp.endIdx) {
      return { ok: false, error: `Route composition ${index + 1} has startIdx greater than endIdx` };
    }

    if (comp.direction !== 'forward' && comp.direction !== 'reverse') {
      return { ok: false, error: `Route composition ${index + 1} has invalid direction` };
    }
  }

  const seenExtraZones = new Set<number>();
  for (const zoneId of extraZones) {
    if (!isPositiveInteger(zoneId)) {
      return { ok: false, error: 'extraZones must contain valid geo unit ids' };
    }

    if (seenExtraZones.has(zoneId)) {
      return { ok: false, error: `Extra zone ${zoneId} is duplicated in this work coverage` };
    }
    seenExtraZones.add(zoneId);
  }

  const seenStationOrder = new Set<number>();
  for (const zoneId of stationOrder) {
    if (!isPositiveInteger(zoneId)) {
      return { ok: false, error: 'stationOrder must contain valid geo unit ids' };
    }

    if (seenStationOrder.has(zoneId)) {
      return { ok: false, error: `Station ${zoneId} is duplicated in the ordering` };
    }
    seenStationOrder.add(zoneId);
  }

  return { ok: true, routes, extraZones, stationOrder };
}

/**
 * @swagger
 * components:
 *   schemas:
 *     RouteAssignment:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *         routes:
 *           type: array
 *           items:
 *             type: object
 *         extraZones:
 *           type: array
 *           items:
 *             type: integer
 *         stationOrder:
 *           type: array
 *           items:
 *             type: integer
 */

/**
 * @swagger
 * /api/route-assignments:
 *   get:
 *     tags: [Route Assignments]
 *     summary: Retrieve all route assignments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         description: Optional branch ID filter
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Optional search query
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Optional page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Optional page size limit
 *     responses:
 *       200:
 *         description: Map of route assignments retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 $ref: '#/components/schemas/RouteAssignment'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('routes.assign.view'), async (req, res) => {
  const authContext = getAuthContext(req);
  const plan = getAssignmentListAccessPlan(authContext);
  if (plan.scope === 'NONE') {
    res.json({});
    return;
  }

  const { rows } = await pool.query('SELECT * FROM route_assignments');

  // GLOBAL / super-admin → every branch's assignments.
  if (plan.scope === 'GLOBAL') {
    const all: Record<string, any> = {};
    rows.forEach((r: any) => { all[r.key] = buildAssignmentResponse(r); });
    res.json(all);
    return;
  }

  // BRANCH → only assignments whose scheduled team belongs to one of the
  // actor's branches (owning branch derived from the team's employees).
  const owners = await resolveOwningBranchesForKeys(rows.map((r: any) => r.key));
  const allowed = new Set(authContext.allowedBranchIds);
  const result: Record<string, any> = {};
  rows.forEach((r: any) => {
    const owningBranch = owners.get(r.key);
    if (owningBranch != null && allowed.has(owningBranch)) {
      result[r.key] = buildAssignmentResponse(r);
    }
  });
  res.json(result);
});

/**
 * @swagger
 * /api/route-assignments/{key}:
 *   get:
 *     tags: [Route Assignments]
 *     summary: Retrieve route assignment for a specific key
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The assignment key (e.g. YYYY-MM-DD_team_X)
 *     responses:
 *       200:
 *         description: Route assignment details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RouteAssignment'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:key', requirePermission('routes.assign.view'), async (req, res) => {
  const authContext = getAuthContext(req);
  const key = getKeyParam(req);
  const { rows } = await pool.query('SELECT * FROM route_assignments WHERE key = $1', [key]);
  if (rows.length === 0) {
    // Soft-404: no stored record, nothing to leak.
    res.json({ routes: [], extraZones: [], stationOrder: [] });
    return;
  }

  // A record exists → confine branch-scoped callers to their own team's plan.
  const keyMatch = key.match(/^(\d{4}-\d{2}-\d{2})_((?:team|solo)_\d+)$/);
  const owningBranch = keyMatch
    ? await resolveAssignmentOwningBranch(keyMatch[1], keyMatch[2])
    : null;
  const decision = canViewAssignment(authContext, owningBranch);
  if (!decision.allowed) {
    res.status(403).json({ error: 'لا يمكن عرض توزيع مسار خارج نطاق فرعك' });
    return;
  }

  res.json(buildAssignmentResponse(rows[0]));
});

/**
 * @swagger
 * /api/route-assignments/{key}:
 *   put:
 *     tags: [Route Assignments]
 *     summary: Create or update route assignment for a specific key
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The assignment key (e.g. YYYY-MM-DD_team_X)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RouteAssignment'
 *     responses:
 *       200:
 *         description: Route assignment updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RouteAssignment'
 *       400:
 *         description: Validation failed (e.g. duplicate routes/zones or invalid key format)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/:key', requirePermission('routes.assign.manage'), async (req, res) => {
  const authContext = getAuthContext(req);
  const branchId = authContext.actingBranchId;
  if (branchId == null) {
    return res.status(400).json({ error: 'يجب تحديد الفرع' });
  }

  const key = getKeyParam(req);
  const keyMatch = key.match(/^(\d{4}-\d{2}-\d{2})_((?:team|solo)_\d+)$/);
  if (!keyMatch) {
    return res.status(400).json({ error: 'مفتاح توزيع المسار غير صالح' });
  }
  const date = keyMatch[1];
  const teamKey = keyMatch[2];

  // Branch isolation: a route assignment belongs to the branch of its scheduled
  // team (day_schedules has no branch_id — GAP-DS-005). Reject cross-branch
  // writes (guessable date_team_N key). When the team isn't scheduled yet the
  // owning branch is null → authorize() falls back to the acting branch.
  const owningBranch = await resolveAssignmentOwningBranch(date, teamKey);
  const decision = canManageAssignment(authContext, owningBranch);
  if (!decision.allowed) {
    return res.status(403).json({ error: 'لا يمكن تعديل توزيع مسار خارج نطاق فرعك' });
  }
  // Reconcile against the owning branch's tasks when known, else the actor's.
  const syncBranchId = owningBranch ?? branchId;

  const validation = validateRouteAssignmentPayload(req.body);
  if (validation.ok === false) {
    return res.status(400).json({ error: validation.error });
  }

  // DEC-009 لبنة 8 (freeze / append-only): once contact targets have been generated
  // into the call list for this team+date, the route scope may only GROW. Removing a
  // covered zone (or a whole route) would orphan already-generated contact targets and
  // hand a committed task to another team on the next sync. Additions are allowed.
  const { rows: generatedRows } = await pool.query(
    'SELECT 1 FROM telemarketing_task_lists WHERE team_key = $1 AND date = $2 LIMIT 1',
    [teamKey, date],
  );
  if (generatedRows.length > 0) {
    const [oldZones, newZones] = await Promise.all([
      resolveTeamZoneIds(date, teamKey),
      resolveZoneIdsForAssignment(validation.routes, validation.extraZones),
    ]);
    const newZoneSet = new Set(newZones);
    const removedZones = oldZones.filter((z) => !newZoneSet.has(z));
    if (removedZones.length > 0) {
      return res.status(409).json({
        error: 'تعذّر التعديل: بعد توليد جهات الاتصال لا يمكن حذف مناطق أو مسارات من نطاق الفريق — يُسمح بإضافة مناطق/مسارات جديدة فقط (DEC-009 لبنة 8).',
        code: 'SCOPE_FROZEN_AFTER_GENERATION',
        removedZones,
      });
    }
  }

  // FIX-2: save route_assignment first (committed to pool so getPlanningWorkScope
  // can read it immediately), then run sync in the same pgClient transaction.
  // If sync fails, route_assignment is already committed (it's the manager's
  // authoritative intent). A failed sync is surfaced as syncWarning in the
  // response — the next route save will retry the reconcile.
  const { rows } = await pool.query(
    `INSERT INTO route_assignments (key, routes, extra_zones, station_order) VALUES ($1, $2, $3, $4)
    ON CONFLICT (key) DO UPDATE SET routes=$2, extra_zones=$3, station_order=$4 RETURNING *`,
    [key, JSON.stringify(validation.routes), JSON.stringify(validation.extraZones), JSON.stringify(validation.stationOrder)]
  );

  let syncResult = null;
  let syncWarning: string | null = null;
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    syncResult = await syncAssignedTasks({
      date,
      teamKey,
      branchId: syncBranchId,
      performedBy: authContext.userId,
      db: pgClient,
    });
    await pgClient.query('COMMIT');
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    syncWarning = err?.message ?? 'تعذّر تحديث الإسنادات';
    console.error('[route-assignments] syncAssignedTasks failed:', err);
  } finally {
    pgClient.release();
  }

  res.json({
    routes: rows[0].routes,
    extraZones: rows[0].extra_zones,
    stationOrder: rows[0].station_order || [],
    ...(syncResult && { syncResult }),
    ...(syncWarning && { syncWarning }),
  });
});

export default router;
