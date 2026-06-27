import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { HIDDEN_OPERATIONAL_TASK_TYPES } from '@golden-crm/shared';

const router = Router();

const SELECT_COLS = `
  task_type            AS "taskType",
  task_family          AS "taskFamily",
  arabic_label         AS "arabicLabel",
  scheduling_pattern   AS "schedulingPattern",
  window_basis         AS "windowBasis",
  planning_window_days AS "planningWindowDays",
  contract_required    AS "contractRequired",
  allow_multiple       AS "allowMultiple",
  has_due_date         AS "hasDueDate",
  display_order        AS "displayOrder",
  is_active            AS "isActive",
  location_basis       AS "locationBasis",
  created_at           AS "createdAt",
  updated_at           AS "updatedAt"
`;

// GET /api/admin/task-types — list all task type configs
/**
 * @swagger
 * /api/admin/task-types:
 *   get:
 *     tags: [Admin → Task Type Config]
 *     summary: List all task type configurations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: activeOnly
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Filter active-only configurations
 *     responses:
 *       200:
 *         description: List of task type configs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   taskType:
 *                     type: string
 *                   taskFamily:
 *                     type: string
 *                   arabicLabel:
 *                     type: string
 *                   schedulingPattern:
 *                     type: string
 *                   windowBasis:
 *                     type: string
 *                   planningWindowDays:
 *                     type: integer
 *                   contractRequired:
 *                     type: boolean
 *                   allowMultiple:
 *                     type: boolean
 *                   hasDueDate:
 *                     type: boolean
 *                   displayOrder:
 *                     type: integer
 *                   isActive:
 *                     type: boolean
 *                   locationBasis:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   updatedAt:
 *                     type: string
 *                     format: date-time
 *       500:
 *         description: Server error
 */
// Open to any authenticated user (the planning engine and UI dropdowns both need it).
router.get('/', requireAuth, async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const params = [Array.from(HIDDEN_OPERATIONAL_TASK_TYPES)];
    const query = `
      SELECT ${SELECT_COLS}
      FROM task_type_config
      WHERE task_type <> ALL($1::text[])
      ${activeOnly ? 'AND is_active = TRUE' : ''}
      ORDER BY display_order ASC
    `;
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching task type configs:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/task-types/:taskType — update mutable fields only
/**
 * @swagger
 * /api/admin/task-types/{taskType}:
 *   patch:
 *     tags: [Admin → Task Type Config]
 *     summary: Update task type config mutable fields
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: taskType
 *         schema:
 *           type: string
 *         required: true
 *         description: Task type identifier (e.g. installation, filter_change, etc.)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planningWindowDays:
 *                 type: integer
 *                 description: Non-negative integer (max 3650)
 *               isActive:
 *                 type: boolean
 *               locationBasis:
 *                 type: string
 *                 enum: [client, contract, device]
 *     responses:
 *       200:
 *         description: Updated task type configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 taskType:
 *                   type: string
 *                 taskFamily:
 *                   type: string
 *                 arabicLabel:
 *                   type: string
 *                 schedulingPattern:
 *                   type: string
 *                 windowBasis:
 *                   type: string
 *                 planningWindowDays:
 *                   type: integer
 *                 contractRequired:
 *                   type: boolean
 *                 allowMultiple:
 *                   type: boolean
 *                 hasDueDate:
 *                   type: boolean
 *                 displayOrder:
 *                   type: integer
 *                 isActive:
 *                   type: boolean
 *                 locationBasis:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid parameters or business logic rules violated
 *       404:
 *         description: Task type config not found
 *       500:
 *         description: Server error
 */
router.patch('/:taskType', requirePermission('admin.task_types.manage'), async (req, res) => {
  try {
    const { taskType } = req.params;
    const { planningWindowDays, isActive, locationBasis } = req.body ?? {};

    const { rows: existingRows } = await pool.query(
      `SELECT scheduling_pattern, window_basis FROM task_type_config WHERE task_type = $1`,
      [taskType],
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Task type not found' });
    }
    const { scheduling_pattern: pattern } = existingRows[0];

    const updates: string[] = [];
    const params: any[] = [];

    if (planningWindowDays !== undefined) {
      if (pattern === 'immediate') {
        if (planningWindowDays !== null) {
          return res.status(400).json({
            error: 'Tasks with pattern "immediate" cannot have a planning window value',
          });
        }
      } else {
        const days = Number(planningWindowDays);
        if (!Number.isInteger(days) || days < 0 || days > 3650) {
          return res.status(400).json({
            error: 'planningWindowDays must be a non-negative integer (max 3650)',
          });
        }
        params.push(days);
        updates.push(`planning_window_days = $${params.length}`);
      }
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' });
      }
      params.push(isActive);
      updates.push(`is_active = $${params.length}`);
    }

    if (locationBasis !== undefined) {
      if (!['client', 'contract', 'device'].includes(locationBasis)) {
        return res.status(400).json({ error: 'locationBasis must be "client", "contract", or "device"' });
      }
      params.push(locationBasis);
      updates.push(`location_basis = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(taskType);

    const query = `
      UPDATE task_type_config
      SET ${updates.join(', ')}
      WHERE task_type = $${params.length}
      RETURNING ${SELECT_COLS}
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error updating task type config:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
