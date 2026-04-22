import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/permission.js';

const router = Router();

// geo_units are global reference data — any authenticated user may read,
// only HQ may mutate.
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, level, parent_id AS "parentId" FROM geo_units ORDER BY level, id');
  res.json(rows);
});

router.post('/', requireSuperAdmin, async (req, res) => {
  const { name, level, parentId } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO geo_units (name, level, parent_id) VALUES ($1, $2, $3) RETURNING id, name, level, parent_id AS "parentId"',
    [name, level, parentId || null]
  );
  res.json(rows[0]);
});

router.delete('/:id', requireSuperAdmin, async (req, res) => {
  await pool.query('DELETE FROM geo_units WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
