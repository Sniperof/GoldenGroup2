import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  id, type, customer_name AS "customerName", context, location,
  due_date AS "dueDate", status, priority,
  branch_id AS "branchId"
`;

/**
 * @swagger
 * components:
 *   schemas:
 *     Task:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         type:
 *           type: string
 *         customerName:
 *           type: string
 *         context:
 *           type: string
 *         location:
 *           type: string
 *         dueDate:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *         priority:
 *           type: string
 *         branchId:
 *           type: integer
 */

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     tags: [Tasks]
 *     summary: Retrieve a list of tasks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
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
 *         description: List of tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Task'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     tags: [Tasks]
 *     summary: Retrieve a specific task by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The task ID
 *     responses:
 *       200:
 *         description: The task details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('tasks.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  if (authContext.isSuperAdmin) {
    const hb = Number(req.header('x-branch-id'));
    if (Number.isFinite(hb) && hb > 0) {
      const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks WHERE branch_id = $1 ORDER BY id`, [hb]);
      return res.json(rows);
    }
    const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks ORDER BY id`);
    return res.json(rows);
  }
  const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks WHERE branch_id = $1 ORDER BY id`, [authContext.actingBranchId]);
  res.json(rows);
});

/**
 * @swagger
 * /api/tasks:
 *   post:
 *     tags: [Tasks]
 *     summary: Create a new task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Task'
 *     responses:
 *       201:
 *         description: Created task
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('tasks.create'), async (req, res) => {
  const t = req.body;
  const targetBranchId = resolveTargetBranchId(req, res, t.branchId);
  if (targetBranchId == null) return;
  const { rows } = await pool.query(
    `INSERT INTO tasks (type, customer_name, context, location, due_date, status, priority, branch_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${selectFields}`,
    [t.type, t.customerName, t.context || '', t.location || '', t.dueDate || null, t.status || 'pending', t.priority || null, targetBranchId]
  );
  res.json(rows[0]);
});

/**
 * @swagger
 * /api/tasks/{id}:
 *   put:
 *     tags: [Tasks]
 *     summary: Update an existing task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Task'
 *     responses:
 *       200:
 *         description: Updated task
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Task not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('tasks.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM tasks WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'المهمة غير موجودة' });
  const access = authorize(authContext, { permission: 'tasks.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  const t = req.body;
  const { rows } = await pool.query(
    `UPDATE tasks SET type=$1, customer_name=$2, context=$3, location=$4,
      due_date=$5, status=$6, priority=$7 WHERE id=$8 RETURNING ${selectFields}`,
    [t.type, t.customerName, t.context || '', t.location || '', t.dueDate || null, t.status || 'pending', t.priority || null, req.params.id]
  );
  res.json(rows[0]);
});

/**
 * @swagger
 * /api/tasks/{id}:
 *   delete:
 *     tags: [Tasks]
 *     summary: Delete a task
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The task ID
 *     responses:
 *       200:
 *         description: Delete confirmation
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('tasks.delete'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM tasks WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'المهمة غير موجودة' });
  const access = authorize(authContext, { permission: 'tasks.delete', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
