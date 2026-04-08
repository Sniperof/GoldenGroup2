import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows: routes } = await pool.query('SELECT * FROM routes ORDER BY id');
  const { rows: points } = await pool.query(
    'SELECT route_id AS "routeId", geo_unit_id AS "geoUnitId", level, point_order AS "order" FROM route_points ORDER BY route_id, point_order'
  );
  const result = routes.map(r => ({
    ...r,
    points: points.filter(p => p.routeId === r.id).map(({ routeId, ...rest }) => rest)
  }));
  res.json(result);
});

router.post('/', async (req, res) => {
  const { name, points, status } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO routes (name, status) VALUES ($1, $2) RETURNING *',
      [name, status || 'active']
    );
    const route = rows[0];
    if (points && points.length > 0) {
      for (const p of points) {
        await client.query(
          'INSERT INTO route_points (route_id, geo_unit_id, level, point_order) VALUES ($1, $2, $3, $4)',
          [route.id, p.geoUnitId, p.level, p.order]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ...route, points: points || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { name, points, status } = req.body;
  const routeId = parseInt(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE routes SET name=$1, status=$2 WHERE id=$3', [name, status, routeId]);
    await client.query('DELETE FROM route_points WHERE route_id = $1', [routeId]);
    if (points && points.length > 0) {
      for (const p of points) {
        await client.query(
          'INSERT INTO route_points (route_id, geo_unit_id, level, point_order) VALUES ($1, $2, $3, $4)',
          [routeId, p.geoUnitId, p.level, p.order]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ id: routeId, name, status, points: points || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM routes WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
