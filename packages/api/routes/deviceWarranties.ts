import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { insertTechnicalState } from '../services/visitTaskResultReflection.js';

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
    // DEC-CT-17: golden-warranty financials (contract warranty leaves these NULL)
    totalValue:          row.total_value,
    offerTaskId:         row.offer_task_id,
    cardDeliveryTaskId:  row.card_delivery_task_id,
    notes:               row.notes,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
  };
}

function mapPayment(row: any) {
  return {
    id:               row.id,
    warrantyId:       row.warranty_id,
    method:           row.method,
    currency:         row.currency,
    amountValue:      row.amount_value,
    exchangeRate:     row.exchange_rate,
    amountSyp:        row.amount_syp,
    referenceNumber:  row.reference_number,
    barterName:       row.barter_name,
    barterValueSyp:   row.barter_value_syp,
    transferCompanyId: row.transfer_company_id,
    receivedByEmployeeId: row.received_by_employee_id,
    receivedAt:       row.received_at,
    entryType:        row.entry_type,
    notes:            row.notes,
    createdAt:        row.created_at,
  };
}

const PAYMENT_METHODS = ['cash','sham_cash','syriatel_cash','mtn_cash','alharam','bank_transfer','barter','usd_cash'] as const;
const PAYMENT_ENTRY_TYPES = ['collection','refund'] as const;

/**
 * DEC-CT-16 §13.5 / DEC-CT-17: golden_warranty_end_date is DERIVED, not a source
 * of truth — it mirrors the latest ACTIVE golden warranty (one active at a time).
 * Call after any change to a device's golden warranties.
 */
export async function recomputeGoldenWarrantyEndDate(dbClient: any, deviceId: number | string) {
  await dbClient.query(
    `UPDATE installed_devices d
        SET golden_warranty_end_date = (
          SELECT MAX(w.end_date)
            FROM device_warranties w
           WHERE w.device_id = d.id
             AND w.warranty_type = 'golden'
             AND w.status = 'active'
        )
      WHERE d.id = $1`,
    [deviceId],
  );
}

// GET /api/device-warranties?deviceId=:id
router.get('/', requirePermission('clients.device_warranties.view', 'contracts.view_list'), async (req, res) => {
  const { deviceId } = req.query;
  const authContext = req.authContext!;
  if (!deviceId) return res.status(400).json({ error: 'deviceId مطلوب' });

  const { rows: deviceRows } = await pool.query(
    'SELECT branch_id AS "branchId" FROM installed_devices WHERE id = $1',
    [deviceId],
  );
  if (!deviceRows[0]) return res.status(404).json({ error: 'ط§ظ„ط¬ظ‡ط§ط² ط؛ظٹط± ظ…ظˆط¬ظˆط¯' });
  const access = {
    allowed:
      authorize(authContext, { permission: 'clients.device_warranties.view', branchId: deviceRows[0].branchId }).allowed ||
      authorize(authContext, { permission: 'contracts.view_list', branchId: deviceRows[0].branchId }).allowed,
  };
  if (!access.allowed) return res.status(403).json({ error: 'ط؛ظٹط± ظ…ط³ظ…ظˆط­' });

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
router.patch('/:id', requirePermission('contracts.edit'), async (req, res) => {
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

// ── Golden-warranty offer result (DEC-CT-17) ────────────────────────────────
// Field marketing task `golden_warranty_offer`: on acceptance the team hands the
// customer the RECEIPT, which activates the golden warranty immediately
// (start = receipt date, end = start + months). Captures the baseline 01i reading
// (the offer task is a valid field source task) and any initial payments.
//
// POST /api/device-warranties/golden/offer-result
//   { taskId, deviceId, receiptDate, months, totalValue, visits?, reading?, payments? }
router.post('/golden/offer-result', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const actorId = (req as any).user?.id ?? null;
  const b = req.body ?? {};

  const taskId = Number(b.taskId);
  const deviceId = Number(b.deviceId);
  const months = Number(b.months);
  if (!Number.isFinite(taskId) || !Number.isFinite(deviceId)) {
    return res.status(400).json({ error: 'taskId و deviceId مطلوبان' });
  }
  if (!Number.isFinite(months) || months <= 0) {
    return res.status(400).json({ error: 'months غير صالحة' });
  }
  const totalValue = b.totalValue != null ? Number(b.totalValue) : null;
  if (totalValue != null && (!Number.isFinite(totalValue) || totalValue < 0)) {
    return res.status(400).json({ error: 'totalValue غير صالحة' });
  }
  // Receipt date = activation moment; default to today.
  const receiptDate: string = b.receiptDate ?? new Date().toISOString().slice(0, 10);

  const { rows: devRows } = await pool.query(
    'SELECT id, branch_id AS "branchId", contract_id AS "contractId" FROM installed_devices WHERE id = $1',
    [deviceId],
  );
  if (!devRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  if (!authorize(authContext, { permission: 'contracts.edit', branchId: devRows[0].branchId }).allowed) {
    return res.status(403).json({ error: 'غير مسموح' });
  }

  // Guard: one active warranty at a time (DEC-CT-16). Block if any active
  // warranty still covers on/after the new start (mirrors the exclusion '[)').
  const { rows: activeRows } = await pool.query(
    `SELECT id FROM device_warranties
      WHERE device_id = $1 AND status = 'active' AND end_date > $2 LIMIT 1`,
    [deviceId, receiptDate],
  );
  if (activeRows[0]) {
    return res.status(409).json({ error: 'يوجد كفالة فعّالة لم تنتهِ بعد على هذا الجهاز — لا يمكن تفعيل كفالة ذهبية متداخلة' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: wRows } = await client.query(
      `INSERT INTO device_warranties
         (device_id, warranty_type, start_date, end_date, months, visits, total_value,
          status, activated_at, source_task_id, offer_task_id)
       VALUES ($1, 'golden', $2, ($2::date + make_interval(months => $3::int))::date, $3::int, $4, $5,
               'active', now(), $6, $6)
       RETURNING *`,
      [deviceId, receiptDate, months, b.visits ?? null, totalValue, taskId],
    );
    const warranty = wRows[0];

    // Baseline 01i reading — the offer task is the source task (constitution 01i §2).
    await insertTechnicalState(client, {
      installedDeviceId: deviceId,
      openTaskId: taskId,
      contractId: devRows[0].contractId ?? null,
      taskTypeSnapshot: 'golden_warranty_offer',
      phase: 'baseline',
      recordedBy: actorId,
      reading: b.reading ?? null,
    });

    // Optional initial payments.
    if (Array.isArray(b.payments)) {
      for (const p of b.payments) {
        if (!PAYMENT_METHODS.includes(p.method)) continue;
        const av = Number(p.amountValue);
        if (!Number.isFinite(av) || av < 0) continue;
        const er = p.exchangeRate != null ? Number(p.exchangeRate) : null;
        const syp = p.amountSyp != null ? Number(p.amountSyp) : (er ? av * er : av);
        await client.query(
          `INSERT INTO device_warranty_payments
             (warranty_id, method, currency, amount_value, exchange_rate, amount_syp,
              reference_number, barter_name, barter_value_syp, transfer_company_id,
              received_by_employee_id, notes, entry_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [warranty.id, p.method, p.currency ?? 'SYP', av, er, syp,
           p.referenceNumber ?? null, p.barterName ?? null, p.barterValueSyp ?? null,
           p.transferCompanyId ?? null, p.receivedByEmployeeId ?? actorId, p.notes ?? null,
           p.entryType ?? 'collection'],
        );
      }
    }

    await recomputeGoldenWarrantyEndDate(client, deviceId);
    await client.query(`UPDATE open_tasks SET status = 'completed' WHERE id = $1`, [taskId]);

    await client.query('COMMIT');
    res.status(201).json(mapWarranty(warranty));
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[device-warranties] golden offer-result error:', err);
    res.status(500).json({ error: 'فشل تسجيل نتيجة عرض الكفالة الذهبية' });
  } finally {
    client.release();
  }
});

// POST /api/device-warranties/golden/:warrantyId/card-delivery
// Routine VIP-card handover (DEC-CT-17): stamps the delivery task; activates nothing.
router.post('/golden/:warrantyId/card-delivery', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const taskId = req.body?.taskId != null ? Number(req.body.taskId) : null;
  const w = await loadWarrantyForAccess(req.params.warrantyId);
  if (!w) return res.status(404).json({ error: 'سجل الكفالة غير موجود' });
  if (w.warranty_type !== 'golden') {
    return res.status(400).json({ error: 'تسليم الكرت يخص الكفالة الذهبية فقط' });
  }
  if (!authorize(authContext, { permission: 'contracts.edit', branchId: w.branchId }).allowed) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  const { rows } = await pool.query(
    `UPDATE device_warranties SET card_delivery_task_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [taskId, req.params.warrantyId],
  );
  if (taskId) {
    await pool.query(`UPDATE open_tasks SET status = 'completed' WHERE id = $1`, [taskId]);
  }
  res.json(mapWarranty(rows[0]));
});

// ── Golden-warranty payments (DEC-CT-17) ─────────────────────────────────────
// Dedicated payment-entries layer mirroring contract_payment_entries; only golden
// warranties carry payments (contract warranty is part of the contract).

async function loadWarrantyForAccess(warrantyId: any) {
  const { rows } = await pool.query(
    `SELECT w.id, w.warranty_type, w.total_value, d.branch_id AS "branchId"
       FROM device_warranties w
       JOIN installed_devices d ON d.id = w.device_id
      WHERE w.id = $1`,
    [warrantyId],
  );
  return rows[0] ?? null;
}

// GET /api/device-warranties/:id/payments
router.get('/:id/payments', requirePermission('clients.device_warranties.view', 'contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const w = await loadWarrantyForAccess(req.params.id);
  if (!w) return res.status(404).json({ error: 'سجل الكفالة غير موجود' });

  const allowed =
    authorize(authContext, { permission: 'clients.device_warranties.view', branchId: w.branchId }).allowed ||
    authorize(authContext, { permission: 'contracts.view_list', branchId: w.branchId }).allowed;
  if (!allowed) return res.status(403).json({ error: 'غير مسموح' });

  const { rows } = await pool.query(
    `SELECT * FROM device_warranty_payments WHERE warranty_id = $1 ORDER BY received_at DESC, id DESC`,
    [req.params.id],
  );
  const paid = rows.reduce((s, r) => s + Number(r.entry_type === 'refund' ? -r.amount_syp : r.amount_syp), 0);
  const remaining = w.total_value != null ? Number(w.total_value) - paid : null;
  res.json({ payments: rows.map(mapPayment), totalValue: w.total_value, paidSyp: paid, remainingSyp: remaining });
});

// POST /api/device-warranties/:id/payments
router.post('/:id/payments', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const actorId = (req as any).user?.id ?? null;
  const b = req.body ?? {};

  const w = await loadWarrantyForAccess(req.params.id);
  if (!w) return res.status(404).json({ error: 'سجل الكفالة غير موجود' });
  if (w.warranty_type !== 'golden') {
    return res.status(400).json({ error: 'الدفعات تخص الكفالة الذهبية فقط؛ كفالة العقد بلا دفعات' });
  }
  const allowed = authorize(authContext, { permission: 'contracts.edit', branchId: w.branchId }).allowed;
  if (!allowed) return res.status(403).json({ error: 'غير مسموح' });

  if (!PAYMENT_METHODS.includes(b.method)) {
    return res.status(400).json({ error: `طريقة الدفع غير صالحة. المسموح: ${PAYMENT_METHODS.join(', ')}` });
  }
  if (b.entryType !== undefined && !PAYMENT_ENTRY_TYPES.includes(b.entryType)) {
    return res.status(400).json({ error: 'نوع الحركة غير صالح' });
  }
  const amountValue = Number(b.amountValue);
  if (!Number.isFinite(amountValue) || amountValue < 0) {
    return res.status(400).json({ error: 'amountValue غير صالح' });
  }
  const currency = b.currency ?? 'SYP';
  const exchangeRate = b.exchangeRate != null ? Number(b.exchangeRate) : null;
  // amount_syp: explicit, else convert via exchange rate, else assume already SYP.
  const amountSyp = b.amountSyp != null ? Number(b.amountSyp)
    : (exchangeRate ? amountValue * exchangeRate : amountValue);

  const { rows } = await pool.query(
    `INSERT INTO device_warranty_payments
       (warranty_id, method, currency, amount_value, exchange_rate, amount_syp,
        reference_number, barter_name, barter_value_syp, transfer_company_id,
        received_by_employee_id, notes, entry_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      req.params.id, b.method, currency, amountValue, exchangeRate, amountSyp,
      b.referenceNumber ?? null, b.barterName ?? null, b.barterValueSyp ?? null,
      b.transferCompanyId ?? null, b.receivedByEmployeeId ?? actorId, b.notes ?? null,
      b.entryType ?? 'collection',
    ],
  );
  res.status(201).json(mapPayment(rows[0]));
});

// DELETE /api/device-warranties/payments/:paymentId
router.delete('/payments/:paymentId', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: pRows } = await pool.query(
    `SELECT p.id, d.branch_id AS "branchId"
       FROM device_warranty_payments p
       JOIN device_warranties w ON w.id = p.warranty_id
       JOIN installed_devices d ON d.id = w.device_id
      WHERE p.id = $1`,
    [req.params.paymentId],
  );
  if (!pRows[0]) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  if (!authorize(authContext, { permission: 'contracts.edit', branchId: pRows[0].branchId }).allowed) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  await pool.query(`DELETE FROM device_warranty_payments WHERE id = $1`, [req.params.paymentId]);
  res.json({ ok: true });
});

export default router;
