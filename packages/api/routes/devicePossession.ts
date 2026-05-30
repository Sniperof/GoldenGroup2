// DEC-CT-09: device_possession_log API.
//
// Endpoints:
//   GET    /api/devices/:deviceId/possession        — full history
//   GET    /api/devices/:deviceId/possession/current — current holder
//   POST   /api/devices/:deviceId/possession         — transfer to new holder
//
// The transfer endpoint is the only mutation; it closes the open row and
// opens a new one atomically. Direct edits to historical rows are not
// permitted — possession history is immutable by design.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

const HOLDER_TYPES = ['warehouse', 'technician', 'customer', 'workshop', 'supplier'] as const;
const REASONS      = ['sale_delivery', 'repair_pickup', 'temporary_swap',
                      'retrieval', 'cancellation', 'transfer'] as const;

function mapRow(r: any) {
  return {
    id:          r.id,
    deviceId:    r.device_id,
    holderType:  r.holder_type,
    holderId:    r.holder_id,
    startAt:     r.start_at,
    endAt:       r.end_at,
    reason:      r.reason,
    notes:       r.notes,
    createdBy:   r.created_by,
    createdAt:   r.created_at,
  };
}

// GET /api/devices/:deviceId/possession — full history (newest first).
router.get(
  '/:deviceId/possession',
  requirePermission('contracts.view_list'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'deviceId غير صالح' });
    }
    const { rows } = await pool.query(
      `SELECT * FROM device_possession_log
        WHERE device_id = $1
        ORDER BY start_at DESC, id DESC`,
      [deviceId],
    );
    res.json(rows.map(mapRow));
  },
);

// GET /api/devices/:deviceId/possession/current — single current holder (or null).
router.get(
  '/:deviceId/possession/current',
  requirePermission('contracts.view_list'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    const { rows } = await pool.query(
      `SELECT * FROM device_possession_log
        WHERE device_id = $1 AND end_at IS NULL
        LIMIT 1`,
      [deviceId],
    );
    res.json(rows[0] ? mapRow(rows[0]) : null);
  },
);

// POST /api/devices/:deviceId/possession — transfer to new holder.
// Body: { holderType, holderId, reason, notes?, transferAt? }
// Atomically closes the current open row and opens a new one.
router.post(
  '/:deviceId/possession',
  requirePermission('contracts.edit'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'deviceId غير صالح' });
    }

    const { holderType, holderId, reason, notes, transferAt } = req.body ?? {};

    if (!HOLDER_TYPES.includes(holderType)) {
      return res.status(400).json({ error: `holderType غير صالح. القيم: ${HOLDER_TYPES.join(', ')}` });
    }
    if (!REASONS.includes(reason)) {
      return res.status(400).json({ error: `reason غير صالح. القيم: ${REASONS.join(', ')}` });
    }

    const at = transferAt ? new Date(transferAt).toISOString() : new Date().toISOString();
    const actorId = (req as any).user?.id ?? null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the device exists (the FK would also catch it, but we want a clean 404).
      const dev = await client.query('SELECT id FROM installed_devices WHERE id = $1', [deviceId]);
      if (!dev.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'الجهاز غير موجود' });
      }

      // Close the current open row (if any).
      await client.query(
        `UPDATE device_possession_log
            SET end_at = $1
          WHERE device_id = $2 AND end_at IS NULL`,
        [at, deviceId],
      );

      // Open the new row. The partial unique index guarantees no overlap.
      const { rows } = await client.query(
        `INSERT INTO device_possession_log
           (device_id, holder_type, holder_id, start_at, reason, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [deviceId, holderType, holderId ?? null, at, reason, notes ?? null, actorId],
      );

      await client.query('COMMIT');
      res.status(201).json(mapRow(rows[0]));
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error('[device-possession] transfer failed:', err);
      res.status(500).json({ error: 'فشل تحديث سجل الحيازة', detail: err?.message });
    } finally {
      client.release();
    }
  },
);

export default router;
