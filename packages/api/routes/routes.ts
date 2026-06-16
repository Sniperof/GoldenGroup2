import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { listAllGeoUnits } from '../services/geoScopeService.js';
import { areRoutePointsInScope, resolveRouteGeoScope } from '../policies/routePolicy.js';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     GeoRoute:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         status:
 *           type: string
 *         points:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               geoUnitId:
 *                 type: integer
 *               level:
 *                 type: integer
 *               order:
 *                 type: integer
 */

/**
 * @swagger
 * /api/routes:
 *   get:
 *     tags: [Geo Routes]
 *     summary: Retrieve list of routes (geo routes)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/GeoRoute'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No routes.view permission or outside branch scope)
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('routes.view'), async (req, res) => {
  const { rows: routes } = await pool.query('SELECT * FROM routes ORDER BY id');
  const { rows: points } = await pool.query(
    'SELECT route_id AS "routeId", geo_unit_id AS "geoUnitId", level, point_order AS "order" FROM route_points ORDER BY route_id, point_order'
  );
  const geoUnits = await listAllGeoUnits();
  const scope = req.authContext
    ? await resolveRouteGeoScope(req.authContext, 'view', geoUnits)
    : null;
  const result = routes
    .map(r => ({
      ...r,
      points: points.filter(p => p.routeId === r.id).map(({ routeId, ...rest }) => rest)
    }))
    .filter(route => areRoutePointsInScope(route.points, scope));
  res.json(result);
});

/**
 * @swagger
 * /api/routes:
 *   post:
 *     tags: [Geo Routes]
 *     summary: Create new route and route points
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               status:
 *                 type: string
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     geoUnitId:
 *                       type: integer
 *                     level:
 *                       type: integer
 *                     order:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeoRoute'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No routes.manage permission or outside branch geo scope)
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('routes.manage'), async (req, res) => {
  const { name, points, status } = req.body;
  const geoUnits = await listAllGeoUnits();
  const scope = req.authContext
    ? await resolveRouteGeoScope(req.authContext, 'manage', geoUnits)
    : null;
  if (!areRoutePointsInScope(points || [], scope)) {
    return res.status(403).json({ error: 'لا يمكن إنشاء مسار خارج نطاق تغطية الفرع' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO routes (name, status) VALUES ($1, $2) RETURNING *',
      [name, status || 'active']
    );
    const route = rows[0];
    if (points && points.length > 0) {
      for (const p of points) {
        await client.query(
          'INSERT INTO route_points (route_id, geo_unit_id, level, point_order) VALUES ($1, $2, $3, $4)',
          [route.id, p.geoUnitId, p.level, p.order]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ...route, points: points || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/routes/{id}:
 *   put:
 *     tags: [Geo Routes]
 *     summary: Update route and points by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Route ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               status:
 *                 type: string
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     geoUnitId:
 *                       type: integer
 *                     level:
 *                       type: integer
 *                     order:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GeoRoute'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No routes.manage permission or outside branch geo scope)
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('routes.manage'), async (req, res) => {
  const { name, points, status } = req.body;
  const routeIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const routeId = parseInt(routeIdParam, 10);
  const geoUnits = await listAllGeoUnits();
  const scope = req.authContext
    ? await resolveRouteGeoScope(req.authContext, 'manage', geoUnits)
    : null;
  const existingRoute = await loadRouteForScopeCheck(routeId);
  if (!existingRoute.exists) {
    return res.status(404).json({ error: 'Route not found' });
  }
  if (!areRoutePointsInScope(existingRoute.points, scope)) {
    return res.status(403).json({ error: 'لا يمكن تعديل مسار خارج نطاق تغطية الفرع' });
  }
  if (!areRoutePointsInScope(points || [], scope)) {
    return res.status(403).json({ error: 'لا يمكن تعديل المسار ليخرج عن نطاق تغطية الفرع' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE routes SET name=$1, status=$2 WHERE id=$3', [name, status, routeId]);
    await client.query('DELETE FROM route_points WHERE route_id = $1', [routeId]);
    if (points && points.length > 0) {
      for (const p of points) {
        await client.query(
          'INSERT INTO route_points (route_id, geo_unit_id, level, point_order) VALUES ($1, $2, $3, $4)',
          [routeId, p.geoUnitId, p.level, p.order]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ id: routeId, name, status, points: points || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/routes/{id}:
 *   delete:
 *     tags: [Geo Routes]
 *     summary: Delete route by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Route ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (No routes.manage permission or outside branch geo scope)
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('routes.manage'), async (req, res) => {
  const routeIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const routeId = parseInt(routeIdParam, 10);
  const geoUnits = await listAllGeoUnits();
  const scope = req.authContext
    ? await resolveRouteGeoScope(req.authContext, 'manage', geoUnits)
    : null;
  const existingRoute = await loadRouteForScopeCheck(routeId);
  if (!existingRoute.exists) {
    return res.status(404).json({ error: 'Route not found' });
  }
  if (!areRoutePointsInScope(existingRoute.points, scope)) {
    return res.status(403).json({ error: 'لا يمكن حذف مسار خارج نطاق تغطية الفرع' });
  }

  await pool.query('DELETE FROM routes WHERE id = $1', [routeId]);
  res.json({ success: true });
});

async function loadRouteForScopeCheck(routeId: number): Promise<{ exists: boolean; points: Array<{ geoUnitId: number }> }> {
  if (!Number.isInteger(routeId) || routeId <= 0) return { exists: false, points: [] };

  const { rows: routeRows } = await pool.query('SELECT id FROM routes WHERE id = $1', [routeId]);
  if (!routeRows[0]) return { exists: false, points: [] };

  const { rows } = await pool.query(
    'SELECT geo_unit_id AS "geoUnitId" FROM route_points WHERE route_id = $1',
    [routeId],
  );

  return {
    exists: true,
    points: rows.map(row => ({ geoUnitId: Number(row.geoUnitId) })),
  };
}

export default router;
