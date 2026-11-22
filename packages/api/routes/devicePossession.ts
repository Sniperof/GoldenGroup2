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
import {
  canAccessDevicePossession,
  type DevicePossessionPermission,
} from '../policies/devicePossessionPolicy.js';
import {
  DEVICE_POSSESSION_FROM,
  DEVICE_POSSESSION_SELECT,
  mapDevicePossessionRow,
} from '../services/devicePossessionProjection.js';
import { PossessionTransferError, transferDevicePossession } from '../services/devicePossessionTransfer.js';
import { searchBranchCustomers } from '../services/contractCustomerLookupService.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

const HOLDER_TYPES = ['warehouse', 'technician', 'customer', 'workshop', 'supplier'] as const;
const REASONS      = ['sale_delivery', 'repair_pickup', 'temporary_swap',
                      'retrieval', 'cancellation', 'transfer',
                      'external_registration'] as const;

async function loadDeviceSubject(db: any, deviceId: number, forUpdate = false) {
  const { rows } = await db.query(
    `SELECT branch_id AS "branchId"
       FROM installed_devices
      WHERE id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [deviceId],
  );
  return rows[0] ?? null;
}

function hasDevicePossessionAccess(
  req: any,
  permission: DevicePossessionPermission,
  subject: { branchId: number | null },
) {
  return canAccessDevicePossession(req.authContext, permission, subject).allowed;
}

// GET /api/devices/:deviceId/possession — full history (newest first).
router.get(
  '/:deviceId/possession',
  requirePermission('installed_devices.possession.view'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'deviceId غير صالح' });
    }

    const subject = await loadDeviceSubject(pool, deviceId);
    if (!subject) return res.status(404).json({ error: 'الجهاز غير موجود' });
    if (!hasDevicePossessionAccess(req, 'installed_devices.possession.view', subject)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const { rows } = await pool.query(
      `SELECT ${DEVICE_POSSESSION_SELECT}
         ${DEVICE_POSSESSION_FROM}
        WHERE dpl.device_id = $1
        ORDER BY dpl.start_at DESC, dpl.id DESC`,
      [deviceId],
    );
    res.json(rows.map(mapDevicePossessionRow));
  },
);

// GET /api/devices/:deviceId/possession/current — single current holder (or null).
router.get(
  '/:deviceId/possession/current',
  requirePermission('installed_devices.possession.view'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'deviceId غير صالح' });
    }

    const subject = await loadDeviceSubject(pool, deviceId);
    if (!subject) return res.status(404).json({ error: 'الجهاز غير موجود' });
    if (!hasDevicePossessionAccess(req, 'installed_devices.possession.view', subject)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const { rows } = await pool.query(
      `SELECT ${DEVICE_POSSESSION_SELECT}
         ${DEVICE_POSSESSION_FROM}
        WHERE dpl.device_id = $1 AND dpl.end_at IS NULL
        LIMIT 1`,
      [deviceId],
    );
    res.json(rows[0] ? mapDevicePossessionRow(rows[0]) : null);
  },
);

// POST /api/devices/:deviceId/possession — transfer to new holder.
// Body: { holderType, holderId, reason, notes?, transferAt? }
// Atomically closes the current open row and opens a new one.
router.post(
  '/:deviceId/possession',
  requirePermission('installed_devices.possession.manage'),
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
    // A customer holder also changes the device's client, payer and collection
    // tasks: that is the transfer operation below, never a bare ledger row.
    if (holderType === 'customer') {
      return res.status(400).json({
        error: 'نقل الحيازة إلى زبون يتم عبر عملية نقل الحيازة',
        code: 'use_possession_transfer',
      });
    }

    const at = transferAt ? new Date(transferAt).toISOString() : new Date().toISOString();
    const actorId = (req as any).user?.id ?? null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const subject = await loadDeviceSubject(client, deviceId, true);
      if (!subject) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'الجهاز غير موجود' });
      }
      if (!hasDevicePossessionAccess(req, 'installed_devices.possession.manage', subject)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'غير مسموح' });
      }

      // Close the current open row (if any).
      await client.query(
        `UPDATE device_possession_log
            SET end_at = $1
          WHERE device_id = $2 AND end_at IS NULL`,
        [at, deviceId],
      );

      // Open the new row. The partial unique index guarantees no overlap.
      const { rows: insertedRows } = await client.query(
        `INSERT INTO device_possession_log
           (device_id, holder_type, holder_id, start_at, reason, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [deviceId, holderType, holderId ?? null, at, reason, notes ?? null, actorId],
      );

      const { rows } = await client.query(
        `SELECT ${DEVICE_POSSESSION_SELECT}
           ${DEVICE_POSSESSION_FROM}
          WHERE dpl.id = $1`,
        [insertedRows[0].id],
      );

      await client.query('COMMIT');
      res.status(201).json(mapDevicePossessionRow(rows[0]));
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error('[device-possession] transfer failed:', err);
      res.status(500).json({ error: 'فشل تحديث سجل الحيازة', detail: err?.message });
    } finally {
      client.release();
    }
  },
);

// GET /api/devices/:deviceId/possession/customer-lookup?q= — the new-holder
// search of the transfer: the same server-side lookup as the contract form
// (2+ characters, at most 20 rows), scoped to the device's branch.
router.get(
  '/:deviceId/possession/customer-lookup',
  requirePermission('installed_devices.possession.manage'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'deviceId غير صالح' });
    }
    const subject = await loadDeviceSubject(pool, deviceId);
    if (!subject) return res.status(404).json({ error: 'الجهاز غير موجود' });
    if (!hasDevicePossessionAccess(req, 'installed_devices.possession.manage', subject)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }
    if (subject.branchId == null) return res.json({ items: [], hasMore: false });
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const result = await searchBranchCustomers(pool, Number(subject.branchId), query, 20);
    res.json(result);
  },
);

// POST /api/devices/:deviceId/possession/transfer — administrative transfer to
// another client (migration 500). Body: { toClientId, reasonCode, notes?,
// location?: { geoUnitId, addressText, lat?, lng? } }.
router.post(
  '/:deviceId/possession/transfer',
  requirePermission('installed_devices.possession.manage'),
  async (req, res) => {
    const deviceId = Number(req.params.deviceId);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      return res.status(400).json({ error: 'deviceId غير صالح' });
    }
    const body = req.body ?? {};
    const toClientId = Number(body.toClientId);
    if (!Number.isInteger(toClientId) || toClientId <= 0) {
      return res.status(400).json({ error: 'اختر الزبون الجديد' });
    }
    const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode.trim() : '';
    if (!reasonCode) return res.status(400).json({ error: 'سبب النقل مطلوب' });
    let location: { geoUnitId: number; addressText: string; lat: number | null; lng: number | null } | null = null;
    if (body.location) {
      const geoUnitId = Number(body.location.geoUnitId);
      if (!Number.isInteger(geoUnitId) || geoUnitId <= 0) return res.status(400).json({ error: 'اختر منطقة الموقع الجديد' });
      const lat = body.location.lat == null || body.location.lat === '' ? null : Number(body.location.lat);
      const lng = body.location.lng == null || body.location.lng === '' ? null : Number(body.location.lng);
      location = {
        geoUnitId,
        addressText: String(body.location.addressText ?? ''),
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const subject = await loadDeviceSubject(client, deviceId, true);
      if (!subject) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'الجهاز غير موجود' });
      }
      if (!hasDevicePossessionAccess(req, 'installed_devices.possession.manage', subject)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'غير مسموح' });
      }
      const result = await transferDevicePossession(client, {
        deviceId,
        toClientId,
        reasonCode,
        notes: typeof body.notes === 'string' ? body.notes : null,
        location,
        authContext: (req as any).authContext,
        userId: Number((req as any).user?.id),
      });
      await client.query('COMMIT');
      return res.status(201).json(result);
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof PossessionTransferError) {
        return res.status(err.status).json({ error: err.message, code: err.code, details: err.details ?? null });
      }
      console.error('[device-possession] transfer to client failed:', err);
      return res.status(500).json({ error: 'تعذّر نقل الحيازة' });
    } finally {
      client.release();
    }
  },
);

export default router;
