import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { filterGeoUnitsByScope, listAllGeoUnits, resolveGeoScope } from '../services/geoScopeService.js';

const router = Router();

router.get('/', requirePermission('geo.view'), async (req, res) => {
  const geoUnits = await listAllGeoUnits();
  const scope = req.authContext
    ? await resolveGeoScope(req.authContext, 'geo.view', geoUnits)
    : null;
  res.json(filterGeoUnitsByScope(geoUnits, scope));
});

router.post('/', requirePermission('geo.manage'), async (req, res) => {
  const { name, level, parentId } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO geo_units (name, level, parent_id) VALUES ($1, $2, $3) RETURNING id, name, level, parent_id AS "parentId"',
    [name, level, parentId || null]
  );
  res.json(rows[0]);
});

router.delete('/:id', requirePermission('geo.manage'), async (req, res) => {
  await pool.query('DELETE FROM geo_units WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
