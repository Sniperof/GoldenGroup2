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

router.get('/active', requirePermission('geo.view'), async (req, res) => {
  const geoUnits = await listAllGeoUnits();
  const active = geoUnits.filter(u => u.status === 'active');
  const scope = req.authContext
    ? await resolveGeoScope(req.authContext, 'geo.view', active)
    : null;
  res.json(filterGeoUnitsByScope(active, scope));
});

/**
 * @swagger
 * /api/geo-units/{id}:
 *   get:
 *     tags: [Geo Units]
 *     summary: Get a single geo unit by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Geo unit details
 *       404:
 *         description: Not found
 */
router.get('/:id', requirePermission('geo.view'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, level, parent_id AS "parentId", status FROM geo_units WHERE id = $1',
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'الوحدة الجغرافية غير موجودة' });
    return;
  }
  res.json(rows[0]);
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
 *                 enum: [1, 2, 3, 4]
 *               parentId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Created geo unit
 *       400:
 *         description: Validation error
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

  // GAP-035: Validate level range
  if (![1, 2, 3, 4].includes(level)) {
    res.status(400).json({ error: 'المستوى الإداري يجب أن يكون بين 1 و 4' });
    return;
  }

  // GAP-036: Validate parent-child hierarchy
  if (level === 1) {
    if (parentId) {
      res.status(400).json({ error: 'المحافظة (المستوى 1) لا يمكن أن يكون لها أب جغرافي' });
      return;
    }
  } else {
    if (!parentId) {
      res.status(400).json({ error: `المستوى ${level} يجب أن يكون تابعاً لوحدة من المستوى ${level - 1}` });
      return;
    }
    const parentResult = await pool.query(
      'SELECT level FROM geo_units WHERE id = $1',
      [parentId],
    );
    if (parentResult.rows.length === 0) {
      res.status(400).json({ error: 'الأب الجغرافي المحدد غير موجود' });
      return;
    }
    const parentLevel = parentResult.rows[0].level;
    if (parentLevel !== level - 1) {
      res.status(400).json({
        error: `مستوى الأب يجب أن يكون ${level - 1} — المحدد حالياً مستوى ${parentLevel}`,
      });
      return;
    }
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO geo_units (name, level, parent_id) VALUES ($1, $2, $3) RETURNING id, name, level, parent_id AS "parentId", status',
      [name, level, parentId || null],
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
 *   put:
 *     tags: [Geo Units]
 *     summary: Update a geo unit name
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *     responses:
 *       200:
 *         description: Updated geo unit
 *       404:
 *         description: Not found
 *       409:
 *         description: Duplicate name
 */
router.put('/:id', requirePermission('geo.manage'), async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'الاسم مطلوب' });
    return;
  }

  try {
    const { rows } = await pool.query(
      'UPDATE geo_units SET name = $1 WHERE id = $2 RETURNING id, name, level, parent_id AS "parentId", status',
      [name.trim(), req.params.id],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'الوحدة الجغرافية غير موجودة' });
      return;
    }
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'إسم مكرر: توجد وحدة جغرافية بنفس الاسم والمستوى' });
      return;
    }
    throw err;
  }
});

router.patch('/:id/status', requirePermission('geo.manage'), async (req, res) => {
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    res.status(400).json({ error: 'الحالة يجب أن تكون active أو inactive' });
    return;
  }
  const { rows } = await pool.query(
    'UPDATE geo_units SET status = $1 WHERE id = $2 RETURNING id, name, level, parent_id AS "parentId", status',
    [status, req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'الوحدة الجغرافية غير موجودة' });
    return;
  }
  res.json(rows[0]);
});

/**
 * @swagger
 * /api/geo-units/{id}:
 *   delete:
 *     tags: [Geo Units]
 *     summary: Delete a geo unit (fails if it has children)
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
 *       404:
 *         description: Not found
 *       409:
 *         description: Cannot delete — has children
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('geo.manage'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM geo_units WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'الوحدة الجغرافية غير موجودة' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === '23503') {
      res.status(409).json({
        error: 'لا يمكن حذف هذه الوحدة الجغرافية — يوجد وحدات تابعة لها. احذف الأبناء أولاً.',
      });
      return;
    }
    throw err;
  }
});

export default router;
