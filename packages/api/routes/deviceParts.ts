import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

function mapPart(row: any) {
  return {
    id:               row.id,
    deviceId:         row.device_id,
    openTaskId:       row.open_task_id,
    sparePartId:      row.spare_part_id,
    partNameSnapshot: row.part_name_snapshot,
    partCodeSnapshot: row.part_code_snapshot,
    maintenanceType:  row.maintenance_type,
    unitPrice:        row.unit_price,
    quantity:         row.quantity,
    lineTotal:        row.line_total,
    eventType:        row.event_type,
    eventDate:        row.event_date,
    notes:            row.notes,
    createdAt:        row.created_at,
    taskType:         row.task_type ?? null,
  };
}

// GET /api/device-parts?deviceId=:id
router.get('/', async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.status(400).json({ error: 'deviceId مطلوب' });

  const { rows } = await pool.query(
    `SELECT dip.*, ot.task_type
     FROM device_installed_parts dip
     LEFT JOIN open_tasks ot ON ot.id = dip.open_task_id
     WHERE dip.device_id = $1
     ORDER BY dip.created_at DESC`,
    [deviceId],
  );
  res.json(rows.map(mapPart));
});

export default router;
