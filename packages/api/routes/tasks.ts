import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveTargetBranchId } from '../middleware/permission.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  id, type, customer_name AS "customerName", context, location,
  due_date AS "dueDate", status, priority,
  branch_id AS "branchId"
`;

router.get('/', async (req, res) => {
  const scope = req.scope!;
  if (scope.isSuperAdmin) {
    const hb = Number(req.header('x-branch-id'));
    if (Number.isFinite(hb) && hb > 0) {
      const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks WHERE branch_id = $1 ORDER BY id`, [hb]);
      return res.json(rows);
    }
    const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks ORDER BY id`);
    return res.json(rows);
  }
  const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks WHERE branch_id = $1 ORDER BY id`, [scope.branchId]);
  res.json(rows);
});

router.post('/', async (req, res) => {
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

router.put('/:id', async (req, res) => {
  const scope = req.scope!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM tasks WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'المهمة غير موجودة' });
  if (!scope.isSuperAdmin && existing[0].branch_id !== scope.branchId) {
    return res.status(403).json({ message: 'غير مسموح' });
  }
  const t = req.body;
  const { rows } = await pool.query(
    `UPDATE tasks SET type=$1, customer_name=$2, context=$3, location=$4,
      due_date=$5, status=$6, priority=$7 WHERE id=$8 RETURNING ${selectFields}`,
    [t.type, t.customerName, t.context || '', t.location || '', t.dueDate || null, t.status || 'pending', t.priority || null, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const scope = req.scope!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM tasks WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'المهمة غير موجودة' });
  if (!scope.isSuperAdmin && existing[0].branch_id !== scope.branchId) {
    return res.status(403).json({ message: 'غير مسموح' });
  }
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
