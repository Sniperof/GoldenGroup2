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
  c.sale_type AS "saleType", c.sale_source AS "saleSource",
  c.discount_id AS "discountId",
  c.closing_employee_id AS "closingEmployeeId",
  c.closing_date AS "closingDate",
  c.invoice_notes AS "invoiceNotes",
  c.installation_geo_unit_id AS "installationGeoUnitId",
  c.installation_address_text AS "installationAddressText",
  c.installation_lat AS "installationLat",
  c.installation_lng AS "installationLng",
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
  c.device_status AS "deviceStatus"
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
  const { rows: contracts } = await pool.query(`SELECT ${contractSelect} FROM contracts c ${where} ORDER BY c.id DESC`, params);
  const ids = contracts.map((c: any) => c.id);
  const { rows: dues } = ids.length
    ? await pool.query(`SELECT ${dueSelect} FROM dues WHERE contract_id = ANY($1) ORDER BY contract_id, scheduled_date`, [ids])
    : { rows: [] as any[] };
  res.json(contracts.map((c: any) => ({ ...mapContract(c), dues: dues.filter((d: any) => d.contractId === c.id).map(mapDue) })));
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
              received_by_employee_id AS "receivedByEmployeeId", received_at AS "receivedAt", notes
       FROM contract_payment_entries WHERE contract_id = $1 ORDER BY id`,
      [contract.id],
    ),
    pool.query(
      `SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate",
              amount_syp AS "amountSyp", status, paid_amount AS "paidAmount",
              remaining_balance AS "remainingBalance", confirmed
       FROM contract_installments WHERE contract_id = $1 ORDER BY installment_number`,
      [contract.id],
    ),
    contract.discountId
      ? pool.query(`SELECT id, label, percentage FROM device_discounts WHERE id = $1`, [contract.discountId])
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  res.json({
    ...contract,
    dues: dues.map(mapDue),
    tasks,
    client,
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
        installation_geo_unit_id, installation_address_text, installation_lat, installation_lng,
        discount_id, sale_source, closing_employee_id, invoice_notes,
        applied_device_discount_id,
        buyer_mother_name, buyer_national_id_registry, buyer_national_id_issued_by,
        buyer_national_id_issue_date, buyer_national_id_box,
        buyer_birth_date, buyer_gender,
        contract_type, source_open_task_id, source_task_offer_id, sale_reference_number, no_closing_reason_id, sale_subtype,
        device_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42)
      RETURNING ${contractSelect.replace(/c\./g, '')}`,
      [c.contractNumber, c.customerId, c.customerName, c.contractDate,
       c.sourceVisit || null, c.deviceModelId, c.deviceModelName, c.serialNumber,
       c.maintenancePlan, c.basePrice || 0, c.finalPrice || 0, c.paymentType,
       c.downPayment || 0, c.installmentsCount || 0, c.deliveryDate || null, c.installationDate || null,
       c.status || 'active', targetBranchId, c.saleType || 'direct',
       installationGeoUnitId, installationAddressText, installationLat, installationLng,
       c.discountId || null, c.saleSource || null,
       c.closingEmployeeId || null, c.invoiceNotes || null,
       c.appliedDeviceDiscountId || null,
       c.buyerMotherName || null, c.buyerNationalIdRegistry || null, c.buyerNationalIdIssuedBy || null,
       c.buyerNationalIdIssueDate || null, c.buyerNationalIdBox || null,
       c.buyerBirthDate || null, c.buyerGender || null,
       c.contractType || 'sale_contract', c.sourceOpenTaskId || null, c.sourceTaskOfferId || null, c.saleReferenceNumber || null,
       c.noClosingReasonId || null, c.saleSubtype || 'definitive',
       c.deviceStatus || 'pending_delivery']
    );
    const contract = rows[0];

    // Automatically create a device delivery task for sale contracts
    if (contract.contractType === 'sale_contract') {
      const dueDate = c.deliveryDate || new Date(Date.now() + 3*24*60*60*1000).toISOString().split('T')[0];
      await client.query(
        `INSERT INTO open_tasks (
           client_id, branch_id, task_type, task_family, reason, status, due_date, source, origin, contract_id
         ) VALUES ($1, $2, 'device_delivery', 'delivery', 'service_request', 'open', $3, 'system', 'manual_entry', $4)`,
        [contract.customerId, contract.branchId, dueDate, contract.id]
      );
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
             reference_number, barter_name, barter_value_syp, received_by_employee_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [contract.id, entry.method, entry.currency || 'SYP', entry.amountValue || 0,
           entry.exchangeRate || null, entry.amountSyp || 0,
           entry.referenceNumber || null, entry.barterName || null,
           entry.barterValueSyp || null, entry.receivedByEmployeeId || null,
           entry.notes || null],
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
      installation_lat=$20, installation_lng=$21,
      discount_id=$22, sale_source=$23,
      closing_employee_id=$24, invoice_notes=$25,
      applied_device_discount_id=$26,
      buyer_mother_name=$27, buyer_national_id_registry=$28, buyer_national_id_issued_by=$29,
      buyer_national_id_issue_date=$30, buyer_national_id_box=$31,
      buyer_birth_date=$32, buyer_gender=$33,
      contract_type=$34, source_open_task_id=$35, source_task_offer_id=$36,
      sale_reference_number=$37, no_closing_reason_id=$38, sale_subtype=$39,
      device_status=$40
    WHERE id=$41 RETURNING ${contractSelect.replace(/c\./g, '')}`,
    [c.contractNumber, c.customerId, c.customerName, c.contractDate,
     c.sourceVisit || null, c.deviceModelId, c.deviceModelName, c.serialNumber,
     c.maintenancePlan, c.basePrice, c.finalPrice, c.paymentType,
     c.downPayment || 0, c.installmentsCount || 0, c.deliveryDate, c.installationDate,
     c.status || 'active',
     installationGeoUnitId, installationAddressText, installationLat, installationLng,
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
     c.deviceStatus || 'pending_delivery',
     req.params.id]
  );
  res.json(rows[0]);
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
           reference_number, barter_name, barter_value_syp, received_by_employee_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [contractId, entry.method, entry.currency || 'SYP', entry.amountValue || 0,
         entry.exchangeRate || null, entry.amountSyp || 0,
         entry.referenceNumber || null, entry.barterName || null,
         entry.barterValueSyp || null, entry.receivedByEmployeeId || null,
         entry.notes || null],
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

export default router;
