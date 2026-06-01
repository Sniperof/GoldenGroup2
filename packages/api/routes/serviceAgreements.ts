// DEC-CT-02: service_agreements — independent from contracts.
//
// Covers third-party devices we service (no sale on our books). The schema
// is intentionally lean compared to sale contracts: no installments, no
// installed_devices link, no contract warranty record.
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

const router = Router();
router.use(requireAuth);

const ALLOWED_STATUS = ['draft', 'active', 'cancelled', 'completed', 'discarded'] as const;

function mapRow(r: any) {
  return {
    id:                       r.id,
    agreementNumber:          r.agreement_number,
    customerId:               r.customer_id,
    customerName:             r.customer_name,
    branchId:                 r.branch_id,
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

  if (!b.customerId || !b.customerName || !b.agreementDate) {
    return res.status(400).json({ error: 'customerId و customerName و agreementDate حقول مطلوبة' });
  }
  const status = b.status ?? 'active';
  if (!ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: `status غير صالح. القيم: ${ALLOWED_STATUS.join(', ')}` });
  }

  const { rows } = await pool.query(
    `INSERT INTO service_agreements (
       agreement_number, customer_id, customer_name, branch_id, agreement_date,
       external_device_model_name, external_device_serial, external_device_notes,
       maintenance_plan, visits_count, fee_syp,
       status, start_date, end_date,
       closing_employee_id, created_by, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      b.agreementNumber ?? null,
      b.customerId,
      b.customerName,
      b.branchId ?? null,
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
  res.status(201).json(mapRow(rows[0]));
});

// PUT /api/service-agreements/:id
router.put('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const id = Number(req.params.id);
  const b  = req.body ?? {};

  const { rows: existing } = await pool.query('SELECT branch_id FROM service_agreements WHERE id = $1', [id]);
  if (!existing[0]) return res.status(404).json({ error: 'اتفاقية الخدمة غير موجودة' });

  const access = authorize(req.authContext!, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  if (b.status !== undefined && !ALLOWED_STATUS.includes(b.status)) {
    return res.status(400).json({ error: `status غير صالح. القيم: ${ALLOWED_STATUS.join(', ')}` });
  }

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
  if (b.startDate               !== undefined) push('start_date',                 b.startDate);
  if (b.endDate                 !== undefined) push('end_date',                   b.endDate);
  if (b.closingEmployeeId       !== undefined) push('closing_employee_id',        b.closingEmployeeId);
  if (b.notes                   !== undefined) push('notes',                      b.notes);

  if (sets.length === 0) return res.status(400).json({ error: 'لا توجد حقول للتحديث' });

  vals.push(id);
  const sql = `UPDATE service_agreements SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`;
  const { rows } = await pool.query(sql, vals);
  res.json(mapRow(rows[0]));
});

export default router;
