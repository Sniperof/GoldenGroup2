import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { filterGeoUnitsByScope, listAllGeoUnits, resolveGeoScope } from '../services/geoScopeService.js';

const router = Router();

/**
 * @swagger
 * /api/geo-units:
 *   get:
 *     tags: [Geo Units]
 *     summary: List all geo units
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     responses:
 *       200:
 *         description: List of geo units
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   level:
 *                     type: integer
 *                   parentId:
 *                     type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('geo.view'), async (req, res) => {
  const geoUnits = await listAllGeoUnits();
  const scope = req.authContext
    ? await resolveGeoScope(req.authContext, 'geo.view', geoUnits)
    : null;
  res.json(filterGeoUnitsByScope(geoUnits, scope));
});

/**
 * @swagger
 * /api/geo-units:
 *   post:
 *     tags: [Geo Units]
 *     summary: Create a new geo unit
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, level]
 *             properties:
 *               name:
 *                 type: string
 *               level:
 *                 type: integer
 *               parentId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Created geo unit
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 level:
 *                   type: integer
 *                 parentId:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Duplicate name
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('geo.manage'), async (req, res) => {
  const { name, level, parentId } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO geo_units (name, level, parent_id) VALUES ($1, $2, $3) RETURNING id, name, level, parent_id AS "parentId"',
      [name, level, parentId || null]
    );
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
       res.status(409).json({ error: 'إسم مكرر: توجد وحدة جغرافية بنفس الاسم والمستوى' });
       return;
    }
    throw err;
  }
});

/**
 * @swagger
 * /api/geo-units/{id}:
 *   delete:
 *     tags: [Geo Units]
 *     summary: Delete a geo unit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Geo unit ID
 *     responses:
 *       200:
 *         description: Deleted successfully
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
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('geo.manage'), async (req, res) => {
  await pool.query('DELETE FROM geo_units WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
