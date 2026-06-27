import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, resolveTargetBranchId, getOrBuildAuthContext } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';
import { assertGeoUnitInScope } from '../services/geoScopeService.js';
import { assertDeviceModelInScope } from '../services/deviceScopeService.js';
import { promoteClientToLifecycleStatus } from '../services/clientLifecycleService.js';
import { freezeContractDocument } from './contractDocuments.js'; // DEC-CT-15
import { persistOpenTaskSnapshots } from './openTasks.js';
import { createInstallmentCollectionTasksForContract } from '../services/installmentCollectionTasks.js';
import { syncContractMovements, recordMovement } from '../services/financialMovements.js';

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
  c.service_branch_id AS "serviceBranchId",
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
  c.draft_device_payload AS "draftDevicePayload",
  -- Physical device fields (source: installed_devices)
  COALESCE(d.serial_number, c.draft_device_payload->>'serialNumber') AS "serialNumber",
  COALESCE(d.status, c.draft_device_payload->>'deviceStatus') AS "deviceStatus",
  COALESCE(d.delivery_date, NULLIF(c.draft_device_payload->>'deliveryDate', '')::date) AS "deliveryDate",
  COALESCE(d.installation_date, NULLIF(c.draft_device_payload->>'installationDate', '')::date) AS "installationDate",
  COALESCE(d.installation_geo_unit_id, NULLIF(c.draft_device_payload->>'installationGeoUnitId', '')::int) AS "installationGeoUnitId",
  COALESCE(d.installation_address_text, c.draft_device_payload->>'installationAddressText') AS "installationAddressText",
  COALESCE(d.installation_lat, NULLIF(c.draft_device_payload->>'installationLat', '')::numeric) AS "installationLat",
  COALESCE(d.installation_lng, NULLIF(c.draft_device_payload->>'installationLng', '')::numeric) AS "installationLng",
  d.is_golden_warranty         AS "isGoldenWarranty",
  d.golden_warranty_end_date   AS "goldenWarrantyEndDate",
  d.contract_warranty_end_date AS "contractWarrantyEndDate",
  COALESCE(d.warranty_months, NULLIF(c.draft_device_payload->>'warrantyMonths', '')::int) AS "warrantyMonths",
  COALESCE(d.warranty_visits, NULLIF(c.draft_device_payload->>'warrantyVisits', '')::int) AS "warrantyVisits",
  (SELECT name FROM hr_users WHERE id = c.closing_employee_id LIMIT 1) AS "closingEmployeeName",
  (SELECT value FROM system_lists WHERE id = c.no_closing_reason_id LIMIT 1) AS "noClosingReasonName",
  (SELECT name FROM branches WHERE id = c.branch_id LIMIT 1) AS "branchName",
  (SELECT name FROM branches WHERE id = c.service_branch_id LIMIT 1) AS "serviceBranchName",
  (SELECT name FROM hr_users WHERE id = c.created_by LIMIT 1) AS "createdByName",
  (SELECT name FROM employees WHERE id = c.sale_owner_id LIMIT 1) AS "saleOwnerName"
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

async function loadDraftContractForEdit(db: any, contractId: number | string, lock = false) {
  const { rows } = await db.query(
    `SELECT id, status FROM contracts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [contractId],
  );
  return rows[0] ?? null;
}

function deriveContractStatus(
  status: unknown,
  _closingEmployeeId: unknown,
): 'draft' | 'active' | 'cancelled' | 'completed' | 'discarded' {
  if (status === 'cancelled' || status === 'completed' || status === 'discarded') {
    return status;
  }
  // SECURITY: create/edit must NEVER flip a contract to 'active'. Activation
  // (التسكير) is exclusively the POST /:id/approve path, which enforces
  // contracts.close, takes a pessimistic lock, and re-runs
  // collectApprovalIssues. Previously `closingEmployeeId ? 'active' : 'draft'`
  // let anyone with only contracts.edit activate a contract by passing a closer,
  // bypassing the close capability and the approval re-validation. The closer is
  // still stored as a *proposed* closer; it no longer changes status here.
  return 'draft';
}

// Plan 2026-06-10 §C — buyer national ID must be exactly 11 digits when present.
// Empty/null is allowed (the field itself is optional in draft + cash modes).
function normalizeNationalId(value: unknown): { ok: boolean; value: string | null } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const str = String(value).trim();
  if (!str) return { ok: true, value: null };
  if (!/^\d{11}$/.test(str)) return { ok: false, value: str };
  return { ok: true, value: str };
}

async function syncClientLegalIdentity(
  dbClient: any,
  customerId: unknown,
  input: {
    fatherName?: unknown;
    nationalId?: unknown;
    motherName?: unknown;
    birthDate?: unknown;
    gender?: unknown;
    nationalIdRegistry?: unknown;
    nationalIdIssuedBy?: unknown;
    nationalIdIssueDate?: unknown;
    nationalIdBox?: unknown;
  },
) {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) return;

  const fatherName = typeof input.fatherName === 'string' ? input.fatherName.trim() : '';
  const nationalIdCheck = normalizeNationalId(input.nationalId);
  const nationalId = nationalIdCheck.ok ? nationalIdCheck.value : null;
  const motherName = typeof input.motherName === 'string' ? input.motherName.trim() : '';
  const birthDate = typeof input.birthDate === 'string' && input.birthDate.trim() ? input.birthDate.trim() : null;
  const gender = input.gender === 'male' || input.gender === 'female' ? input.gender : null;
  const nationalIdRegistry = typeof input.nationalIdRegistry === 'string' ? input.nationalIdRegistry.trim() : '';
  const nationalIdIssuedBy = typeof input.nationalIdIssuedBy === 'string' ? input.nationalIdIssuedBy.trim() : '';
  const nationalIdIssueDate = typeof input.nationalIdIssueDate === 'string' && input.nationalIdIssueDate.trim()
    ? input.nationalIdIssueDate.trim()
    : null;
  const nationalIdBox = typeof input.nationalIdBox === 'string' ? input.nationalIdBox.trim() : '';

  if (
    !fatherName && !nationalId && !motherName && !birthDate && !gender
    && !nationalIdRegistry && !nationalIdIssuedBy && !nationalIdIssueDate && !nationalIdBox
  ) return;

  await dbClient.query(
    `UPDATE clients
        SET father_name = COALESCE(NULLIF($2, ''), father_name),
            national_id = COALESCE(NULLIF($3, ''), national_id),
            mother_name = COALESCE(NULLIF($4, ''), mother_name),
            birth_date = COALESCE($5::date, birth_date),
            gender = COALESCE($6, gender),
            national_id_registry = COALESCE(NULLIF($7, ''), national_id_registry),
            national_id_issued_by = COALESCE(NULLIF($8, ''), national_id_issued_by),
            national_id_issue_date = COALESCE($9::date, national_id_issue_date),
            national_id_box = COALESCE(NULLIF($10, ''), national_id_box)
      WHERE id = $1`,
    [
      id,
      fatherName,
      nationalId,
      motherName,
      birthDate,
      gender,
      nationalIdRegistry,
      nationalIdIssuedBy,
      nationalIdIssueDate,
      nationalIdBox,
    ],
  );
}

// Plan 2026-06-10 §4 — sale_owner_id is the deal originator (an EMPLOYEE, with
// or without a system account — migration 298 repointed the FK to employees).
// Attributing the sale to anyone OTHER than the current user's own employee
// record requires the contracts.assign_sale_owner permission. The self-shortcut
// compares against the user's employee_id because both ids now live in the
// employees.id space.
function canAssignSaleOwner(
  authContext: any,
  branchId: number | null,
  currentUserEmployeeId: number | null,
  desiredOwnerEmployeeId: number | null,
): boolean {
  if (desiredOwnerEmployeeId == null) return true;
  if (currentUserEmployeeId != null && desiredOwnerEmployeeId === currentUserEmployeeId) return true;
  const check = authorize(authContext, { permission: 'contracts.assign_sale_owner', branchId });
  return check.allowed;
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
     ON CONFLICT (device_id) WHERE warranty_type = 'contract' DO UPDATE SET
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

  // Plan §3 — NID length guard (always, when provided).
  const nidCheck = normalizeNationalId(c.nationalId ?? c.buyerNationalId);
  if (!nidCheck.ok) {
    return res.status(400).json({ error: 'الرقم الوطني يجب أن يكون 11 رقماً.' });
  }

  // Plan §4 — sale_owner_id assignment requires contracts.assign_sale_owner
  // unless the value matches the authenticated user.
  const requestedSaleOwnerId = c.saleOwnerId ? Number(c.saleOwnerId) : null;
  const currentUserEmployeeId = (req as any).user?.employeeId ?? null;
  if (!canAssignSaleOwner((req as any).authContext, targetBranchId, currentUserEmployeeId, requestedSaleOwnerId)) {
    return res.status(403).json({ error: 'لا تملك صلاحية نسبة البيعة لموظف آخر' });
  }

  const { rows: branchStatus } = await pool.query(
    'SELECT status FROM branches WHERE id = $1',
    [targetBranchId],
  );
  if (branchStatus[0]?.status === 'inactive') {
    return res.status(400).json({ error: 'لا يمكن إنشاء عقد جديد — الفرع المحدد موقوف عن العمل' });
  }

  // Geo-coverage enforcement — installation_geo_unit_id must be inside the
  // target branch's coverage. Enforced against the target branch so that
  // cross-branch creates respect the recipient's coverage map.
  const installationGeoUnitForCheck =
    c.installationGeoUnitId ?? c.installation_geo_unit_id ?? null;
  if (installationGeoUnitForCheck && (req as any).authContext) {
    const geoCheck = await assertGeoUnitInScope(
      (req as any).authContext,
      installationGeoUnitForCheck,
      'geo_units.lookup',
      targetBranchId,
    );
    if (!geoCheck.allowed) {
      return res.status(403).json({
        error: 'موقع تَركيب الجهاز خارج نِطاق تَغطية الفَرع المُستهدف',
        code: geoCheck.reason,
      });
    }
  }

  // Installation address must be precise to the neighborhood (الحي / level 4) —
  // a governorate/district is not specific enough for a device install.
  if (installationGeoUnitForCheck) {
    const { rows: lvl } = await pool.query('SELECT level FROM geo_units WHERE id = $1', [installationGeoUnitForCheck]);
    if (!lvl[0] || Number(lvl[0].level) !== 4) {
      return res.status(400).json({
        error: 'عنوان التركيب يجب أن يكون على مستوى الحي',
        code: 'installation_geo_not_neighborhood',
      });
    }
  }

  // Device model must be authorized for the actor's branch/department scope —
  // UI filtering is not security (devices constitution §6.1).
  const deviceModelForCheck = c.deviceModelId ?? c.device_model_id ?? null;
  if (deviceModelForCheck && (req as any).authContext) {
    const devCheck = await assertDeviceModelInScope((req as any).authContext, deviceModelForCheck, targetBranchId);
    if (!devCheck.allowed) {
      return res.status(403).json({
        error: 'نموذج الجهاز غير مصرّح به ضمن نطاقك',
        code: devCheck.reason,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SECURITY (anti double-sale): one accepted device-demo offer / sale
    // reference may back only ONE live contract. Reject if a non-discarded
    // contract already references the same source_task_offer_id OR
    // sale_reference_number. The open-tasks read filtering is UX only — this
    // server check is the real guard against converting an already-sold offer
    // into a second contract.
    const dupOfferId = c.sourceTaskOfferId ? Number(c.sourceTaskOfferId) : null;
    const dupSaleRef = typeof c.saleReferenceNumber === 'string' && c.saleReferenceNumber.trim()
      ? c.saleReferenceNumber.trim()
      : null;
    if (dupOfferId != null || dupSaleRef != null) {
      const { rows: dup } = await client.query(
        `SELECT id, contract_number FROM contracts
          WHERE status NOT IN ('discarded', 'cancelled')
            AND (
              ($1::bigint IS NOT NULL AND source_task_offer_id = $1)
              OR ($2::text IS NOT NULL AND sale_reference_number = $2)
            )
          LIMIT 1`,
        [dupOfferId, dupSaleRef],
      );
      if (dup[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'هذا العرض مرتبط بعقد سابق — لا يمكن إنشاء عقد آخر على نفس البيعة',
          code: 'offer_already_contracted',
          existingContractId: dup[0].id,
          existingContractNumber: dup[0].contract_number,
        });
      }
    }

    const draftDevicePayload = buildDraftDevicePayload(c);
    await syncClientLegalIdentity(client, c.customerId, {
      fatherName: c.fatherName,
      nationalId: c.nationalId ?? c.buyerNationalId,
      motherName: c.buyerMotherName,
      birthDate: c.buyerBirthDate,
      gender: c.buyerGender,
      nationalIdRegistry: c.buyerNationalIdRegistry,
      nationalIdIssuedBy: c.buyerNationalIdIssuedBy,
      nationalIdIssueDate: c.buyerNationalIdIssueDate,
      nationalIdBox: c.buyerNationalIdBox,
    });

    // Draft contracts do not have installed_devices rows yet. Keep the entered
    // physical-device fields on the contract until approval materializes the row.
    const { rows } = await client.query(
      `INSERT INTO contracts (contract_number, customer_id, customer_name, contract_date,
        source_visit, device_model_id, device_model_name, maintenance_plan,
        base_price, final_price, payment_type, down_payment, installments_count,
        status, branch_id, service_branch_id, sale_type,
        discount_id, sale_source, closing_employee_id, invoice_notes,
        applied_device_discount_id,
        buyer_mother_name, buyer_national_id_registry, buyer_national_id_issued_by,
        buyer_national_id_issue_date, buyer_national_id_box,
        buyer_birth_date, buyer_gender,
        contract_type, source_open_task_id, source_task_offer_id, sale_reference_number,
        no_closing_reason_id, sale_subtype, created_by,
        sale_owner_id, offer_team_snapshot, contract_referrers, draft_device_payload)
      VALUES (NULLIF($1::text, ''),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)
      RETURNING id`,
      [c.contractNumber, c.customerId, c.customerName, c.contractDate,
       c.sourceVisit || null, c.deviceModelId, c.deviceModelName,
       null, c.basePrice || 0, c.finalPrice || 0, c.paymentType,
       c.downPayment || 0, c.installmentsCount || 0,
       derivedStatus, targetBranchId,
       // Service branch defaults to the sale branch (= client = entering employee
       // branch) until cross-branch service is wired up. Seeds the device branch.
       c.serviceBranchId ?? targetBranchId,
       c.saleType || 'direct',
       c.discountId || null, c.saleSource || null,
       c.closingEmployeeId || null, c.invoiceNotes || null,
       c.appliedDeviceDiscountId || null,
       c.buyerMotherName || null, c.buyerNationalIdRegistry || null, c.buyerNationalIdIssuedBy || null,
       c.buyerNationalIdIssueDate || null, c.buyerNationalIdBox || null,
       c.buyerBirthDate || null, c.buyerGender || null,
       c.contractType || 'sale_contract', c.sourceOpenTaskId || null, c.sourceTaskOfferId || null, c.saleReferenceNumber || null,
       c.noClosingReasonId || null, c.saleSubtype || 'definitive',
       (req as any).user?.id || null,
       // Plan 2026-06-10 §4 — sale_owner_id is editable while draft and frozen at approve.
       // Permission already enforced at the route entry via canAssignSaleOwner().
       requestedSaleOwnerId,
       c.offerTeamSnapshot ? JSON.stringify(c.offerTeamSnapshot) : null,
       // Single-mediator rule: a sale has exactly one referrer — store at most one
       // even if the client sends more (UI is not the guard).
       Array.isArray(c.selectedReferrers) ? JSON.stringify(c.selectedReferrers.slice(0, 1)) : '[]',
       derivedStatus === 'draft' ? JSON.stringify(draftDevicePayload) : null]
    );
    const contractId = rows[0].id;

    if ((c.contractType || 'sale_contract') === 'sale_contract' && derivedStatus === 'active') {
      await applyDevicePayloadToInstalledDevice(client, contractId, draftDevicePayload);
    }

    // Contract warranty becomes effective only after the device actually enters
    // service. We keep the legal entitlement at contract time, but the snapshot
    // dates/status are derived from installed_devices.activated_at.
    if ((c.contractType || 'sale_contract') === 'sale_contract' && derivedStatus === 'active') {
      await syncContractWarrantySnapshot(
        client,
        contractId,
        draftDevicePayload.warrantyMonths,
        draftDevicePayload.warrantyVisits,
      );
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
            (contract_id, installment_number, due_date, amount_syp, remaining_balance, confirmed)
           VALUES ($1,$2,$3,$4,$4,$5)`,
          [contract.id, inst.installmentNumber, inst.dueDate, inst.amountSyp || 0, inst.confirmed === true],
        );
      }
    }

    if (contract.status === 'active') {
      await createInstallmentCollectionTasksForContract(client, Number(contract.id));
    }

    // Financial constitution: `dues` are no longer stored independently.
    // Any legacy payload field is ignored; open receivables are projected from
    // contract_installments.remaining_balance instead.
    const duesResult = await fetchProjectedDuesByContractIds(client, [contract.id]);

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
    `SELECT c.branch_id, c.status AS "prevStatus", c.device_model_id AS "deviceModelId",
            COALESCE(d.installation_geo_unit_id, NULLIF(c.draft_device_payload->>'installationGeoUnitId', '')::int) AS "installationGeoUnitId"
       FROM contracts c
       LEFT JOIN installed_devices d ON d.contract_id = c.id
      WHERE c.id = $1`,
    [req.params.id],
  );
  if (!existing[0]) return res.status(404).json({ message: 'العقد غير موجود' });
  const access = authorize(authContext, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ message: 'غير مسموح' });
  const prevStatus: string = existing[0].prevStatus;
  if (prevStatus !== 'draft') {
    return res.status(409).json({
      error: 'لا يمكن تعديل عقد بعد اعتماده',
      code: 'contract_not_editable_after_approval',
      status: prevStatus,
    });
  }
  const c = req.body;
  const derivedStatus = deriveContractStatus(c.status, c.closingEmployeeId);
  const draftDevicePayload = buildDraftDevicePayload(c);

  // Plan §3 — NID length guard (always, when provided).
  const nidCheck = normalizeNationalId(c.nationalId ?? c.buyerNationalId);
  if (!nidCheck.ok) {
    return res.status(400).json({ error: 'الرقم الوطني يجب أن يكون 11 رقماً.' });
  }

  // Plan §4 — sale_owner_id is frozen once the contract leaves draft.
  //   • while draft        → editable subject to contracts.assign_sale_owner
  //   • once active+       → frozen; payload value is ignored entirely.
  const requestedSaleOwnerId = c.saleOwnerId ? Number(c.saleOwnerId) : null;
  const saleOwnerFrozen = prevStatus !== 'draft';
  if (!saleOwnerFrozen) {
    const currentUserEmployeeId = (req as any).user?.employeeId ?? null;
    if (!canAssignSaleOwner(authContext, existing[0].branch_id, currentUserEmployeeId, requestedSaleOwnerId)) {
      return res.status(403).json({ error: 'لا تملك صلاحية نسبة البيعة لموظف آخر' });
    }
  }

  // Geo-coverage enforcement — see POST /contracts. Use the contract's own
  // owning branch (existing[0].branch_id) since edits don't move branches.
  const installationGeoUnitForCheck =
    c.installationGeoUnitId ?? c.installation_geo_unit_id ?? null;
  if (installationGeoUnitForCheck) {
    const geoCheck = await assertGeoUnitInScope(
      authContext,
      installationGeoUnitForCheck,
      'geo_units.lookup',
      existing[0].branch_id,
    );
    if (!geoCheck.allowed) {
      return res.status(403).json({
        error: 'موقع تَركيب الجهاز خارج نِطاق تَغطية فَرع العَقد',
        code: geoCheck.reason,
      });
    }
  }

  // Neighborhood-level requirement (الحي / level 4). Enforced only when the
  // installation address actually changes, so legacy contracts with a coarser
  // saved address are not blocked on an unrelated edit.
  if (
    installationGeoUnitForCheck &&
    Number(installationGeoUnitForCheck) !== Number(existing[0].installationGeoUnitId)
  ) {
    const { rows: lvl } = await pool.query('SELECT level FROM geo_units WHERE id = $1', [installationGeoUnitForCheck]);
    if (!lvl[0] || Number(lvl[0].level) !== 4) {
      return res.status(400).json({
        error: 'عنوان التركيب يجب أن يكون على مستوى الحي',
        code: 'installation_geo_not_neighborhood',
      });
    }
  }

  // Device-model scope — enforced only when the device model actually changes,
  // so legacy contracts are not blocked on an unrelated edit.
  const deviceModelForCheck = c.deviceModelId ?? c.device_model_id ?? null;
  if (
    deviceModelForCheck &&
    Number(deviceModelForCheck) !== Number(existing[0].deviceModelId)
  ) {
    const devCheck = await assertDeviceModelInScope(authContext, deviceModelForCheck, existing[0].branch_id);
    if (!devCheck.allowed) {
      return res.status(403).json({
        error: 'نموذج الجهاز غير مصرّح به ضمن نطاقك',
        code: devCheck.reason,
      });
    }
  }

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    await syncClientLegalIdentity(pgClient, c.customerId, {
      fatherName: c.fatherName,
      nationalId: c.nationalId ?? c.buyerNationalId,
      motherName: c.buyerMotherName,
      birthDate: c.buyerBirthDate,
      gender: c.buyerGender,
      nationalIdRegistry: c.buyerNationalIdRegistry,
      nationalIdIssuedBy: c.buyerNationalIdIssuedBy,
      nationalIdIssueDate: c.buyerNationalIdIssueDate,
      nationalIdBox: c.buyerNationalIdBox,
    });

    // Phase 2C: contracts holds only financial/legal fields.
    await pgClient.query(
      `UPDATE contracts SET contract_number=COALESCE(NULLIF($1::text, ''), contract_number), customer_id=$2, customer_name=$3,
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
        sale_owner_id = CASE WHEN $33::boolean THEN sale_owner_id ELSE $34 END,
        contract_referrers=$35, draft_device_payload=$36
        -- offer_team_snapshot is deliberately NOT updated here: DEC-CT-13 freezes it at creation.
      WHERE id=$37`,
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
       saleOwnerFrozen,
       requestedSaleOwnerId,
       // Single-mediator rule: a sale has exactly one referrer — store at most one
       // even if the client sends more (UI is not the guard).
       Array.isArray(c.selectedReferrers) ? JSON.stringify(c.selectedReferrers.slice(0, 1)) : '[]',
       derivedStatus === 'draft' ? JSON.stringify(draftDevicePayload) : null,
       req.params.id]
    );

    if ((c.contractType || 'sale_contract') === 'sale_contract' && derivedStatus === 'active') {
      await applyDevicePayloadToInstalledDevice(pgClient, Number(req.params.id), draftDevicePayload);
    }

    // Respect DB-side activation/cancellation triggers and only synchronize the
    // warranty snapshot from the device's effective activation state.
    if ((c.contractType || 'sale_contract') === 'sale_contract' && derivedStatus === 'active') {
      await syncContractWarrantySnapshot(
        pgClient,
        Number(req.params.id),
        draftDevicePayload.warrantyMonths,
        draftDevicePayload.warrantyVisits,
      );
    }

    // DEC-CT-15: auto-freeze the legal copy at the draft→active transition.
    // freezeContractDocument() is idempotent — if a copy already exists,
    // nothing is written, so a redundant transition is safe.
    const newStatus = derivedStatus;
    if (prevStatus === 'draft' && newStatus === 'active') {
      // SAVEPOINT so a freeze failure rolls back in isolation instead of
      // aborting (and silently rolling back) the whole update transaction.
      // frozen_by FK → employees.id, so pass employeeId (not the hr_users.id).
      await pgClient.query('SAVEPOINT freeze_doc');
      try {
        await freezeContractDocument(pgClient, Number(req.params.id), (req as any).user?.employeeId ?? null);
        await pgClient.query('RELEASE SAVEPOINT freeze_doc');
      } catch (freezeErr: any) {
        // Don't abort the contract update if freezing fails (e.g. missing template
        // for a sale_subtype we haven't implemented yet). Log and continue.
        await pgClient.query('ROLLBACK TO SAVEPOINT freeze_doc');
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
    const contract = await loadDraftContractForEdit(pgClient, contractId, true);
    if (!contract) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'العقد غير موجود' });
    }
    if (contract.status !== 'draft') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({
        error: 'لا يمكن تعديل دفعات عقد بعد اعتماده',
        code: 'contract_not_editable_after_approval',
        status: contract.status,
      });
    }
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
    const contract = await loadDraftContractForEdit(pgClient, contractId, true);
    if (!contract) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'العقد غير موجود' });
    }
    if (contract.status !== 'draft') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({
        error: 'لا يمكن تعديل أقساط عقد بعد اعتماده',
        code: 'contract_not_editable_after_approval',
        status: contract.status,
      });
    }
    // Confirmed installments are locked: we never delete or re-insert them.
    // We only replace the unconfirmed ones. Re-inserting a payload row whose
    // installment_number matches a surviving confirmed row would otherwise hit
    // contract_installments_contract_id_installment_number_key. So skip any
    // incoming row whose number is already confirmed in the DB.
    const { rows: confirmedRows } = await pgClient.query(
      'SELECT installment_number FROM contract_installments WHERE contract_id = $1 AND confirmed = TRUE',
      [contractId],
    );
    const lockedNumbers = new Set(confirmedRows.map((r: any) => Number(r.installment_number)));
    await pgClient.query('DELETE FROM contract_installments WHERE contract_id = $1 AND confirmed = FALSE', [contractId]);
    for (const inst of installments) {
      if (lockedNumbers.has(Number(inst.installmentNumber))) continue;
      await pgClient.query(
        `INSERT INTO contract_installments
          (contract_id, installment_number, due_date, amount_syp, remaining_balance, confirmed)
         VALUES ($1,$2,$3,$4,$4,$5)`,
        [contractId, inst.installmentNumber, inst.dueDate, inst.amountSyp || 0, inst.confirmed === true],
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
  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    const contract = await loadDraftContractForEdit(pgClient, contractId, true);
    if (!contract) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'العقد غير موجود' });
    }
    if (contract.status !== 'draft') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({
        error: 'لا يمكن تأكيد أقساط عقد بعد اعتماده',
        code: 'contract_not_editable_after_approval',
        status: contract.status,
      });
    }
    await pgClient.query(
      'UPDATE contract_installments SET confirmed = TRUE WHERE contract_id = $1',
      [contractId],
    );
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
// Both are gated by the dedicated `contracts.close` permission (التسكير) so not
// every editor can flip the legal state of a contract. (The original split also
// defined contracts.approve; it was a duplicate and retired in migration 299.)
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
    'SELECT id, branch_id AS "branchId", installation_address_text AS "installationAddressText" FROM installed_devices WHERE contract_id = $1 LIMIT 1',
    [contract.id],
  );
  const deliveryDeviceId = devIdRows[0]?.id ?? null;
  // Device branch is authoritative once materialized; otherwise fall back to the
  // contract's planned service branch, then the sale branch.
  const deliveryBranchId = devIdRows[0]?.branchId ?? contract.serviceBranchId ?? contract.branchId;
  const { rows: insertedRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, task_type, task_family, reason, status, due_date,
       source, origin, contract_id, device_id, delivery_address, creation_origin
     ) VALUES ($1, $2, 'device_delivery', 'delivery', 'sale_delivery', 'open', $3,
               'system', 'system_trigger', $4, $5, $6, 'system_trigger')
     RETURNING id`,
    [contract.customerId, deliveryBranchId, dueDate, contract.id, deliveryDeviceId, devIdRows[0]?.installationAddressText ?? null],
  );
  // Freeze the client/contract/device snapshots at creation so the task's
  // "العقد والجهاز" tab is populated. Constitution:
  // docs/constitution/components/{contract,device}-snapshot.md §7/§5.2.
  await persistOpenTaskSnapshots(db, insertedRows[0].id, contract.customerId, contract.id, deliveryDeviceId);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildDraftDevicePayload(c: any) {
  const warrantyMonths = Number(c.warrantyMonths) || 0;
  const warrantyVisits = Number(c.warrantyVisits) > 0 ? Number(c.warrantyVisits) : null;
  const installationGeoUnitId =
    c.geoSelection?.neighborhoodId
    || c.installationGeoUnitId
    || null;

  return {
    serialNumber: c.serialNumber?.trim?.() || null,
    deviceStatus: c.deviceStatus || 'pending_delivery',
    deliveryDate: c.deliveryDate || null,
    installationDate: c.installationDate || null,
    installationGeoUnitId: toNullableNumber(installationGeoUnitId),
    installationAddressText: c.detailedAddress?.trim?.() || c.installationAddressText || null,
    installationLat: toNullableNumber(c.mapPosition?.[0] ?? c.installationLat),
    installationLng: toNullableNumber(c.mapPosition?.[1] ?? c.installationLng),
    warrantyMonths: warrantyMonths > 0 ? warrantyMonths : null,
    warrantyVisits,
  };
}

function hasDevicePayloadValue(payload: any): boolean {
  return Boolean(payload && Object.values(payload).some(v => v !== null && v !== undefined && v !== ''));
}

async function applyDevicePayloadToInstalledDevice(dbClient: any, contractId: number | string, payload: any) {
  if (!hasDevicePayloadValue(payload)) return;

  const result = await dbClient.query(
    `UPDATE installed_devices SET
       serial_number              = $1,
       status                     = $2,
       delivery_date              = $3,
       installation_date          = $4,
       installation_geo_unit_id   = $5,
       installation_address_text  = $6,
       installation_lat           = $7,
       installation_lng           = $8,
       warranty_months            = $9,
       warranty_visits            = $10,
       contract_warranty_end_date = $11
     WHERE contract_id = $12
     RETURNING id`,
    [
      payload.serialNumber || null,
      payload.deviceStatus || 'pending_delivery',
      payload.deliveryDate || null,
      payload.installationDate || null,
      payload.installationGeoUnitId || null,
      payload.installationAddressText || null,
      payload.installationLat ?? null,
      payload.installationLng ?? null,
      payload.warrantyMonths || null,
      payload.warrantyVisits || null,
      null,
      contractId,
    ],
  );
  if (result.rowCount === 0) {
    throw new Error(`installed_devices row was not materialized for contract ${contractId}`);
  }
}

// Plan 2026-06-10 (revised) — server-side mirror of the form's "active-required"
// validation. Approval flips status draft→active so we must guarantee here, in
// the transaction, that every field that ContractForm enforces for active is
// actually populated. This protects against drafts saved before the financial
// rule was tightened, or against clients that bypass the form entirely.
async function collectApprovalIssues(
  pgClient: any,
  contractId: number,
): Promise<string[]> {
  const issues: string[] = [];
  const { rows } = await pgClient.query(
    `SELECT c.id, c.payment_type, c.sale_subtype, c.sale_source,
            c.final_price, c.source_open_task_id,
            c.buyer_mother_name, c.buyer_gender, c.buyer_birth_date,
            c.buyer_national_id_registry, c.buyer_national_id_issued_by,
            c.buyer_national_id_issue_date, c.buyer_national_id_box,
            COALESCE(d.serial_number, c.draft_device_payload->>'serialNumber') AS serial_number,
            COALESCE(d.installation_geo_unit_id,
                     NULLIF(c.draft_device_payload->>'installationGeoUnitId', '')::int) AS geo_unit_id,
            (SELECT cu.father_name FROM clients cu WHERE cu.id = c.customer_id) AS father_name,
            (SELECT cu.national_id  FROM clients cu WHERE cu.id = c.customer_id) AS national_id
       FROM contracts c
       LEFT JOIN installed_devices d ON d.contract_id = c.id
      WHERE c.id = $1`,
    [contractId],
  );
  const c = rows[0];
  if (!c) return ['العقد غير موجود'];

  if (!c.serial_number || !String(c.serial_number).trim()) {
    issues.push('الرقم التسلسلي للجهاز مطلوب');
  }
  if (!c.geo_unit_id) issues.push('عنوان التركيب (المحافظة + الحي) مطلوب');

  const finalPrice = Number(c.final_price) || 0;
  const subtypeWaives = c.sale_subtype === 'temporary' || c.sale_subtype === 'free';

  if (!subtypeWaives) {
    if (c.sale_source === 'device_demo_task' && !c.source_open_task_id) {
      issues.push('زيارة عرض الجهاز المرتبطة غير محددة');
    }

    // contract_payment_entries has no `confirmed` column — an entry's mere
    // existence in the table is the confirmation (the frontend "confirm"
    // step is what persists the row). So we only need the sum and presence.
    const { rows: pe } = await pgClient.query(
      `SELECT amount_syp FROM contract_payment_entries WHERE contract_id = $1`,
      [contractId],
    );
    const sumPayments = pe.reduce((s: number, r: any) => s + Number(r.amount_syp || 0), 0);

    const { rows: ins } = await pgClient.query(
      `SELECT amount_syp, confirmed FROM contract_installments WHERE contract_id = $1`,
      [contractId],
    );
    const sumInstallments = ins.reduce((s: number, r: any) => s + Number(r.amount_syp || 0), 0);
    const installmentsConfirmed = ins.length > 0 && ins.some((r: any) => r.confirmed === true);

    if (c.payment_type === 'cash') {
      if (pe.length === 0) issues.push('عقد كاش — لا توجد دفعات');
      else if (Math.abs(sumPayments - finalPrice) > 1) {
        issues.push(`عقد كاش — مجموع الدفعات (${sumPayments}) لا يساوي الإجمالي (${finalPrice})`);
      }
    } else if (c.payment_type === 'installment') {
      if (ins.length === 0) issues.push('عقد تقسيط — لا يوجد جدول أقساط');
      else if (!installmentsConfirmed) issues.push('عقد تقسيط — جدول الأقساط غير مؤكَّد');
      if (Math.abs(sumPayments + sumInstallments - finalPrice) > 1) {
        issues.push(`عقد تقسيط — مجموع الأقساط + المقدم (${sumPayments + sumInstallments}) لا يساوي الإجمالي (${finalPrice})`);
      }
    }

    if (c.payment_type === 'installment') {
      const legalMissing: string[] = [];
      if (!c.father_name || !String(c.father_name).trim()) legalMissing.push('اسم الأب');
      if (!c.national_id || !/^\d{11}$/.test(String(c.national_id).trim())) legalMissing.push('الرقم الوطني (11 رقم)');
      if (!c.buyer_mother_name || !String(c.buyer_mother_name).trim()) legalMissing.push('اسم الأم');
      if (!c.buyer_gender) legalMissing.push('الجنس');
      if (!c.buyer_birth_date) legalMissing.push('تاريخ الميلاد');
      if (!c.buyer_national_id_registry || !String(c.buyer_national_id_registry).trim()) legalMissing.push('القيد');
      if (!c.buyer_national_id_issued_by || !String(c.buyer_national_id_issued_by).trim()) legalMissing.push('أمانة السجل');
      if (!c.buyer_national_id_issue_date) legalMissing.push('تاريخ منح الهوية');
      if (!c.buyer_national_id_box || !String(c.buyer_national_id_box).trim()) legalMissing.push('الخانة');
      if (legalMissing.length > 0) {
        issues.push(`عقد تقسيط — البيانات القانونية الناقصة: ${legalMissing.join('، ')}`);
      }
    }
  }

  return issues;
}

// NOTE: /approve uses requireAuth only (no requirePermission middleware) so the
// auth context can be built lazily; the contracts.close check happens below
// against the contract's own branch. (contracts.approve was retired in
// migration 299 — التسكير is now a single capability: contracts.close.)
router.post('/:id/approve', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });
  // requirePermission is skipped so req.authContext is not pre-populated; build
  // it here so authorize() below has a real context to read.
  const authContext = await getOrBuildAuthContext(req as any);
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
              sale_owner_id AS "saleOwnerId",
              draft_device_payload AS "draftDevicePayload",
              NULL::date AS delivery_date
         FROM contracts WHERE id = $1 FOR UPDATE`,
      [contractId],
    );
    if (!cur[0]) {
      await pgClient.query('ROLLBACK');
      return res.status(404).json({ error: 'العقد غير موجود' });
    }
    const c = cur[0];

    // التسكير is gated by the single contracts.close capability (migration 299).
    const closeAccess = authorize(authContext, { permission: 'contracts.close', branchId: c.branch_id });
    if (!closeAccess.allowed) {
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

    // Plan 2026-06-10 (revised) — re-validate the contract against the
    // active-required rules before flipping status. If anything is missing,
    // return 400 with the per-field issue list so the UI can guide the user
    // back to the form to complete what's needed.
    const issues = await collectApprovalIssues(pgClient, contractId);
    if (issues.length > 0) {
      await pgClient.query('ROLLBACK');
      return res.status(400).json({
        error: 'لا يمكن اعتماد العقد — البيانات المطلوبة غير مكتملة',
        issues,
      });
    }

    // Plan §4 — Approve is the freeze point for sale_owner_id. The approver may
    // pass a final saleOwnerId in the body; that requires contracts.assign_sale_owner.
    // Otherwise we keep whatever was last saved on the draft.
    const incomingSaleOwner = req.body?.saleOwnerId ? Number(req.body.saleOwnerId) : null;
    let finalSaleOwnerId: number | null = c.saleOwnerId ?? null;
    if (incomingSaleOwner != null && incomingSaleOwner !== finalSaleOwnerId) {
      if (!canAssignSaleOwner(authContext, c.branch_id, (req as any).user?.employeeId ?? null, incomingSaleOwner)) {
        await pgClient.query('ROLLBACK');
        return res.status(403).json({ error: 'لا تملك صلاحية نسبة البيعة لموظف آخر' });
      }
      finalSaleOwnerId = incomingSaleOwner;
    }

    // Flip status — this fires the DB triggers (211/204/etc.) that
    // materialize the installed_devices row, cascade warranties, and replay
    // installment balance recompute.
    await pgClient.query(
      `UPDATE contracts
         SET contract_number = COALESCE(NULLIF(contract_number, ''), 'C-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('contract_number_seq')::text, 5, '0')),
             status = 'active',
             closing_employee_id = $1,
             closing_date = NOW(),
             sale_owner_id = $2
       WHERE id = $3`,
      [closerId, finalSaleOwnerId, contractId],
    );

    if (c.draftDevicePayload) {
      await applyDevicePayloadToInstalledDevice(pgClient, contractId, c.draftDevicePayload);
      await syncContractWarrantySnapshot(
        pgClient,
        contractId,
        toNullableNumber(c.draftDevicePayload.warrantyMonths),
        toNullableNumber(c.draftDevicePayload.warrantyVisits),
      );
      await pgClient.query(
        'UPDATE contracts SET draft_device_payload = NULL WHERE id = $1',
        [contractId],
      );
    }

    // Refresh after triggers settle.
    const { rows: after } = await pgClient.query(
      `SELECT c.id, c.contract_type AS "contractType", c.customer_id AS "customerId",
              c.branch_id AS "branchId", d.delivery_date AS "deliveryDate",
              c.status
         FROM contracts c
         LEFT JOIN installed_devices d ON d.contract_id = c.id
        WHERE c.id = $1`,
      [contractId],
    );
    const refreshed = after[0];

    // App-side side effects: delivery task (mirrors the POST path).
    if (refreshed.contractType === 'sale_contract') {
      await createDeliveryTaskForContract(pgClient, refreshed);
    }

    await createInstallmentCollectionTasksForContract(pgClient, contractId);

    // سجل الحركات المالية: استحقاق التوقيع + الأقساط + الدفعات (idempotent).
    await syncContractMovements(pgClient, contractId);

    if (refreshed.customerId) {
      await promoteClientToLifecycleStatus(pgClient, Number(refreshed.customerId), 'OP');
    }

    // Freeze the legal copy (DEC-CT-15). Wrap in a SAVEPOINT so a freeze
    // failure (e.g. missing template) can be rolled back in isolation WITHOUT
    // aborting the whole approval transaction — a plain try/catch is not
    // enough, because any error marks the surrounding transaction as aborted
    // and the subsequent COMMIT silently becomes a ROLLBACK.
    // frozen_by FK → employees.id, so pass employeeId (not the hr_users.id).
    await pgClient.query('SAVEPOINT freeze_doc');
    try {
      await freezeContractDocument(pgClient, contractId, (req as any).user?.employeeId ?? null);
      await pgClient.query('RELEASE SAVEPOINT freeze_doc');
    } catch (freezeErr: any) {
      await pgClient.query('ROLLBACK TO SAVEPOINT freeze_doc');
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

// POST /api/contracts/:id/cancel — إلغاء عقد نشِط (التسكير العكسي).
// عملية صريحة لأن PUT يرفض تعديل غير المسوّدة. تتكفّل triggers الـDB بأثر
// الأجهزة/الكفالات عند تغيّر الحالة.
router.post('/:id/cancel', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });
  const authContext = await getOrBuildAuthContext(req as any);
  const contractId = Number(req.params.id);
  if (!Number.isInteger(contractId) || contractId <= 0) {
    return res.status(400).json({ error: 'id غير صالح' });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  const pgClient = await pool.connect();
  try {
    await pgClient.query('BEGIN');
    const { rows: cur } = await pgClient.query(
      `SELECT id, status, branch_id, customer_id, final_price, created_at,
              COALESCE((SELECT SUM(amount_syp) FROM contract_installments WHERE contract_id = contracts.id), 0) AS installments_total,
              COALESCE((SELECT SUM(CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END)
                          FROM contract_payment_entries
                         WHERE contract_id = contracts.id AND installment_id IS NULL), 0) AS signing_paid
         FROM contracts WHERE id = $1 FOR UPDATE`,
      [contractId],
    );
    if (!cur[0]) { await pgClient.query('ROLLBACK'); return res.status(404).json({ error: 'العقد غير موجود' }); }
    const c = cur[0];

    const access = authorize(authContext, { permission: 'contracts.close', branchId: c.branch_id });
    if (!access.allowed) { await pgClient.query('ROLLBACK'); return res.status(403).json({ error: 'غير مسموح' }); }

    if (c.status !== 'active') {
      await pgClient.query('ROLLBACK');
      return res.status(409).json({ error: `لا يمكن إلغاء عقد بحالة "${c.status}". الإلغاء متاح للعقود النشطة فقط.` });
    }

    const userId = (authContext as any).userId ?? null;

    // 1) status → cancelled.
    await pgClient.query(
      `UPDATE contracts
          SET status = 'cancelled', cancellation_reason = NULLIF($2, ''), cancelled_at = NOW(), cancelled_by = $3
        WHERE id = $1`,
      [contractId, reason, userId],
    );

    // 2) إلغاء مهام تسديد الذمم المفتوحة للعقد + زياراتها غير المنتهية.
    const { rows: cancelledTasks } = await pgClient.query(
      `UPDATE open_tasks
          SET status = 'cancelled',
              cancellation_reason = COALESCE(NULLIF($2, ''), cancellation_reason, 'إلغاء العقد'),
              updated_at = NOW()
        WHERE task_type = 'installment_collection' AND contract_id = $1
          AND status NOT IN ('completed', 'cancelled')
        RETURNING id`,
      [contractId, reason],
    );
    const cancelledTaskIds = cancelledTasks.map((r: any) => Number(r.id));
    if (cancelledTaskIds.length > 0) {
      await pgClient.query(
        `UPDATE visit_tasks SET status = 'cancelled', updated_at = NOW()
          WHERE source_open_task_id = ANY($1::int[]) AND status NOT IN ('completed', 'cancelled')`,
        [cancelledTaskIds],
      );
    }

    // 3) إبطال المتبقّي مالياً (discount) بتاريخ كل التزام حتى يصبح المستحق والقادم = 0.
    if (c.customer_id) {
      const signingRemaining = Number(c.final_price) - Number(c.installments_total) - Number(c.signing_paid);
      if (signingRemaining > 0) {
        await recordMovement(pgClient, {
          clientId: Number(c.customer_id), occurredAt: c.created_at, kind: 'discount', amountSyp: signingRemaining,
          sourceType: 'contract', sourceId: contractId, sourceRefId: contractId, contractId,
          description: 'إبطال متبقّي قيمة العقد عند الإلغاء', occurredBranchId: c.branch_id ?? null,
          recordedBy: userId, notes: reason || null,
        });
      }
      const { rows: openInstallments } = await pgClient.query(
        `SELECT id, due_date, remaining_balance FROM contract_installments
          WHERE contract_id = $1 AND remaining_balance > 0`,
        [contractId],
      );
      for (const inst of openInstallments) {
        await recordMovement(pgClient, {
          clientId: Number(c.customer_id), occurredAt: inst.due_date, kind: 'discount', amountSyp: Number(inst.remaining_balance),
          sourceType: 'contract_installment', sourceId: contractId, sourceRefId: Number(inst.id), contractId,
          description: 'إبطال قسط عند إلغاء العقد', occurredBranchId: c.branch_id ?? null,
          recordedBy: userId, notes: reason || null,
        });
      }
    }

    await pgClient.query('COMMIT');
    res.json({ success: true, contractId, status: 'cancelled', cancelledCollectionTasks: cancelledTaskIds.length });
  } catch (err: any) {
    await pgClient.query('ROLLBACK');
    console.error('[contracts] cancel failed:', err);
    res.status(500).json({ error: 'فشل إلغاء العقد', detail: err?.message });
  } finally {
    pgClient.release();
  }
});

// reject uses requireAuth only (no requirePermission middleware); the
// contracts.close check happens below against the contract's own branch,
// matching the approve route's gating (contracts.approve retired in migr 299).
router.post('/:id/reject', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });
  // Same as /approve: this route bypasses requirePermission, so build the
  // auth context manually before calling authorize().
  const authContext = await getOrBuildAuthContext(req as any);
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

    const closeAccess = authorize(authContext, { permission: 'contracts.close', branchId: c.branch_id });
    if (!closeAccess.allowed) {
      await pgClient.query('ROLLBACK');
      return res.status(403).json({ error: 'غير مسموح — يتطلب contracts.close' });
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
