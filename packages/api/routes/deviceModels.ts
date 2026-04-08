import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const selectFields = `
  id, name, brand, category, maintenance_interval AS "maintenanceInterval",
  base_price AS "basePrice", supported_visit_types AS "supportedVisitTypes"
`;

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${selectFields} FROM device_models ORDER BY id`);
  res.json(rows.map(r => ({ ...r, basePrice: Number(r.basePrice) })));
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
