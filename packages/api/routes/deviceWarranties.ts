import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// DEC-CT-05: warranty status enum (pending/active/cancelled/expired)
// + cancellation_reason / cancelled_at / cancelled_by.
// DEC-CT-04: activated_at snapshot is the start of effective coverage.
// is_active is kept as a denormalized read cache, synced via DB trigger
// from migration 200, and will be dropped in a future cleanup migration.

const ALLOWED_STATUS = ['pending', 'active', 'cancelled', 'expired'] as const;
const ALLOWED_CANCEL_REASONS = ['contract_cancelled', 'device_retrieved', 'manual'] as const;

function mapWarranty(row: any) {
  return {
    id:                  row.id,
    deviceId:            row.device_id,
    warrantyType:        row.warranty_type,
    startDate:           row.start_date,
    endDate:             row.end_date,
    months:              row.months,
    visits:              row.visits,
    sourceTaskId:        row.source_task_id,
    status:              row.status,
    activatedAt:         row.activated_at,
    cancellationReason:  row.cancellation_reason,
    cancelledAt:         row.cancelled_at,
    cancelledBy:         row.cancelled_by,
    isActive:            row.is_active, // legacy mirror; prefer `status`
    notes:               row.notes,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
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
//
// Accepts:
//   { startDate, endDate, months, visits, sourceTaskId, notes }
//   { status, cancellationReason, activatedAt }
//
// Cancellation rules (DEC-CT-05):
//   - status='cancelled' requires cancellationReason.
//   - cancelled_at/cancelled_by are stamped server-side from the actor and NOW().
//   - Any non-cancelled status clears the cancellation triplet.
router.patch('/:id', async (req, res) => {
  const b = req.body ?? {};
  const actorId = (req as any).user?.id ?? null;

  // Validate enums up front so bad input never reaches SQL.
  if (b.status !== undefined && !ALLOWED_STATUS.includes(b.status)) {
    return res.status(400).json({ error: `status غير صالحة. القيم المسموحة: ${ALLOWED_STATUS.join(', ')}` });
  }
  if (b.cancellationReason !== undefined && b.cancellationReason !== null
      && !ALLOWED_CANCEL_REASONS.includes(b.cancellationReason)) {
    return res.status(400).json({ error: `cancellationReason غير صالح` });
  }
  if (b.status === 'cancelled' && !b.cancellationReason) {
    return res.status(400).json({ error: 'cancellationReason مطلوب عند تعيين status=cancelled' });
  }

  // Build the SET clause dynamically — only touch fields the caller sent.
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (sql: string, val: any) => { sets.push(`${sql} = $${vals.length + 1}`); vals.push(val); };

  if (b.startDate    !== undefined) push('start_date',     b.startDate);
  if (b.endDate      !== undefined) push('end_date',       b.endDate);
  if (b.months       !== undefined) push('months',         b.months);
  if (b.visits       !== undefined) push('visits',         b.visits);
  if (b.sourceTaskId !== undefined) push('source_task_id', b.sourceTaskId);
  if (b.activatedAt  !== undefined) push('activated_at',   b.activatedAt);
  if (b.notes        !== undefined) push('notes',          b.notes);

  if (b.status !== undefined) {
    push('status', b.status);
    if (b.status === 'cancelled') {
      push('cancellation_reason', b.cancellationReason);
      push('cancelled_at',        new Date().toISOString());
      push('cancelled_by',        actorId);
    } else {
      // Non-cancelled status must clear the triplet (DB CHECK enforces this).
      push('cancellation_reason', null);
      push('cancelled_at',        null);
      push('cancelled_by',        null);
    }
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
  }

  vals.push(req.params.id);
  const sql = `UPDATE device_warranties SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`;
  const { rows } = await pool.query(sql, vals);

  if (!rows[0]) return res.status(404).json({ error: 'سجل الضمان غير موجود' });
  res.json(mapWarranty(rows[0]));
});

export default router;
