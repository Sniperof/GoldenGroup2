import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM route_assignments');
  const result: Record<string, any> = {};
  rows.forEach((r: any) => {
    result[r.key] = { routes: r.routes, extraZones: r.extra_zones };
  });
  res.json(result);
});

router.get('/:key', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM route_assignments WHERE key = $1', [req.params.key]);
  if (rows.length > 0) {
    res.json({ routes: rows[0].routes, extraZones: rows[0].extra_zones });
  } else {
    res.json({ routes: [], extraZones: [] });
  }
});

router.put('/:key', async (req, res) => {
  const { routes, extraZones } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO route_assignments (key, routes, extra_zones) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET routes=$2, extra_zones=$3 RETURNING *`,
    [req.params.key, JSON.stringify(routes || []), JSON.stringify(extraZones || [])]
  );
  res.json({ routes: rows[0].routes, extraZones: rows[0].extra_zones });
});

export default router;
