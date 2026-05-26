import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

function mapWarranty(row: any) {
  return {
    id:           row.id,
    deviceId:     row.device_id,
    warrantyType: row.warranty_type,
    startDate:    row.start_date,
    endDate:      row.end_date,
    months:       row.months,
    visits:       row.visits,
    sourceTaskId: row.source_task_id,
    isActive:     row.is_active,
    notes:        row.notes,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

// GET /api/device-warranties?deviceId=:id
router.get('/', async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.status(400).json({ error: 'deviceId مطلوب' });

  const { rows } = await pool.query(
    `SELECT * FROM device_warranties WHERE device_id = $1 ORDER BY warranty_type`,
    [deviceId],
  );
  res.json(rows.map(mapWarranty));
});

// PATCH /api/device-warranties/:id
router.patch('/:id', async (req, res) => {
  const b = req.body;

  const { rows } = await pool.query(
    `UPDATE device_warranties SET
      start_date     = COALESCE($1, start_date),
      end_date       = COALESCE($2, end_date),
      months         = COALESCE($3, months),
      visits         = COALESCE($4, visits),
      source_task_id = COALESCE($5, source_task_id),
      is_active      = COALESCE($6, is_active),
      notes          = COALESCE($7, notes)
    WHERE id = $8
    RETURNING *`,
    [
      b.startDate    ?? null,
      b.endDate      ?? null,
      b.months       ?? null,
      b.visits       ?? null,
      b.sourceTaskId ?? null,
      b.isActive     ?? null,
      b.notes        ?? null,
      req.params.id,
    ],
  );
  if (!rows[0]) return res.status(404).json({ error: 'سجل الضمان غير موجود' });
  res.json(mapWarranty(rows[0]));
});

export default router;
