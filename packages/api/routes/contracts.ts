import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { promoteClientToLifecycleStatus } from '../services/clientLifecycleService.js';

const router = Router();
router.use(requireAuth);

const contractSelect = `
  c.id, c.contract_number AS "contractNumber", c.customer_id AS "customerId",
  c.customer_name AS "customerName", c.contract_date AS "contractDate",
  c.source_visit AS "sourceVisit", c.device_model_id AS "deviceModelId",
  c.device_model_name AS "deviceModelName", c.serial_number AS "serialNumber",
  c.maintenance_plan AS "maintenancePlan", c.base_price AS "basePrice",
  c.final_price AS "finalPrice", c.payment_type AS "paymentType",
  c.down_payment AS "downPayment", c.installments_count AS "installmentsCount",
  c.delivery_date AS "deliveryDate", c.installation_date AS "installationDate",
  c.status, c.created_at AS "createdAt", c.branch_id AS "branchId",
  c.sale_type AS "saleType",
  c.installation_geo_unit_id AS "installationGeoUnitId",
  c.installation_address_text AS "installationAddressText",
  c.installation_lat AS "installationLat",
  c.installation_lng AS "installationLng"
`;

function mapContract(c: any) {
  return {
    ...c,
    basePrice:   Number(c.basePrice),
    finalPrice:  Number(c.finalPrice),
    downPayment: Number(c.downPayment),
  };
}
function mapDue(d: any) {
  return { ...d, originalAmount: Number(d.originalAmount), remainingBalance: Number(d.remainingBalance) };
}

const dueSelect = `
  id, contract_id AS "contractId", type, scheduled_date AS "scheduledDate",
  adjusted_date AS "adjustedDate", original_amount AS "originalAmount",
  remaining_balance AS "remainingBalance", assigned_telemarketer_id AS "assignedTelemarketerId",
  status, escalated
`;

router.get('/', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const params: any[] = [];
  const conditions: string[] = [];

  if (!authContext.isSuperAdmin) {
    conditions.push(`c.branch_id = $${params.push(authContext.actingBranchId)}`);
  } else {
    const hb = Number(req.header('x-branch-id'));
    if (Number.isFinite(hb) && hb > 0) conditions.push(`c.branch_id = $${params.push(hb)}`);
  }
  // Optional filter by customerId
  const cid = Number(req.query.customerId);
  if (cid > 0) conditions.push(`c.customer_id = $${params.push(cid)}`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows: contracts } = await pool.query(`SELECT ${contractSelect} FROM contracts c ${where} ORDER BY c.id DESC`, params);
  const ids = contracts.map((c: any) => c.id);
  const { rows: dues } = ids.length
    ? await pool.query(`SELECT ${dueSelect} FROM dues WHERE contract_id = ANY($1) ORDER BY contract_id, scheduled_date`, [ids])
    : { rows: [] as any[] };
  res.json(contracts.map((c: any) => ({ ...mapContract(c), dues: dues.filter((d: any) => d.contractId === c.id).map(mapDue) })));
});

router.get('/:id', requirePermission('contracts.view_list'), async (req, res) => {
  const { rows } = await pool.query(`SELECT ${contractSelect} FROM contracts c WHERE c.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const contract = mapContract(rows[0]);
  const { rows: dues } = await pool.query(
    `SELECT ${dueSelect} FROM dues WHERE contract_id = $1 ORDER BY scheduled_date`,
    [contract.id],
  );
  // Linked open tasks (emergency, maintenance, collection, service, etc.)
  const { rows: tasks } = await pool.query(
    `SELECT ot.id, ot.task_type AS "taskType", ot.task_family AS "taskFamily",
            ot.status, ot.priority, ot.due_date AS "dueDate", ot.notes,
            ot.created_at AS "createdAt",
            ttc.arabic_label AS "taskLabel"
       FROM open_tasks ot
       LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
      WHERE ot.contract_id = $1
      ORDER BY ot.created_at DESC`,
    [contract.id],
  );
  // Client snapshot
  const { rows: clientRows } = await pool.query(
    `SELECT id, name, mobile, contacts, neighborhood, district, governorate,
            detailed_address AS "detailedAddress", rating, national_id AS "nationalId"
       FROM clients WHERE id = $1`,
    [contract.customerId],
  );
  const client = clientRows[0] ?? null;
  res.json({ ...contract, dues: dues.map(mapDue), tasks, client });
});

router.post('/', requirePermission('contracts.create'), async (req, res) => {
  const c = req.body;
  const targetBranchId = resolveTargetBranchId(req, res, c.branchId);
  if (targetBranchId == null) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const installationGeoUnitId = c.geoSelection?.neighborhoodId || null;
    const installationAddressText = c.detailedAddress?.trim() || null;
    const installationLat = c.mapPosition?.[0] ?? null;
    const installationLng = c.mapPosition?.[1] ?? null;

    const { rows } = await client.query(
      `INSERT INTO contracts (contract_number, customer_id, customer_name, contract_date,
        source_visit, device_model_id, device_model_name, serial_number, maintenance_plan,
        base_price, final_price, payment_type, down_payment, installments_count,
        delivery_date, installation_date, status, branch_id, sale_type,
        installation_geo_unit_id, installation_address_text, installation_lat, installation_lng)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING ${contractSelect.replace(/c\./g, '')}`,
      [c.contractNumber, c.customerId, c.customerName, c.contractDate,
       c.sourceVisit || null, c.deviceModelId, c.deviceModelName, c.serialNumber,
       c.maintenancePlan, c.basePrice || 0, c.finalPrice || 0, c.paymentType,
       c.downPayment || 0, c.installmentsCount || 0, c.deliveryDate || null, c.installationDate || null,
       c.status || 'draft', targetBranchId, c.saleType || c.saleType || 'marketing',
       installationGeoUnitId, installationAddressText, installationLat, installationLng]
    );
    const contract = rows[0];

    const duesResult: any[] = [];
    if (c.dues && c.dues.length > 0) {
      for (const d of c.dues) {
        const { rows: dRows } = await client.query(
          `INSERT INTO dues (contract_id, type, scheduled_date, adjusted_date,
            original_amount, remaining_balance, assigned_telemarketer_id, status, escalated)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${dueSelect}`,
          [contract.id, d.type, d.scheduledDate, d.adjustedDate,
           d.originalAmount, d.remainingBalance, d.assignedTelemarketerId || null,
           d.status || 'Pending', d.escalated || false]
        );
        duesResult.push(dRows[0]);
      }
    }

    // OP promotion: client now has a contract → company ownership, no personal assignments
    if (c.customerId) {
      await promoteClientToLifecycleStatus(client, Number(c.customerId), 'OP');
    }

    await client.query('COMMIT');
    res.json({ ...mapContract(contract), dues: duesResult.map(mapDue) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM contracts WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  const c = req.body;
  const installationGeoUnitId = c.geoSelection?.neighborhoodId || c.installationGeoUnitId || null;
  const installationAddressText = c.detailedAddress?.trim() || c.installationAddressText || null;
  const installationLat = c.mapPosition?.[0] ?? c.installationLat ?? null;
  const installationLng = c.mapPosition?.[1] ?? c.installationLng ?? null;

  const { rows } = await pool.query(
    `UPDATE contracts SET contract_number=$1, customer_id=$2, customer_name=$3,
      contract_date=$4, source_visit=$5, device_model_id=$6, device_model_name=$7,
      serial_number=$8, maintenance_plan=$9, base_price=$10, final_price=$11,
      payment_type=$12, down_payment=$13, installments_count=$14,
      delivery_date=$15, installation_date=$16, status=$17,
      installation_geo_unit_id=$18, installation_address_text=$19,
      installation_lat=$20, installation_lng=$21
    WHERE id=$22 RETURNING ${contractSelect.replace(/c\./g, '')}`,
    [c.contractNumber, c.customerId, c.customerName, c.contractDate,
     c.sourceVisit || null, c.deviceModelId, c.deviceModelName, c.serialNumber,
     c.maintenancePlan, c.basePrice, c.finalPrice, c.paymentType,
     c.downPayment || 0, c.installmentsCount || 0, c.deliveryDate, c.installationDate,
     c.status || 'draft',
     installationGeoUnitId, installationAddressText, installationLat, installationLng,
     req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', requirePermission('contracts.delete'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM contracts WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.delete', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  await pool.query('DELETE FROM contracts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
