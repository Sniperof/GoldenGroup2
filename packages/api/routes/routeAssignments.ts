import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { syncAssignedTasks } from '../services/assignedTasks.js';

const router = Router();
router.use(requireAuth);

function getAuthContext(req: any) {
  if (!req.authContext) throw new Error('AuthContext is required');
  return req.authContext as {
    userId: number;
    isSuperAdmin: boolean;
    actingBranchId: number | null;
    [key: string]: any;
  };
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
router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM route_assignments');
  const result: Record<string, any> = {};
  rows.forEach((r: any) => {
    result[r.key] = { routes: r.routes, extraZones: r.extra_zones, stationOrder: r.station_order || [] };
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
router.get('/:key', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM route_assignments WHERE key = $1', [req.params.key]);
  if (rows.length > 0) {
    res.json({ routes: rows[0].routes, extraZones: rows[0].extra_zones, stationOrder: rows[0].station_order || [] });
  } else {
    res.json({ routes: [], extraZones: [], stationOrder: [] });
  }
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
router.put('/:key', async (req, res) => {
  const authContext = getAuthContext(req);
  const branchId = authContext.actingBranchId;
  if (branchId == null) {
    return res.status(400).json({ error: 'يجب تحديد الفرع' });
  }

  const keyMatch = req.params.key.match(/^(\d{4}-\d{2}-\d{2})_((?:team|solo)_\d+)$/);
  if (!keyMatch) {
    return res.status(400).json({ error: 'مفتاح توزيع المسار غير صالح' });
  }
  const date = keyMatch[1];
  const teamKey = keyMatch[2];

  const validation = validateRouteAssignmentPayload(req.body);
  if (validation.ok === false) {
    return res.status(400).json({ error: validation.error });
  }

  // FIX-2: save route_assignment first (committed to pool so getPlanningWorkScope
  // can read it immediately), then run sync in the same pgClient transaction.
  // If sync fails, route_assignment is already committed (it's the manager's
  // authoritative intent). A failed sync is surfaced as syncWarning in the
  // response — the next route save will retry the reconcile.
  const { rows } = await pool.query(
    `INSERT INTO route_assignments (key, routes, extra_zones, station_order) VALUES ($1, $2, $3, $4)
    ON CONFLICT (key) DO UPDATE SET routes=$2, extra_zones=$3, station_order=$4 RETURNING *`,
    [req.params.key, JSON.stringify(validation.routes), JSON.stringify(validation.extraZones), JSON.stringify(validation.stationOrder)]
  );

  let syncResult = null;
  let syncWarning: string | null = null;
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    syncResult = await syncAssignedTasks({
      date,
      teamKey,
      branchId,
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
