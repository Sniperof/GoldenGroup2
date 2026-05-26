import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();
router.use(requireAuth);

const selectFields = `
  d.id,
  d.contract_id       AS "contractId",
  d.customer_id       AS "customerId",
  d.branch_id         AS "branchId",
  d.device_model_id   AS "deviceModelId",
  d.device_model_name AS "deviceModelName",
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
  d.created_at                AS "createdAt",
  d.updated_at                AS "updatedAt",
  c.contract_number           AS "contractNumber",
  c.customer_name             AS "customerName",
  gu.name                     AS "installationGeoUnitName"
`;

// GET /api/installed-devices?customerId=X&branchId=Y
router.get('/', requirePermission('contracts.view_list'), async (req, res) => {
  const { customerId, branchId, status } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];

  if (customerId) { params.push(Number(customerId)); conditions.push(`d.customer_id = $${params.length}`); }
  if (branchId)   { params.push(Number(branchId));   conditions.push(`d.branch_id = $${params.length}`); }
  if (status)     { params.push(String(status));      conditions.push(`d.status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT ${selectFields}
     FROM installed_devices d
     JOIN contracts c ON c.id = d.contract_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  res.json(rows);
});

// GET /api/installed-devices/:id
router.get('/:id', requirePermission('contracts.view_list'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${selectFields}
     FROM installed_devices d
     JOIN contracts c ON c.id = d.contract_id
     LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
     WHERE d.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'الجهاز غير موجود' });
  res.json(rows[0]);
});

// PATCH /api/installed-devices/:id  — update physical device fields only
router.patch('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const allowed = [
    'serial_number', 'status',
    'installation_geo_unit_id', 'installation_address_text', 'installation_lat', 'installation_lng',
    'delivery_date', 'installation_date',
    'is_golden_warranty', 'golden_warranty_end_date',
    'contract_warranty_end_date', 'warranty_months', 'warranty_visits',
  ];
  const sets: string[] = [];
  const params: any[] = [];

  const fieldMap: Record<string, string> = {
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
