import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  d.id,
  d.contract_id       AS "contractId",
  d.customer_id       AS "customerId",
  d.branch_id         AS "branchId",
  COALESCE(d.device_model_id, c.device_model_id) AS "deviceModelId",
  COALESCE(d.device_model_name, c.device_model_name) AS "deviceModelName",
  d.serial_number     AS "serialNumber",
  d.status,
  d.installation_geo_unit_id  AS "installationGeoUnitId",
  d.installation_address_text AS "installationAddressText",
  d.installation_lat          AS "installationLat",
  d.installation_lng          AS "installationLng",
  d.delivery_date             AS "deliveryDate",
  d.installation_date         AS "installationDate",
  d.is_golden_warranty        AS "isGoldenWarranty",
  d.golden_warranty_end_date  AS "goldenWarrantyEndDate",
  d.contract_warranty_end_date AS "contractWarrantyEndDate",
  d.warranty_months           AS "warrantyMonths",
  d.warranty_visits           AS "warrantyVisits",
  d.activated_at              AS "activatedAt",
  d.created_at                AS "createdAt",
  d.updated_at                AS "updatedAt",
  c.contract_number           AS "contractNumber",
  c.customer_name             AS "customerName",
  b.name                      AS "branchName",
  gu.name                     AS "installationGeoUnitName",
  jsonb_strip_nulls(jsonb_build_object(
    'serialNumber', CASE WHEN d.serial_number IS NULL OR btrim(d.serial_number) = '' THEN 'missing' END,
    'branchName', CASE WHEN b.name IS NULL THEN 'missing' END,
    'installationLocation', CASE
      WHEN d.installation_geo_unit_id IS NULL
       AND (d.installation_address_text IS NULL OR btrim(d.installation_address_text) = '')
       AND (d.installation_lat IS NULL OR d.installation_lng IS NULL)
      THEN 'missing'
    END,
    'deliveryDate', CASE WHEN d.delivery_date IS NULL THEN 'pending_or_missing' END,
    'installationDate', CASE WHEN d.installation_date IS NULL THEN 'pending_or_missing' END,
    'activatedAt', CASE WHEN d.activated_at IS NULL THEN 'pending_or_missing' END,
    'warrantyTerms', CASE WHEN d.warranty_months IS NULL AND d.warranty_visits IS NULL THEN 'missing' END
  )) AS "missingFields"
`;

// GET /api/installed-devices?customerId=X&branchId=Y
router.get('/', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const { customerId, branchId, status } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];

  if (customerId) { params.push(Number(customerId)); conditions.push(`d.customer_id = $${params.length}`); }
  if (branchId) {
    const requestedBranchId = Number(branchId);
    if (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0) {
      return res.status(400).json({ error: 'معرف الفرع غير صالح' });
    }
    const access = authorize(authContext, { permission: 'contracts.view_list', branchId: requestedBranchId });
    if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });
    params.push(requestedBranchId);
    conditions.push(`d.branch_id = $${params.length}`);
  } else if (!authContext.isSuperAdmin) {
    if (authContext.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }
    params.push(authContext.allowedBranchIds);
    conditions.push(`d.branch_id = ANY($${params.length}::int[])`);
  }
  if (status)     { params.push(String(status));      conditions.push(`d.status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT ${selectFields}
     FROM installed_devices d
     JOIN contracts c ON c.id = d.contract_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  res.json(rows);
});

// GET /api/installed-devices/:id
router.get('/:id', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows } = await pool.query(
    `SELECT ${selectFields}
     FROM installed_devices d
     JOIN contracts c ON c.id = d.contract_id
     LEFT JOIN branches b ON b.id = d.branch_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     WHERE d.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.view_list', branchId: rows[0].branchId });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });
  res.json(rows[0]);
});

// PATCH /api/installed-devices/:id  — update physical device fields only
router.patch('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existingRows } = await pool.query(
    'SELECT branch_id AS "branchId" FROM installed_devices WHERE id = $1',
    [req.params.id],
  );
  if (!existingRows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  const currentAccess = authorize(authContext, { permission: 'contracts.edit', branchId: existingRows[0].branchId });
  if (!currentAccess.allowed) return res.status(403).json({ error: 'غير مسموح' });

  const requestedTargetBranchId = req.body.branchId ?? req.body.branch_id;
  if (requestedTargetBranchId !== undefined && requestedTargetBranchId !== null && requestedTargetBranchId !== '') {
    const targetBranchId = Number(requestedTargetBranchId);
    if (!Number.isInteger(targetBranchId) || targetBranchId <= 0) {
      return res.status(400).json({ error: 'معرف الفرع المستهدف غير صالح' });
    }
    const targetAccess = authorize(authContext, { permission: 'contracts.edit', branchId: targetBranchId });
    if (!targetAccess.allowed) return res.status(403).json({ error: 'لا يمكنك نقل الجهاز إلى فرع غير مسموح به' });
    const { rows: branchRows } = await pool.query('SELECT status FROM branches WHERE id = $1', [targetBranchId]);
    if (!branchRows[0]) return res.status(400).json({ error: 'الفرع المستهدف غير موجود' });
    if (branchRows[0].status === 'inactive') return res.status(400).json({ error: 'لا يمكن نقل الجهاز إلى فرع موقوف' });
  }

  const allowed = [
    'branch_id', 'serial_number', 'status',
    'installation_geo_unit_id', 'installation_address_text', 'installation_lat', 'installation_lng',
    'delivery_date', 'installation_date',
    'is_golden_warranty', 'golden_warranty_end_date',
    'contract_warranty_end_date', 'warranty_months', 'warranty_visits',
  ];
  const sets: string[] = [];
  const params: any[] = [];

  const fieldMap: Record<string, string> = {
    branchId: 'branch_id',
    branch_id: 'branch_id',
    serialNumber: 'serial_number',
    status: 'status',
    installationGeoUnitId: 'installation_geo_unit_id',
    installationAddressText: 'installation_address_text',
    installationLat: 'installation_lat',
    installationLng: 'installation_lng',
    deliveryDate: 'delivery_date',
    installationDate: 'installation_date',
    isGoldenWarranty: 'is_golden_warranty',
    goldenWarrantyEndDate: 'golden_warranty_end_date',
    contractWarrantyEndDate: 'contract_warranty_end_date',
    warrantyMonths: 'warranty_months',
    warrantyVisits: 'warranty_visits',
  };

  for (const [camel, col] of Object.entries(fieldMap)) {
    if (req.body[camel] !== undefined) {
      params.push(req.body[camel]);
      sets.push(`${col} = $${params.length}`);
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'لا يوجد حقول للتحديث' });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE installed_devices SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING id`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  res.json({ ok: true, id: rows[0].id });
});

export default router;
