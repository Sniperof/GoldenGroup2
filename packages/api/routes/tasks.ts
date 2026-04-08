import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const selectFields = `
  id, type, customer_name AS "customerName", context, location,
  due_date AS "dueDate", status, priority
`;

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${selectFields} FROM tasks ORDER BY id`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const t = req.body;
  const { rows } = await pool.query(
    `INSERT INTO tasks (type, customer_name, context, location, due_date, status, priority)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${selectFields}`,
    [t.type, t.customerName, t.context || '', t.location || '', t.dueDate || null, t.status || 'pending', t.priority || null]
  );
  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const t = req.body;
  const { rows } = await pool.query(
    `UPDATE tasks SET type=$1, customer_name=$2, context=$3, location=$4,
      due_date=$5, status=$6, priority=$7 WHERE id=$8 RETURNING ${selectFields}`,
    [t.type, t.customerName, t.context || '', t.location || '', t.dueDate || null, t.status || 'pending', t.priority || null, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
