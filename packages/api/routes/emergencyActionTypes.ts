import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();
router.use(requireAuth);

/**
 * @swagger
 * components:
 *   schemas:
 *     EmergencyActionType:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         arabicLabel:
 *           type: string
 *         description:
 *           type: string
 *         displayOrder:
 *           type: integer
 *         isActive:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

const SELECT = `id, arabic_label AS "arabicLabel", description,
  display_order AS "displayOrder", is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

// GET /api/admin/emergency-action-types
/**
 * @swagger
 * /api/admin/emergency-action-types:
 *   get:
 *     tags: [Emergency Action Types]
 *     summary: List all emergency action types
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
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
 *         description: A list of emergency action types
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmergencyActionType'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('admin.emergency_action_types.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT} FROM emergency_action_types ORDER BY display_order, id`,
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/emergency-action-types/active — for dropdowns (no manage permission needed)
/**
 * @swagger
 * /api/admin/emergency-action-types/active:
 *   get:
 *     tags: [Emergency Action Types]
 *     summary: List active emergency action types
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
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
 *         description: A list of active emergency action types
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmergencyActionType'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/active', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT} FROM emergency_action_types WHERE is_active = TRUE ORDER BY display_order, id`,
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/emergency-action-types
/**
 * @swagger
 * /api/admin/emergency-action-types:
 *   post:
 *     tags: [Emergency Action Types]
 *     summary: Create an emergency action type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmergencyActionType'
 *     responses:
 *       201:
 *         description: Created emergency action type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmergencyActionType'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('admin.emergency_action_types.manage'), async (req, res) => {
  try {
    const { arabicLabel, description, displayOrder } = req.body ?? {};
    if (!arabicLabel?.trim()) return res.status(400).json({ error: 'arabicLabel مطلوب' });
    const { rows } = await pool.query(
      `INSERT INTO emergency_action_types (arabic_label, description, display_order)
       VALUES ($1, $2, $3) RETURNING ${SELECT}`,
      [arabicLabel.trim(), description?.trim() || null, Number(displayOrder) || 0],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/emergency-action-types/:id
/**
 * @swagger
 * /api/admin/emergency-action-types/{id}:
 *   patch:
 *     tags: [Emergency Action Types]
 *     summary: Update an emergency action type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Emergency action type ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmergencyActionType'
 *     responses:
 *       200:
 *         description: Updated emergency action type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmergencyActionType'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Emergency action type not found
 *       500:
 *         description: Server error
 */
router.patch('/:id', requirePermission('admin.emergency_action_types.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { arabicLabel, description, displayOrder, isActive } = req.body ?? {};
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    if (arabicLabel !== undefined) { params.push(arabicLabel.trim()); sets.push(`arabic_label = $${params.length}`); }
    if (description !== undefined) { params.push(description?.trim() || null); sets.push(`description = $${params.length}`); }
    if (displayOrder !== undefined) { params.push(Number(displayOrder)); sets.push(`display_order = $${params.length}`); }
    if (isActive !== undefined) { params.push(Boolean(isActive)); sets.push(`is_active = $${params.length}`); }
    if (sets.length === 1) return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE emergency_action_types SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT}`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'نوع الإجراء غير موجود' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/emergency-action-types/:id
/**
 * @swagger
 * /api/admin/emergency-action-types/{id}:
 *   delete:
 *     tags: [Emergency Action Types]
 *     summary: Delete an emergency action type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Emergency action type ID
 *     responses:
 *       200:
 *         description: Deleted successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('admin.emergency_action_types.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM emergency_action_types WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
