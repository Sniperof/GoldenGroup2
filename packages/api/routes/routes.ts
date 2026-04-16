import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

async function buildRoutesWithPoints(routeRows: any[]) {
  if (routeRows.length === 0) return [];
  const ids = routeRows.map(r => r.id);
  const { rows: points } = await pool.query(
    'SELECT route_id AS "routeId", geo_unit_id AS "geoUnitId", level, point_order AS "order" FROM route_points WHERE route_id = ANY($1) ORDER BY route_id, point_order',
    [ids],
  );
  return routeRows.map(r => ({
    ...r,
    points: points.filter(p => p.routeId === r.id).map(({ routeId, ...rest }) => rest),
  }));
}

router.get('/', async (req, res) => {
  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows: routeRows }, { rows: countRows }] = await Promise.all([
      pool.query('SELECT * FROM routes ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
      pool.query('SELECT COUNT(*) FROM routes'),
    ]);
    const data = await buildRoutesWithPoints(routeRows);
    res.json(paginatedResponse(data, parseInt(countRows[0].count), page, limit));
  } else {
    const { rows: routeRows } = await pool.query('SELECT * FROM routes ORDER BY id');
    const result = await buildRoutesWithPoints(routeRows);
    res.json(result);
  }
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
