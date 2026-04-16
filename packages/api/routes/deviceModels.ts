import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const selectFields = `
  id, name, brand, category, maintenance_interval AS "maintenanceInterval",
  base_price AS "basePrice", supported_visit_types AS "supportedVisitTypes"
`;

const mapModel = (r: any) => ({ ...r, basePrice: Number(r.basePrice) });

router.get('/', async (req, res) => {
  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(`SELECT ${selectFields} FROM device_models ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query(`SELECT COUNT(*) FROM device_models`),
    ]);
    res.json(paginatedResponse(rows.map(mapModel), parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(`SELECT ${selectFields} FROM device_models ORDER BY id`);
    res.json(rows.map(mapModel));
  }
});

router.post('/', async (req, res) => {
  const d = req.body;
  const { rows } = await pool.query(
    `INSERT INTO device_models (name, brand, category, maintenance_interval, base_price, supported_visit_types)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${selectFields}`,
    [d.name, d.brand, d.category, d.maintenanceInterval, d.basePrice, JSON.stringify(d.supportedVisitTypes || [])]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

router.put('/:id', async (req, res) => {
  const d = req.body;
  const { rows } = await pool.query(
    `UPDATE device_models SET name=$1, brand=$2, category=$3, maintenance_interval=$4,
      base_price=$5, supported_visit_types=$6 WHERE id=$7 RETURNING ${selectFields}`,
    [d.name, d.brand, d.category, d.maintenanceInterval, d.basePrice, JSON.stringify(d.supportedVisitTypes || []), req.params.id]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM device_models WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
