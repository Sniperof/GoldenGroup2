import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

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
  created_at           AS "createdAt",
  updated_at           AS "updatedAt"
`;

// GET /api/admin/task-types — list all task type configs
// Open to any authenticated user (the planning engine and UI dropdowns both need it).
router.get('/', requireAuth, async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const query = `
      SELECT ${SELECT_COLS}
      FROM task_type_config
      ${activeOnly ? 'WHERE is_active = TRUE' : ''}
      ORDER BY display_order ASC
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching task type configs:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/task-types/:taskType — update mutable fields only
router.patch('/:taskType', requirePermission('admin.task_types.manage'), async (req, res) => {
  try {
    const { taskType } = req.params;
    const { planningWindowDays, isActive } = req.body ?? {};

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
