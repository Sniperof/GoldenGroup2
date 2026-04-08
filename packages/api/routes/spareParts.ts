import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType",
      compatible_device_ids AS "compatibleDeviceIds"
    FROM spare_parts ORDER BY id
  `);
  res.json(rows.map(r => ({ ...r, basePrice: Number(r.basePrice) })));
});

router.post('/', async (req, res) => {
  const s = req.body;
  const { rows } = await pool.query(
    `INSERT INTO spare_parts (name, code, base_price, maintenance_type, compatible_device_ids)
    VALUES ($1,$2,$3,$4,$5) RETURNING id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType", compatible_device_ids AS "compatibleDeviceIds"`,
    [s.name, s.code, s.basePrice, s.maintenanceType, JSON.stringify(s.compatibleDeviceIds || [])]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

router.put('/:id', async (req, res) => {
  const s = req.body;
  const { rows } = await pool.query(
    `UPDATE spare_parts SET name=$1, code=$2, base_price=$3, maintenance_type=$4,
      compatible_device_ids=$5 WHERE id=$6
    RETURNING id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType", compatible_device_ids AS "compatibleDeviceIds"`,
    [s.name, s.code, s.basePrice, s.maintenanceType, JSON.stringify(s.compatibleDeviceIds || []), req.params.id]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM spare_parts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
