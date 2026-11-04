// DEC-CT-02: service_agreements — independent from contracts.
//
// Covers third-party devices we service (no sale on our books). The schema
// is intentionally lean compared to sale contracts: no installments and no
// contract warranty record. External periodic maintenance can link an
// agreement to one installed external device through installed_device_id.
//
// Endpoints:
//   GET    /api/service-agreements            — list (paginated)
//   GET    /api/service-agreements/:id        — detail
//   POST   /api/service-agreements            — create
//   PUT    /api/service-agreements/:id        — update editable fields
//
// Cancellation/completion use the same vocabulary as contracts
// (DEC-CT-01 mirror): draft / active / cancelled / completed / discarded.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import {
  recordServiceAgreementCancellation,
  recordServiceAgreementPaymentMovement,
  reverseServiceAgreementPaymentMovement,
  syncServiceAgreementMovements,
} from '../services/financialMovements.js';
import { insertServiceAgreementPayment as insertPayment, mapServiceAgreementPayment as mapPayment, normalizeServiceAgreementPayment as normalizePayment } from '../services/serviceAgreementPayments.js';

const router = Router();
router.use(requireAuth);

const ALLOWED_STATUS = ['draft', 'active', 'cancelled', 'completed', 'discarded'] as const;
// Once active the fee is a booked charge: it cannot change (renewal = a new agreement).
const FINANCIAL_STATUSES = new Set(['active', 'completed', 'cancelled']);

function mapRow(r: any) {
  return {
    id:                       r.id,
    agreementNumber:          r.agreement_number,
    customerId:               r.customer_id,
    customerName:             r.customer_name,
    branchId:                 r.branch_id,
    installedDeviceId:        r.installed_device_id,
    agreementDate:            r.agreement_date,
    externalDeviceModelName:  r.external_device_model_name,
    externalDeviceSerial:     r.external_device_serial,
    externalDeviceNotes:      r.external_device_notes,
    maintenancePlan:          r.maintenance_plan,
    visitsCount:              r.visits_count,
    feeSyp:                   Number(r.fee_syp),
    status:                   r.status,
    startDate:                r.start_date,
    endDate:                  r.end_date,
    closingEmployeeId:        r.closing_employee_id,
    createdBy:                r.created_by,
    legacyContractId:         r.legacy_contract_id,
    notes:                    r.notes,
    createdAt:                r.created_at,
    updatedAt:                r.updated_at,
  };
}

async function assertExternalDeviceLink(deviceId: number, customerId: number, branchId?: number | null) {
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return { ok: false as const, status: 400, error: 'installedDeviceId غير صالح' };
  }
  const { rows } = await pool.query(
    `SELECT id, customer_id, branch_id, device_source
       FROM installed_devices
      WHERE id = $1`,
    [deviceId],
  );
  const device = rows[0];
  if (!device) return { ok: false as const, status: 404, error: 'الجهاز غير موجود' };
  if (Number(device.customer_id) !== Number(customerId)) {
    return { ok: false as const, status: 400, error: 'اتفاق الخدمة يجب أن يرتبط بجهاز لنفس الزبون' };
  }
  if (branchId != null && Number(device.branch_id) !== Number(branchId)) {
    return { ok: false as const, status: 400, error: 'اتفاق الخدمة يجب أن يرتبط بجهاز ضمن نفس الفرع' };
  }
  if (device.device_source !== 'external') {
    return { ok: false as const, status: 400, error: 'اتفاق الخدمة الدوري يربط بالأجهزة الخارجية فقط' };
  }
  return { ok: true as const };
}

// GET /api/service-agreements
router.get('/', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const params: any[] = [];
  const conds: string[] = [];

  if (!authContext.isSuperAdmin) {
    conds.push(`branch_id = $${params.push(authContext.actingBranchId)}`);
  } else {
    const hb = Number(req.headers['x-branch-id'] ?? req.query.branchId);
    if (Number.isFinite(hb) && hb > 0) conds.push(`branch_id = $${params.push(hb)}`);
  }
  const installedDeviceId = Number(req.query.installedDeviceId);
  if (Number.isInteger(installedDeviceId) && installedDeviceId > 0) {
    conds.push(`installed_device_id = $${params.push(installedDeviceId)}`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM service_agreements ${where} ORDER BY id DESC`,
    params,
  );
  res.json(rows.map(mapRow));
});

// GET /api/service-agreements/:id
router.get('/:id', requirePermission('contracts.view_list'), async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM service_agreements WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'اتفاقية الخدمة غير موجودة' });

  const access = authorize(req.authContext!, { permission: 'contracts.view_list', branchId: rows[0].branch_id });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  res.json(mapRow(rows[0]));
});

// POST /api/service-agreements
router.post('/', requirePermission('contracts.edit'), async (req, res) => {
  const b = req.body ?? {};
  const actorId = (req as any).user?.id ?? null;
  const installedDeviceIdRaw = b.installedDeviceId ?? b.installed_device_id ?? null;
  const installedDeviceId = installedDeviceIdRaw == null || installedDeviceIdRaw === '' ? null : Number(installedDeviceIdRaw);

  if (!b.customerId || !b.customerName || !b.agreementDate) {
    return res.status(400).json({ error: 'customerId و customerName و agreementDate حقول مطلوبة' });
  }
  const status = b.status ?? 'active';
  if (!ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: `status غير صالح. القيم: ${ALLOWED_STATUS.join(', ')}` });
  }
  if (installedDeviceId != null) {
    const deviceCheck = await assertExternalDeviceLink(installedDeviceId, Number(b.customerId), b.branchId ?? null);
    if (!deviceCheck.ok) return res.status(deviceCheck.status).json({ error: deviceCheck.error });
  }
  // Payments taken at signing (optional).
  const initialPayments: any[] = [];
  for (const p of Array.isArray(b.payments) ? b.payments : []) {
    const n = normalizePayment(p);
    if ('error' in n) return res.status(400).json({ error: n.error });
    if (n.values.amountSyp > 0) initialPayments.push(n.values);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
    `INSERT INTO service_agreements (
       agreement_number, customer_id, customer_name, branch_id, installed_device_id, agreement_date,
       external_device_model_name, external_device_serial, external_device_notes,
       maintenance_plan, visits_count, fee_syp,
       status, start_date, end_date,
       closing_employee_id, created_by, notes, activated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               CASE WHEN $13 IN ('active', 'completed') THEN NOW() END)
     RETURNING *`,
    [
      b.agreementNumber ?? null,
      b.customerId,
      b.customerName,
      b.branchId ?? null,
      installedDeviceId,
      b.agreementDate,
      b.externalDeviceModelName ?? null,
      b.externalDeviceSerial ?? null,
      b.externalDeviceNotes ?? null,
      b.maintenancePlan ?? null,
      b.visitsCount ?? null,
      b.feeSyp ?? 0,
      status,
      b.startDate ?? null,
      b.endDate ?? null,
      b.closingEmployeeId ?? null,
      actorId,
      b.notes ?? null,
    ],
  );
    for (const v of initialPayments) await insertPayment(client, Number(rows[0].id), v, actorId);
    // Fee charge + payments → unified ledger (only once the agreement is active).
    await syncServiceAgreementMovements(client, Number(rows[0].id), actorId);
    await client.query('COMMIT');
    res.status(201).json(mapRow(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[service-agreements] create error:', err);
    res.status(500).json({ error: 'فشل إنشاء اتفاقية الخدمة' });
  } finally {
    client.release();
  }
});

// PUT /api/service-agreements/:id
router.put('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const id = Number(req.params.id);
  const b  = req.body ?? {};

  const { rows: existing } = await pool.query('SELECT customer_id, branch_id, status, fee_syp FROM service_agreements WHERE id = $1', [id]);
  if (!existing[0]) return res.status(404).json({ error: 'اتفاقية الخدمة غير موجودة' });

  const access = authorize(req.authContext!, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  if (b.status !== undefined && !ALLOWED_STATUS.includes(b.status)) {
    return res.status(400).json({ error: `status غير صالح. القيم: ${ALLOWED_STATUS.join(', ')}` });
  }
  const wasFinancial = FINANCIAL_STATUSES.has(existing[0].status);
  if (wasFinancial && b.feeSyp !== undefined && Number(b.feeSyp) !== Number(existing[0].fee_syp)) {
    return res.status(400).json({ error: 'رسوم الاتفاقية مقفلة بعد التفعيل — لتغييرها ألغِ الاتفاقية وأنشئ اتفاقية جديدة' });
  }
  if (existing[0].status === 'cancelled' && b.status !== undefined && b.status !== 'cancelled') {
    return res.status(400).json({ error: 'الاتفاقية الملغاة لا تُعاد — أنشئ اتفاقية جديدة' });
  }
  const activating = !wasFinancial && (b.status === 'active' || b.status === 'completed');
  const cancelling = existing[0].status !== 'cancelled' && b.status === 'cancelled';

  // Dynamic SET — only update what was sent. legacy_contract_id stays immutable.
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (col: string, val: any) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(val); };

  if (b.agreementNumber         !== undefined) push('agreement_number',           b.agreementNumber);
  if (b.customerName            !== undefined) push('customer_name',              b.customerName);
  if (b.agreementDate           !== undefined) push('agreement_date',             b.agreementDate);
  if (b.externalDeviceModelName !== undefined) push('external_device_model_name', b.externalDeviceModelName);
  if (b.externalDeviceSerial    !== undefined) push('external_device_serial',     b.externalDeviceSerial);
  if (b.externalDeviceNotes     !== undefined) push('external_device_notes',      b.externalDeviceNotes);
  if (b.maintenancePlan         !== undefined) push('maintenance_plan',           b.maintenancePlan);
  if (b.visitsCount             !== undefined) push('visits_count',               b.visitsCount);
  if (b.feeSyp                  !== undefined) push('fee_syp',                    b.feeSyp);
  if (b.status                  !== undefined) push('status',                     b.status);
  if (b.installedDeviceId !== undefined || b.installed_device_id !== undefined) {
    const raw = b.installedDeviceId ?? b.installed_device_id;
    const installedDeviceId = raw == null || raw === '' ? null : Number(raw);
    if (installedDeviceId != null) {
      const deviceCheck = await assertExternalDeviceLink(
        installedDeviceId,
        Number(existing[0].customer_id),
        existing[0].branch_id ?? null,
      );
      if (!deviceCheck.ok) return res.status(deviceCheck.status).json({ error: deviceCheck.error });
    }
    push('installed_device_id', installedDeviceId);
  }
  if (b.startDate               !== undefined) push('start_date',                 b.startDate);
  if (b.endDate                 !== undefined) push('end_date',                   b.endDate);
  if (b.closingEmployeeId       !== undefined) push('closing_employee_id',        b.closingEmployeeId);
  if (b.notes                   !== undefined) push('notes',                      b.notes);

  if (sets.length === 0) return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
  if (activating) sets.push('activated_at = COALESCE(activated_at, NOW())');
  if (cancelling) sets.push('cancelled_at = NOW()');

  vals.push(id);
  const sql = `UPDATE service_agreements SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`;
  const actorId = (req as any).user?.id ?? null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(sql, vals);
    // Activation books the fee (and any payments taken while draft); cancellation
    // waives what is still unpaid.
    if (activating) await syncServiceAgreementMovements(client, id, actorId);
    if (cancelling && wasFinancial) await recordServiceAgreementCancellation(client, id, actorId);
    await client.query('COMMIT');
    res.json(mapRow(rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[service-agreements] update error:', err);
    res.status(500).json({ error: 'فشل تحديث اتفاقية الخدمة' });
  } finally {
    client.release();
  }
});

// ── Payments (migr 485) ───────────────────────────────────────────────────────

async function loadAgreementForAccess(agreementId: any) {
  const { rows } = await pool.query(
    'SELECT id, branch_id, fee_syp, status FROM service_agreements WHERE id = $1',
    [agreementId],
  );
  return rows[0] ?? null;
}

// GET /api/service-agreements/:id/payments
router.get('/:id/payments', requirePermission('contracts.view_list'), async (req, res) => {
  const a = await loadAgreementForAccess(req.params.id);
  if (!a) return res.status(404).json({ error: 'اتفاقية الخدمة غير موجودة' });
  if (!authorize(req.authContext!, { permission: 'contracts.view_list', branchId: a.branch_id }).allowed) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  const { rows } = await pool.query(
    'SELECT * FROM service_agreement_payments WHERE agreement_id = $1 ORDER BY received_at DESC, id DESC',
    [req.params.id],
  );
  const paid = rows.reduce((sum, r) => sum + Number(r.entry_type === 'refund' ? -r.amount_syp : r.amount_syp), 0);
  res.json({
    payments: rows.map(mapPayment), feeSyp: Number(a.fee_syp ?? 0), paidSyp: paid,
    remainingSyp: Math.max(Number(a.fee_syp ?? 0) - paid, 0),
  });
});

// POST /api/service-agreements/:id/payments
router.post('/:id/payments', requirePermission('contracts.edit'), async (req, res) => {
  const a = await loadAgreementForAccess(req.params.id);
  if (!a) return res.status(404).json({ error: 'اتفاقية الخدمة غير موجودة' });
  if (!authorize(req.authContext!, { permission: 'contracts.edit', branchId: a.branch_id }).allowed) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  if (['cancelled', 'discarded'].includes(a.status)) {
    return res.status(400).json({ error: 'لا تُسجّل دفعات على اتفاقية ملغاة' });
  }
  const n = normalizePayment(req.body ?? {});
  if ('error' in n) return res.status(400).json({ error: n.error });
  const actorId = (req as any).user?.id ?? null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await insertPayment(client, Number(a.id), n.values, actorId);
    await recordServiceAgreementPaymentMovement(client, Number(row.id), actorId);
    await client.query('COMMIT');
    res.status(201).json(mapPayment(row));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[service-agreements] add payment error:', err);
    res.status(500).json({ error: 'فشل تسجيل دفعة الاتفاقية' });
  } finally {
    client.release();
  }
});

// DELETE /api/service-agreements/payments/:paymentId
router.delete('/payments/:paymentId', requirePermission('contracts.edit'), async (req, res) => {
  const { rows: pRows } = await pool.query(
    `SELECT p.id, a.branch_id FROM service_agreement_payments p
       JOIN service_agreements a ON a.id = p.agreement_id WHERE p.id = $1`,
    [req.params.paymentId],
  );
  if (!pRows[0]) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  if (!authorize(req.authContext!, { permission: 'contracts.edit', branchId: pRows[0].branch_id }).allowed) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Append-only ledger: book the reversal, then drop the payment row.
    await reverseServiceAgreementPaymentMovement(client, Number(req.params.paymentId), (req as any).user?.id ?? null);
    await client.query('DELETE FROM service_agreement_payments WHERE id = $1', [req.params.paymentId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[service-agreements] delete payment error:', err);
    res.status(500).json({ error: 'فشل حذف دفعة الاتفاقية' });
  } finally {
    client.release();
  }
});

export default router;
