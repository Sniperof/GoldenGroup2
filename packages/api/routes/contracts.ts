import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { promoteClientToLifecycleStatus } from '../services/clientLifecycleService.js';
import { freezeContractDocument } from './contractDocuments.js'; // DEC-CT-15

const router = Router();
router.use(requireAuth);

// Phase 2C: physical device fields are read AND written via installed_devices only.
// Financial / legal fields remain on contracts.
// All queries using contractSelect must add:
//   LEFT JOIN installed_devices d ON d.contract_id = c.id
const contractSelect = `
  c.id, c.contract_number AS "contractNumber", c.customer_id AS "customerId",
  c.customer_name AS "customerName", c.contract_date AS "contractDate",
  c.source_visit AS "sourceVisit", c.device_model_id AS "deviceModelId",
  c.device_model_name AS "deviceModelName",
  c.maintenance_plan AS "maintenancePlan", c.base_price AS "basePrice",
  c.final_price AS "finalPrice", c.payment_type AS "paymentType",
  c.down_payment AS "downPayment", c.installments_count AS "installmentsCount",
  c.status, c.created_at AS "createdAt", c.branch_id AS "branchId",
  c.sale_type AS "saleType", c.sale_source AS "saleSource",
  c.discount_id AS "discountId",
  c.closing_employee_id AS "closingEmployeeId",
  c.closing_date AS "closingDate",
  c.invoice_notes AS "invoiceNotes",
  c.applied_device_discount_id AS "appliedDeviceDiscountId",
  c.buyer_mother_name AS "buyerMotherName",
  c.buyer_national_id_registry AS "buyerNationalIdRegistry",
  c.buyer_national_id_issued_by AS "buyerNationalIdIssuedBy",
  c.buyer_national_id_issue_date AS "buyerNationalIdIssueDate",
  c.buyer_national_id_box AS "buyerNationalIdBox",
  c.buyer_birth_date AS "buyerBirthDate",
  c.buyer_gender AS "buyerGender",
  c.source_open_task_id AS "sourceOpenTaskId",
  c.source_task_offer_id AS "sourceTaskOfferId",
  c.sale_reference_number AS "saleReferenceNumber",
  c.contract_type AS "contractType",
  c.no_closing_reason_id AS "noClosingReasonId",
  c.sale_subtype AS "saleSubtype",
  c.receipt_number AS "receiptNumber",
  c.code AS "code",
  c.installed_device_id AS "installedDeviceId",
  c.created_by AS "createdById",
  c.sale_owner_id AS "saleOwnerId",
  c.offer_team_snapshot AS "offerTeamSnapshot",
  c.contract_referrers AS "contractReferrers",
  -- Physical device fields (source: installed_devices)
  d.serial_number              AS "serialNumber",
  d.status                     AS "deviceStatus",
  d.delivery_date              AS "deliveryDate",
  d.installation_date          AS "installationDate",
  d.installation_geo_unit_id   AS "installationGeoUnitId",
  d.installation_address_text  AS "installationAddressText",
  d.installation_lat           AS "installationLat",
  d.installation_lng           AS "installationLng",
  d.is_golden_warranty         AS "isGoldenWarranty",
  d.golden_warranty_end_date   AS "goldenWarrantyEndDate",
  d.contract_warranty_end_date AS "contractWarrantyEndDate",
  d.warranty_months            AS "warrantyMonths",
  d.warranty_visits            AS "warrantyVisits",
  (SELECT name FROM hr_users WHERE id = c.closing_employee_id LIMIT 1) AS "closingEmployeeName",
  (SELECT value FROM system_lists WHERE id = c.no_closing_reason_id LIMIT 1) AS "noClosingReasonName",
  (SELECT name FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchName",
  (SELECT name FROM hr_users WHERE id = c.created_by LIMIT 1) AS "createdByName"
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

function deriveContractStatus(
  status: unknown,
  closingEmployeeId: unknown,
): 'draft' | 'active' | 'cancelled' | 'completed' | 'discarded' {
  if (status === 'cancelled' || status === 'completed' || status === 'discarded') {
    return status;
  }
  return closingEmployeeId ? 'active' : 'draft';
}

function computeContractWarrantySnapshot(
  activatedAt: unknown,
  warrantyMonths: number | null,
): {
  activatedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  status: 'pending' | 'active';
} {
  const months = Number(warrantyMonths) || 0;
  if (!activatedAt || months <= 0) {
    return { activatedAt: null, startDate: null, endDate: null, status: 'pending' };
  }

  const activationMoment = new Date(String(activatedAt));
  if (Number.isNaN(activationMoment.getTime())) {
    return { activatedAt: null, startDate: null, endDate: null, status: 'pending' };
  }

  const endDate = new Date(activationMoment);
  endDate.setMonth(endDate.getMonth() + months);

  return {
    activatedAt: activationMoment.toISOString(),
    startDate: activationMoment.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    status: 'active',
  };
}

async function syncContractWarrantySnapshot(
  dbClient: any,
  contractId: number | string,
  warrantyMonthsStored: number | null,
  warrantyVisits: number | null,
) {
  const { rows } = await dbClient.query(
    `SELECT id, activated_at AS "activatedAt"
     FROM installed_devices
     WHERE contract_id = $1
     LIMIT 1`,
    [contractId],
  );

  const device = rows[0];
  if (!device) return;

  const snapshot = computeContractWarrantySnapshot(device.activatedAt, warrantyMonthsStored);

  await dbClient.query(
    `UPDATE installed_devices
        SET contract_warranty_end_date = $1
      WHERE id = $2`,
    [snapshot.endDate, device.id],
  );

  if (!warrantyMonthsStored) return;

  await dbClient.query(
    `INSERT INTO device_warranties
      (device_id, warranty_type, start_date, end_date, months, visits, status, activated_at)
     VALUES ($1, 'contract', $2, $3, $4, $5, $6, $7)
     ON CONFLICT (device_id, warranty_type) DO UPDATE SET
       months = EXCLUDED.months,
       visits = EXCLUDED.visits,
       start_date = CASE
         WHEN device_warranties.status IN ('cancelled', 'expired') THEN device_warranties.start_date
         ELSE COALESCE(device_warranties.start_date, EXCLUDED.start_date)
       END,
       end_date = CASE
         WHEN device_warranties.status IN ('cancelled', 'expired') THEN device_warranties.end_date
         ELSE EXCLUDED.end_date
       END,
       status = CASE
         WHEN device_warranties.status IN ('cancelled', 'expired') THEN device_warranties.status
         ELSE EXCLUDED.status
       END,
       activated_at = CASE
         WHEN device_warranties.status IN ('cancelled', 'expired') THEN device_warranties.activated_at
         ELSE COALESCE(device_warranties.activated_at, EXCLUDED.activated_at)
       END`,
    [
      device.id,
      snapshot.startDate,
      snapshot.endDate,
      warrantyMonthsStored,
      warrantyVisits,
      snapshot.status,
      snapshot.activatedAt,
    ],
  );
}

const projectedDueSelect = `
  i.id,
  i.contract_id AS "contractId",
  'Installment'::varchar AS type,
  i.due_date AS "scheduledDate",
  i.due_date AS "adjustedDate",
  i.amount_syp AS "originalAmount",
  i.remaining_balance AS "remainingBalance",
  i.collection_owner_id AS "assignedTelemarketerId",
  CASE
    WHEN i.remaining_balance <= 0 THEN 'Paid'
    WHEN COALESCE(i.paid_amount, 0) > 0 THEN 'Partial'
    WHEN i.status = 'overdue' OR i.due_date < CURRENT_DATE THEN 'Overdue'
    ELSE 'Pending'
  END AS status,
  FALSE AS escalated
`;

async function fetchProjectedDuesByContractIds(dbClient: any, contractIds: number[]) {
  if (contractIds.length === 0) return [] as any[];
  const { rows } = await dbClient.query(
    `SELECT ${projectedDueSelect}
       FROM contract_installments i
      WHERE i.contract_id = ANY($1)
        AND i.remaining_balance > 0
      ORDER BY i.contract_id, i.installment_number`,
    [contractIds],
  );
  return rows.map(mapDue);
}

/**
 * @swagger
 * components:
 *   schemas:
 *     Contract:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         contractNumber:
 *           type: string
 *         customerId:
 *           type: integer
 *         customerName:
 *           type: string
 *         contractDate:
 *           type: string
 *         sourceVisit:
 *           type: integer
 *         deviceModelId:
 *           type: integer
 *         deviceModelName:
 *           type: string
 *         serialNumber:
 *           type: string
 *         maintenancePlan:
 *           type: string
 *         basePrice:
 *           type: number
 *         finalPrice:
 *           type: number
 *         paymentType:
 *           type: string
 *         downPayment:
 *           type: number
 *         installmentsCount:
 *           type: integer
 *         deliveryDate:
 *           type: string
 *         installationDate:
 *           type: string
 *         status:
 *           type: string
 *         createdAt:
 *           type: string
 *         branchId:
 *           type: integer
 *         saleType:
 *           type: string
 *         saleSource:
 *           type: string
 *         discountId:
 *           type: integer
 *         closingEmployeeId:
 *           type: integer
 *         closingDate:
 *           type: string
 *         invoiceNotes:
 *           type: string
 *         installationGeoUnitId:
 *           type: integer
 *         installationAddressText:
 *           type: string
 *         installationLat:
 *           type: number
 *         installationLng:
 *           type: number
 *         appliedDeviceDiscountId:
 *           type: integer
 *         buyerMotherName:
 *           type: string
 *         buyerNationalIdRegistry:
 *           type: string
 *         buyerNationalIdIssuedBy:
 *           type: string
 *         buyerNationalIdIssueDate:
 *           type: string
 *         buyerNationalIdBox:
 *           type: string
 *         buyerBirthDate:
 *           type: string
 *         buyerGender:
 *           type: string
 *         sourceOpenTaskId:
 *           type: integer
 *         sourceTaskOfferId:
 *           type: integer
 *         saleReferenceNumber:
 *           type: string
 *         contractType:
 *           type: string
 *         noClosingReasonId:
 *           type: integer
 *         saleSubtype:
 *           type: string
 *         deviceStatus:
 *           type: string
 *         dues:
 *           type: array
 *           items:
 *             type: object
 *         client:
 *           type: object
 *         lineItems:
 *           type: array
 *           items:
 *             type: object
 *         paymentEntries:
 *           type: array
 *           items:
 *             type: object
 *         installments:
 *           type: array
 *           items:
 *             type: object
 *         discount:
 *           type: object
 */

/**
 * @swagger
 * /api/contracts:
 *   get:
 *     tags: [Contracts]
 *     summary: Retrieve list of contracts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: customerId
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Contract'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
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
  const { rows: contracts } = await pool.query(`SELECT ${contractSelect} FROM contracts c LEFT JOIN installed_devices d ON d.contract_id = c.id ${where} ORDER BY c.id DESC`, params);
  const ids = contracts.map((c: any) => c.id);
  const dues = await fetchProjectedDuesByContractIds(pool, ids);
  res.json(contracts.map((c: any) => ({ ...mapContract(c), dues: dues.filter((d: any) => d.contractId === c.id) })));
});

/**
 * @swagger
 * /api/contracts/{id}:
 *   get:
 *     tags: [Contracts]
 *     summary: Get contract details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contract'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows } = await pool.query(`SELECT ${contractSelect} FROM contracts c LEFT JOIN installed_devices d ON d.contract_id = c.id WHERE c.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.view_list', branchId: rows[0].branchId });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  const contract = mapContract(rows[0]);
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
            detailed_address AS "detailedAddress", rating, national_id AS "nationalId",
            occupation, spouse_occupation AS "spouseOccupation",
            data_quality AS "dataQuality", gender, father_name AS "fatherName",
            birth_date AS "birthDate", mother_name AS "motherName",
            national_id_registry AS "nationalIdRegistry",
            national_id_issued_by AS "nationalIdIssuedBy",
            national_id_issue_date AS "nationalIdIssueDate",
            national_id_box AS "nationalIdBox",
            nickname, first_name AS "firstName", last_name AS "lastName",
            referrers
       FROM clients WHERE id = $1`,
    [contract.customerId],
  );
  const client = clientRows[0] ?? null;

  // Client geo path (neighborhood → sub → district → governorate)
  let clientGeoPath: string[] = [];
  const clientGeoId = client?.neighborhood || client?.district;
  if (clientGeoId) {
    const { rows: cgRows } = await pool.query(
      `WITH RECURSIVE geo_path AS (
         SELECT id, name, parent_id, 1 AS depth FROM geo_units WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.parent_id, gp.depth + 1
         FROM geo_units g JOIN geo_path gp ON g.id = gp.parent_id
       )
       SELECT name FROM geo_path ORDER BY depth DESC`,
      [clientGeoId],
    );
    clientGeoPath = cgRows.map((r: any) => r.name);
  }

  // Client ownership display
  const { rows: ownerRows } = await pool.query(
    `SELECT u.name, COUNT(*) OVER() AS total
       FROM client_assignments ca
       JOIN hr_users u ON u.id = ca.hr_user_id
      WHERE ca.client_id = $1
      ORDER BY ca.assigned_at ASC LIMIT 1`,
    [contract.customerId],
  );
  let ownershipDisplay: string | null = null;
  if (ownerRows[0]) {
    const extra = Number(ownerRows[0].total) - 1;
    ownershipDisplay = extra > 0 ? `${ownerRows[0].name} +${extra}` : ownerRows[0].name;
  }
  // Resolve installation geo path (governorate → region → sub-district → neighborhood)
  let installationGeoPath: string[] = [];
  if (contract.installationGeoUnitId) {
    const { rows: geoRows } = await pool.query(
      `WITH RECURSIVE geo_path AS (
         SELECT id, name, parent_id, 1 AS depth FROM geo_units WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.parent_id, gp.depth + 1
         FROM geo_units g JOIN geo_path gp ON g.id = gp.parent_id
       )
       SELECT name FROM geo_path ORDER BY depth DESC`,
      [contract.installationGeoUnitId],
    );
    installationGeoPath = geoRows.map((r: any) => r.name);
  }

  const [lineItemResult, paymentEntriesResult, installmentsResult, discountResult] = await Promise.all([
    pool.query(
      `SELECT id, item_type AS "itemType", spare_part_id AS "sparePartId",
              description, quantity, unit_price AS "unitPrice", total_price AS "totalPrice",
              is_installed AS "isInstalled"
       FROM contract_line_items WHERE contract_id = $1 ORDER BY id`,
      [contract.id],
    ),
    pool.query(
      `SELECT id, method, currency, amount_value AS "amountValue", exchange_rate AS "exchangeRate",
              amount_syp AS "amountSyp", reference_number AS "referenceNumber",
              barter_name AS "barterName", barter_value_syp AS "barterValueSyp",
              received_by_employee_id AS "receivedByEmployeeId", received_at AS "receivedAt", notes,
              entry_type AS "entryType", installment_id AS "installmentId"
       FROM contract_payment_entries WHERE contract_id = $1 ORDER BY id`,
      [contract.id],
    ),
    pool.query(
      `SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate",
              amount_syp AS "amountSyp", status, paid_amount AS "paidAmount",
              remaining_balance AS "remainingBalance", confirmed,
              collection_owner_id AS "collectionOwnerId"
       FROM contract_installments WHERE contract_id = $1 ORDER BY installment_number`,
      [contract.id],
    ),
    contract.discountId
      ? pool.query(`SELECT id, label, percentage FROM device_discounts WHERE id = $1`, [contract.discountId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const dues = installmentsResult.rows
    .filter((inst: any) => Number(inst.remainingBalance) > 0)
    .map((inst: any) => mapDue({
      id: inst.id,
      contractId: contract.id,
      type: 'Installment',
      scheduledDate: inst.dueDate,
      adjustedDate: inst.dueDate,
      originalAmount: inst.amountSyp,
      remainingBalance: inst.remainingBalance,
      assignedTelemarketerId: inst.collectionOwnerId ?? null,
      status:
        inst.status === 'paid' ? 'Paid'
          : inst.status === 'partial' ? 'Partial'
            : inst.status === 'overdue' ? 'Overdue'
              : (inst.dueDate && new Date(inst.dueDate) < new Date() ? 'Overdue' : 'Pending'),
      escalated: false,
    }));

  res.json({
    ...contract,
    installationGeoPath,
    ownershipDisplay,
    dues,
    tasks,
    client: client ? {
      ...client,
      geoPath: clientGeoPath,
      referrersCount: Array.isArray(client.referrers) ? client.referrers.length : 0,
    } : null,
    lineItems: lineItemResult.rows,
    paymentEntries: paymentEntriesResult.rows,
    installments: installmentsResult.rows,
    discount: discountResult.rows[0] ?? null,
  });
});

/**
 * @swagger
 * /api/contracts:
 *   post:
 *     tags: [Contracts]
 *     summary: Create new contract
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractNumber, customerId, customerName, basePrice, finalPrice]
 *             properties:
 *               contractNumber:
 *                 type: string
 *               customerId:
 *                 type: integer
 *               customerName:
 *                 type: string
 *               contractDate:
 *                 type: string
 *               deviceModelId:
 *                 type: integer
 *               deviceModelName:
 *                 type: string
 *               basePrice:
 *                 type: number
 *               finalPrice:
 *                 type: number
 *               paymentType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contract'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('contracts.create'), async (req, res) => {
  const c = req.body;
  const derivedStatus = deriveContractStatus(c.status, c.closingEmployeeId);
  const targetBranchId = resolveTargetBranchId(req, res, c.branchId);
  if (targetBranchId == null) return;

  const { rows: branchStatus } = await pool.query(
    'SELECT status FROM branches WHERE id = $1',
    [targetBranchId],
  );
  if (branchStatus[0]?.status === 'inactive') {
    return res.status(400).json({ error: 'لا يمكن إنشاء عقد جديد — الفرع المحدد موقوف عن العمل' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const installationGeoUnitId = c.geoSelection?.neighborhoodId || null;
    const installationAddressText = c.detailedAddress?.trim() || null;
    const installationLat = c.mapPosition?.[0] ?? null;
    const installationLng = c.mapPosition?.[1] ?? null;

    const warrantyMonths = Number(c.warrantyMonths) || 0;
    const warrantyVisits = Number(c.warrantyVisits) > 0 ? Number(c.warrantyVisits) : null;
    const warrantyMonthsStored = warrantyMonths > 0 ? warrantyMonths : null;

    // Phase 2C: physical device fields go directly to installed_devices, not contracts.
    const { rows } = await client.query(
      `INSERT INTO contracts (contract_number, customer_id, customer_name, contract_date,
        source_visit, device_model_id, device_model_name, maintenance_plan,
        base_price, final_price, payment_type, down_payment, installments_count,
        status, branch_id, sale_type,
        discount_id, sale_source, closing_employee_id, invoice_notes,
        applied_device_discount_id,
        buyer_mother_name, buyer_national_id_registry, buyer_national_id_issued_by,
        buyer_national_id_issue_date, buyer_national_id_box,
        buyer_birth_date, buyer_gender,
        contract_type, source_open_task_id, source_task_offer_id, sale_reference_number,
        no_closing_reason_id, sale_subtype, created_by,
        sale_owner_id, offer_team_snapshot, contract_referrers)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
      RETURNING id`,
      [c.contractNumber, c.customerId, c.customerName, c.contractDate,
       c.sourceVisit || null, c.deviceModelId, c.deviceModelName,
       null, c.basePrice || 0, c.finalPrice || 0, c.paymentType,
       c.downPayment || 0, c.installmentsCount || 0,
       derivedStatus, targetBranchId, c.saleType || 'direct',
       c.discountId || null, c.saleSource || null,
       c.closingEmployeeId || null, c.invoiceNotes || null,
       c.appliedDeviceDiscountId || null,
       c.buyerMotherName || null, c.buyerNationalIdRegistry || null, c.buyerNationalIdIssuedBy || null,
       c.buyerNationalIdIssueDate || null, c.buyerNationalIdBox || null,
       c.buyerBirthDate || null, c.buyerGender || null,
       c.contractType || 'sale_contract', c.sourceOpenTaskId || null, c.sourceTaskOfferId || null, c.saleReferenceNumber || null,
       c.noClosingReasonId || null, c.saleSubtype || 'definitive',
       (req as any).user?.id || null,
       // DEC-CT-11 / DEC-CT-13 — frozen at creation; never updated later via this path.
       c.saleOwnerId || null,
       c.offerTeamSnapshot ? JSON.stringify(c.offerTeamSnapshot) : null,
       Array.isArray(c.selectedReferrers) ? JSON.stringify(c.selectedReferrers) : '[]']
    );
    const contractId = rows[0].id;

    // Trigger 191 fires after INSERT and creates the installed_devices row.
    // Write physical device fields directly to that row.
    if ((c.contractType || 'sale_contract') === 'sale_contract') {
      await client.query(
        `UPDATE installed_devices SET
          serial_number             = $1,
          status                    = $2,
          delivery_date             = $3,
          installation_date         = $4,
          installation_geo_unit_id  = $5,
          installation_address_text = $6,
          installation_lat          = $7,
          installation_lng          = $8,
          warranty_months           = $9,
          warranty_visits           = $10,
          contract_warranty_end_date = $11
        WHERE contract_id = $12`,
        [c.serialNumber || null, c.deviceStatus || 'pending_delivery',
         c.deliveryDate || null, c.installationDate || null,
         installationGeoUnitId, installationAddressText, installationLat, installationLng,
         warrantyMonthsStored, warrantyVisits, null,
         contractId]
      );
    }

    // Contract warranty becomes effective only after the device actually enters
    // service. We keep the legal entitlement at contract time, but the snapshot
    // dates/status are derived from installed_devices.activated_at.
    if ((c.contractType || 'sale_contract') === 'sale_contract') {
      await syncContractWarrantySnapshot(client, contractId, warrantyMonthsStored, warrantyVisits);
    }

    // Re-fetch with JOIN so installed_devices fields are included in the response
    const { rows: fetchRows } = await client.query(
      `SELECT ${contractSelect} FROM contracts c LEFT JOIN installed_devices d ON d.contract_id = c.id WHERE c.id = $1`,
      [contractId]
    );
    const contract = fetchRows[0];

    // Automatically create a device delivery task for sale contracts (Phase 3: include device_id).
    //
    // Constitution rule (DEC-CT-01 follow-up — see migration 211): a draft
    // contract has NO side effects. The delivery task is deferred until the
    // contract is approved via POST /api/contracts/:id/approve, which calls
    // createDeliveryTaskForContract() below.
    if (contract.contractType === 'sale_contract' && contract.status === 'active') {
      await createDeliveryTaskForContract(client, contract);
    }

    if (Array.isArray(c.lineItems) && c.lineItems.length > 0) {
      for (const item of c.lineItems) {
        await client.query(
          `INSERT INTO contract_line_items
            (contract_id, item_type, spare_part_id, description, quantity, unit_price, total_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [contract.id, item.itemType, item.sparePartId || null, item.description || null,
           item.quantity || 1, item.unitPrice || 0, item.totalPrice || (item.quantity * item.unitPrice) || 0],
        );
      }
    }

    if (Array.isArray(c.paymentEntries) && c.paymentEntries.length > 0) {
      for (const entry of c.paymentEntries) {
        await client.query(
          `INSERT INTO contract_payment_entries
            (contract_id, method, currency, amount_value, exchange_rate, amount_syp,
             reference_number, barter_name, barter_value_syp, received_by_employee_id, notes,
             entry_type, installment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [contract.id, entry.method, entry.currency || 'SYP', entry.amountValue || 0,
           entry.exchangeRate || null, entry.amountSyp || 0,
           entry.referenceNumber || null, entry.barterName || null,
           entry.barterValueSyp || null, entry.receivedByEmployeeId || null,
           entry.notes || null,
           entry.entryType || 'collection',
           entry.installmentId || null],
        );
      }
    }

    if (Array.isArray(c.installments) && c.installments.length > 0) {
      for (const inst of c.installments) {
        await client.query(
          `INSERT INTO contract_installments
            (contract_id, installment_number, due_date, amount_syp, remaining_balance)
           VALUES ($1,$2,$3,$4,$4)`,
          [contract.id, inst.installmentNumber, inst.dueDate, inst.amountSyp || 0],
        );
      }
    }

    // Financial constitution: `dues` are no longer stored independently.
    // Any legacy payload field is ignored; open receivables are projected from
    // contract_installments.remaining_balance instead.
    const duesResult = await fetchProjectedDuesByContractIds(client, [contract.id]);

    // OP promotion: client now has a contract → company ownership, no personal assignments
    if (c.customerId) {
      await promoteClientToLifecycleStatus(client, Number(c.customerId), 'OP');
    }

    await client.query('COMMIT');
    res.json({ ...mapContract(contract), dues: duesResult });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/contracts/{id}:
 *   put:
 *     tags: [Contracts]
 *     summary: Update contract details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contractNumber:
 *                 type: string
 *               customerName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Contract'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  // DEC-CT-15: we need the previous status to detect the draft→active transition
  // and trigger the auto-freeze of the legal copy.
  const { rows: existing } = await pool.query(
    'SELECT branch_id, status AS "prevStatus" FROM contracts WHERE id = $1',
    [req.params.id],
  );
  if (!existing[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  const prevStatus: string = existing[0].prevStatus;
  const c = req.body;
  const derivedStatus = deriveContractStatus(c.status, c.closingEmployeeId);

  // Physical device location (for installed_devices)
  const installationGeoUnitId = c.geoSelection?.neighborhoodId || c.installationGeoUnitId || null;
  const installationAddressText = c.detailedAddress?.trim() || c.installationAddressText || null;
  const installationLat = c.mapPosition?.[0] ?? c.installationLat ?? null;
  const installationLng = c.mapPosition?.[1] ?? c.installationLng ?? null;

  // Warranty payload: dates are derived from device activation, not contract date.
  const warrantyMonths = Number(c.warrantyMonths) || 0;
  const warrantyVisits = Number(c.warrantyVisits) > 0 ? Number(c.warrantyVisits) : null;
  const warrantyMonthsStored = warrantyMonths > 0 ? warrantyMonths : null;

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    // Phase 2C: contracts holds only financial/legal fields.
    await pgClient.query(
      `UPDATE contracts SET contract_number=$1, customer_id=$2, customer_name=$3,
        contract_date=$4, source_visit=$5, device_model_id=$6, device_model_name=$7,
        maintenance_plan=$8, base_price=$9, final_price=$10,
        payment_type=$11, down_payment=$12, installments_count=$13,
        status=$14,
        discount_id=$15, sale_source=$16,
        closing_employee_id=$17, invoice_notes=$18,
        applied_device_discount_id=$19,
        buyer_mother_name=$20, buyer_national_id_registry=$21, buyer_national_id_issued_by=$22,
        buyer_national_id_issue_date=$23, buyer_national_id_box=$24,
        buyer_birth_date=$25, buyer_gender=$26,
        contract_type=$27, source_open_task_id=$28, source_task_offer_id=$29,
        sale_reference_number=$30, no_closing_reason_id=$31, sale_subtype=$32,
        sale_owner_id=$33, contract_referrers=$34
        -- offer_team_snapshot is deliberately NOT updated here: DEC-CT-13 freezes it at creation.
      WHERE id=$35`,
      [c.contractNumber, c.customerId, c.customerName, c.contractDate,
       c.sourceVisit || null, c.deviceModelId, c.deviceModelName,
       c.maintenancePlan, c.basePrice, c.finalPrice, c.paymentType,
       c.downPayment || 0, c.installmentsCount || 0,
       derivedStatus,
       c.discountId || null, c.saleSource || null,
       c.closingEmployeeId || null, c.invoiceNotes || null,
       c.appliedDeviceDiscountId || null,
       c.buyerMotherName || null, c.buyerNationalIdRegistry || null, c.buyerNationalIdIssuedBy || null,
       c.buyerNationalIdIssueDate || null, c.buyerNationalIdBox || null,
       c.buyerBirthDate || null, c.buyerGender || null,
       c.contractType || 'sale_contract',
       c.sourceOpenTaskId || null,
       c.sourceTaskOfferId || null,
       c.saleReferenceNumber || null,
       c.noClosingReasonId || null,
       c.saleSubtype || 'definitive',
       c.saleOwnerId || null,
       Array.isArray(c.selectedReferrers) ? JSON.stringify(c.selectedReferrers) : '[]',
       req.params.id]
    );

    // Write physical device fields directly to installed_devices (Phase 2C)
    await pgClient.query(
      `UPDATE installed_devices SET
        serial_number             = $1,
        status                    = $2,
        delivery_date             = $3,
        installation_date         = $4,
        installation_geo_unit_id  = $5,
        installation_address_text = $6,
        installation_lat          = $7,
        installation_lng          = $8,
        warranty_months           = COALESCE($9, warranty_months),
        warranty_visits           = COALESCE($10, warranty_visits),
        contract_warranty_end_date = $11
      WHERE contract_id = $12`,
      [c.serialNumber || null, c.deviceStatus || 'pending_delivery',
       c.deliveryDate || null, c.installationDate || null,
       installationGeoUnitId, installationAddressText, installationLat, installationLng,
       warrantyMonthsStored, warrantyVisits, null,
       req.params.id]
    );

    // Respect DB-side activation/cancellation triggers and only synchronize the
    // warranty snapshot from the device's effective activation state.
    if ((c.contractType || 'sale_contract') === 'sale_contract') {
      await syncContractWarrantySnapshot(pgClient, Number(req.params.id), warrantyMonthsStored, warrantyVisits);
    }

    // DEC-CT-15: auto-freeze the legal copy at the draft→active transition.
    // freezeContractDocument() is idempotent — if a copy already exists,
    // nothing is written, so a redundant transition is safe.
    const newStatus = derivedStatus;
    if (prevStatus === 'draft' && newStatus === 'active') {
      try {
        await freezeContractDocument(pgClient, Number(req.params.id), (req as any).user?.id ?? null);
      } catch (freezeErr: any) {
        // Don't abort the contract update if freezing fails (e.g. missing template
        // for a sale_subtype we haven't implemented yet). Log and continue.
        console.warn('[contracts] auto-freeze skipped for contract', req.params.id, ':', freezeErr?.message);
      }
    }

    await pgClient.query('COMMIT');
  } catch (err) {
    await pgClient.query('ROLLBACK');
    throw err;
  } finally {
    pgClient.release();
  }

  const { rows: updatedRows } = await pool.query(
    `SELECT ${contractSelect} FROM contracts c LEFT JOIN installed_devices d ON d.contract_id = c.id WHERE c.id = $1`,
    [req.params.id]
  );
  res.json(updatedRows[0]);
});

/**
 * @swagger
 * /api/contracts/{id}/payment-entries:
 *   post:
 *     tags: [Contracts]
 *     summary: Replace payment entries for contract
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entries]
 *             properties:
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     method:
 *                       type: string
 *                     amountValue:
 *                       type: number
 *                     amountSyp:
 *                       type: number
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/:id/payment-entries', requirePermission('contracts.edit'), async (req, res) => {
  const contractId = Number(req.params.id);
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Invalid entries' });
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    await pgClient.query('DELETE FROM contract_payment_entries WHERE contract_id = $1', [contractId]);
    for (const entry of entries) {
      await pgClient.query(
        `INSERT INTO contract_payment_entries
          (contract_id, method, currency, amount_value, exchange_rate, amount_syp,
           reference_number, barter_name, barter_value_syp, received_by_employee_id, notes,
           entry_type, installment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [contractId, entry.method, entry.currency || 'SYP', entry.amountValue || 0,
         entry.exchangeRate || null, entry.amountSyp || 0,
         entry.referenceNumber || null, entry.barterName || null,
         entry.barterValueSyp || null, entry.receivedByEmployeeId || null,
         entry.notes || null,
         entry.entryType || 'collection',
         entry.installmentId || null],
      );
    }
    await pgClient.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pgClient.query('ROLLBACK');
    throw err;
  } finally {
    pgClient.release();
  }
});

/**
 * @swagger
 * /api/contracts/{id}/installments:
 *   post:
 *     tags: [Contracts]
 *     summary: Replace unconfirmed installments for contract
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [installments]
 *             properties:
 *               installments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     installmentNumber:
 *                       type: integer
 *                     dueDate:
 *                       type: string
 *                     amountSyp:
 *                       type: number
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/:id/installments', requirePermission('contracts.edit'), async (req, res) => {
  const contractId = Number(req.params.id);
  const { installments } = req.body;
  if (!Array.isArray(installments)) return res.status(400).json({ error: 'Invalid installments' });
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    await pgClient.query('DELETE FROM contract_installments WHERE contract_id = $1 AND confirmed = FALSE', [contractId]);
    for (const inst of installments) {
      await pgClient.query(
        `INSERT INTO contract_installments
          (contract_id, installment_number, due_date, amount_syp, remaining_balance)
         VALUES ($1,$2,$3,$4,$4)`,
        [contractId, inst.installmentNumber, inst.dueDate, inst.amountSyp || 0],
      );
    }
    await pgClient.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await pgClient.query('ROLLBACK');
    throw err;
  } finally {
    pgClient.release();
  }
});

/**
 * @swagger
 * /api/contracts/{id}/installments/confirm:
 *   post:
 *     tags: [Contracts]
 *     summary: Confirm all installments for contract
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/:id/installments/confirm', requirePermission('contracts.edit'), async (req, res) => {
  const contractId = Number(req.params.id);
  await pool.query(
    'UPDATE contract_installments SET confirmed = TRUE WHERE contract_id = $1',
    [contractId],
  );
  res.json({ success: true });
});

/**
 * @swagger
 * /api/contracts/{id}:
 *   delete:
 *     tags: [Contracts]
 *     summary: Delete contract by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('contracts.delete'), async (req, res) => {
  const authContext = req.authContext!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM contracts WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.delete', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  await pool.query('DELETE FROM contracts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/contracts/{id}/line-items/{itemId}/installation:
 *   put:
 *     tags: [Contracts]
 *     summary: Update contract line item installation status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Contract ID
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Line Item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isInstalled]
 *             properties:
 *               isInstalled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 isInstalled:
 *                   type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id/line-items/:itemId/installation', requirePermission('contracts.edit'), async (req, res) => {
  const contractId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { isInstalled } = req.body;
  
  if (typeof isInstalled !== 'boolean') {
    return res.status(400).json({ error: 'isInstalled must be a boolean' });
  }

  const authContext = req.authContext!;
  const { rows: existing } = await pool.query('SELECT branch_id FROM contracts WHERE id = $1', [contractId]);
  if (!existing[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  
  const access = authorize(authContext, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });

  await pool.query(
    `UPDATE contract_line_items 
     SET is_installed = $1 
     WHERE id = $2 AND contract_id = $3`,
    [isInstalled, itemId, contractId]
  );

  res.json({ success: true, isInstalled });
});

// ──────────────────────────────────────────────────────────────────────────
// Draft → active / discarded workflow (DEC-CT-01 follow-up).
//
// A contract created with status='draft' has zero side effects (see
// migration 211). Two terminal moves are possible from draft:
//
//   POST /api/contracts/:id/approve   draft → active
//   POST /api/contracts/:id/reject    draft → discarded
//
// Both are gated by the dedicated `contracts.approve` permission (seeded by
// migration 212) so not every editor can flip the legal state of a contract.
//
// On approve the route:
//   • sets closing_employee_id (from body, falling back to current user)
//   • flips status='active'  → DB triggers materialize installed_devices,
//                              the warranty cascade, and replay installment
//                              recompute (so payments saved during draft
//                              now take effect).
//   • creates the device_delivery open_task (app-side, mirroring the POST
//     path so behavior is identical to "born active" contracts).
//   • freezes the legal contract document (DEC-CT-15).
// ──────────────────────────────────────────────────────────────────────────

async function createDeliveryTaskForContract(db: any, contract: any) {
  const dueDate = contract.deliveryDate
    || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { rows: devIdRows } = await db.query(
    'SELECT id FROM installed_devices WHERE contract_id = $1 LIMIT 1',
    [contract.id],
  );
  const deliveryDeviceId = devIdRows[0]?.id ?? null;
  await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, task_type, task_family, reason, status, due_date,
       source, origin, contract_id, device_id
     ) VALUES ($1, $2, 'device_delivery', 'delivery', 'service_request', 'open', $3,
               'system', 'manual_entry', $4, $5)`,
    [contract.customerId, contract.branchId, dueDate, contract.id, deliveryDeviceId],
  );
}

router.post('/:id/approve', requirePermission('contracts.approve'), async (req, res) => {
  const authContext = req.authContext!;
  const contractId = Number(req.params.id);
  if (!Number.isInteger(contractId) || contractId <= 0) {
    return res.status(400).json({ error: 'id غير صالح' });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    // Pessimistic lock so two approvers can't race.
    const { rows: cur } = await pgClient.query(
      `SELECT id, status, contract_type, customer_id, branch_id, closing_employee_id,
              delivery_date
         FROM contracts WHERE id = $1 FOR UPDATE`,
      [contractId],
    );
    if (!cur[0]) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'العقد غير موجود' });
    }
    const c = cur[0];

    const access = authorize(authContext, { permission: 'contracts.approve', branchId: c.branch_id });
    if (!access.allowed) {
      await pgClient.query('ROLLBACK');
      return res.status(403).json({ error: 'غير مسموح' });
    }

    if (c.status !== 'draft') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({
        error: `لا يمكن الموافقة على عقد بحالة "${c.status}". الموافقة متاحة فقط للعقود بحالة "draft".`,
      });
    }

    const incomingCloser = req.body?.closingEmployeeId
      ? Number(req.body.closingEmployeeId)
      : null;
    const closerId =
      incomingCloser
      ?? c.closing_employee_id
      ?? (authContext as any).userId
      ?? null;

    if (!closerId) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({ error: 'closingEmployeeId مطلوب للموافقة على العقد' });
    }

    // Flip status — this fires the DB triggers (211/204/etc.) that
    // materialize the installed_devices row, cascade warranties, and replay
    // installment balance recompute.
    await pgClient.query(
      `UPDATE contracts
         SET status = 'active',
             closing_employee_id = $1,
             closing_date = NOW()
       WHERE id = $2`,
      [closerId, contractId],
    );

    // Refresh after triggers settle.
    const { rows: after } = await pgClient.query(
      `SELECT c.id, c.contract_type AS "contractType", c.customer_id AS "customerId",
              c.branch_id AS "branchId", c.delivery_date AS "deliveryDate",
              c.status
         FROM contracts c WHERE c.id = $1`,
      [contractId],
    );
    const refreshed = after[0];

    // App-side side effects: delivery task (mirrors the POST path).
    if (refreshed.contractType === 'sale_contract') {
      await createDeliveryTaskForContract(pgClient, refreshed);
    }

    // Freeze the legal copy (DEC-CT-15).
    try {
      await freezeContractDocument(pgClient, contractId, (req as any).user?.id ?? null);
    } catch (freezeErr: any) {
      console.warn('[contracts] auto-freeze on approve skipped for', contractId, ':', freezeErr?.message);
    }

    await pgClient.query('COMMIT');
    res.json({ success: true, contractId, status: 'active', closingEmployeeId: closerId });
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    console.error('[contracts] approve failed:', err);
    res.status(500).json({ error: 'فشل اعتماد العقد', detail: err?.message });
  } finally {
    pgClient.release();
  }
});

router.post('/:id/reject', requirePermission('contracts.approve'), async (req, res) => {
  const authContext = req.authContext!;
  const contractId = Number(req.params.id);
  if (!Number.isInteger(contractId) || contractId <= 0) {
    return res.status(400).json({ error: 'id غير صالح' });
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');

    const { rows: cur } = await pgClient.query(
      `SELECT id, status, branch_id FROM contracts WHERE id = $1 FOR UPDATE`,
      [contractId],
    );
    if (!cur[0]) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'العقد غير موجود' });
    }
    const c = cur[0];

    const access = authorize(authContext, { permission: 'contracts.approve', branchId: c.branch_id });
    if (!access.allowed) {
      await pgClient.query('ROLLBACK');
      return res.status(403).json({ error: 'غير مسموح' });
    }

    if (c.status !== 'draft') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({
        error: `لا يمكن رفض عقد بحالة "${c.status}". الرفض متاح فقط للعقود بحالة "draft".`,
      });
    }

    const reason = (req.body?.reason ?? '').toString().trim() || null;

    await pgClient.query(
      `UPDATE contracts
         SET status = 'discarded',
             invoice_notes = COALESCE(invoice_notes, '') ||
               CASE WHEN $1::text IS NULL THEN '' ELSE E'\n[rejected] ' || $1::text END
       WHERE id = $2`,
      [reason, contractId],
    );

    await pgClient.query('COMMIT');
    res.json({ success: true, contractId, status: 'discarded' });
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    console.error('[contracts] reject failed:', err);
    res.status(500).json({ error: 'فشل رفض العقد', detail: err?.message });
  } finally {
    pgClient.release();
  }
});

export default router;
