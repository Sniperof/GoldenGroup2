import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, level, parent_id AS "parentId" FROM geo_units ORDER BY level, id');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, level, parentId } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO geo_units (name, level, parent_id) VALUES ($1, $2, $3) RETURNING id, name, level, parent_id AS "parentId"',
    [name, level, parentId || null]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM geo_units WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
