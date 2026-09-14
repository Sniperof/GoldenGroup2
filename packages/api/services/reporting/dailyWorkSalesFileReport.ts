import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface DailyWorkSalesFileRow {
  branchId: number;
  branchName: string;
  sellerDepartmentName: string;
  contractStatus: string;
  customerName: string;
  primaryContactNumber: string | null;
  governorateName: string;
  regionName: string;
  subareaName: string;
  neighborhoodName: string;
  installationAddress: string | null;
  contractDate: string | null;
  deliveryDate: string | null;
  installationDate: string | null;
  activationDate: string | null;
  executionStage: string;
  serialNumber: string | null;
  deviceModelName: string;
  saleValue: string;
  saleType: string;
  saleSubtype: string;
  saleSource: string;
  paymentMethodType: string;
  firstPaymentAmount: string | null;
  firstPaymentDate: string | null;
  installmentsCount: number;
  collectedTotal: string;
  remainingBalance: string;
  paymentMethodsUsed: string | null;
  giftName: string | null;
  giftConditionLabel: string | null;
  giftDeliveredAt: string | null;
  acquisitionChannel: string;
  nameEntryPath: string;
  otherClientOwners: string;
  contractNotes: string | null;
  sellerName: string;
  saleReferenceNumber: string | null;
  saleVisitTechnicianName: string | null;
  installationTechnicianName: string | null;
  installationSupervisorName: string | null;
  saleCloserName: string;
  telemarketerName: string | null;
  mediatorName: string;
  mediatorType: string;
  mediatorContactNumber: string | null;
  additionalMediators: string | null;
}

/**
 * `contracts.contract_date` is stored as VARCHAR, so it is read behind a shape
 * guard: a malformed value reads as «غير محدد» instead of aborting the whole run.
 */
const CONTRACT_DATE_SHAPE_SQL = `contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`;
const CONTRACT_DATE_SQL = `(CASE WHEN ${CONTRACT_DATE_SHAPE_SQL} THEN contract.contract_date::date END)`;

const CONTRACT_STATUSES = new Set(['draft', 'active', 'completed', 'cancelled', 'discarded']);

const CONTRACT_STATUS_SQL = `CASE contract.status
  WHEN 'draft' THEN 'مسودة'
  WHEN 'active' THEN 'نشط'
  WHEN 'completed' THEN 'مكتمل'
  WHEN 'cancelled' THEN 'ملغى'
  WHEN 'discarded' THEN 'مُستبعَد'
  ELSE contract.status END`;

const SALE_TYPE_SQL = `CASE contract.sale_type
  WHEN 'direct' THEN 'بيع مباشر'
  WHEN 'tradein' THEN 'استبدال'
  WHEN 'retention' THEN 'احتفاظ'
  ELSE COALESCE(NULLIF(BTRIM(contract.sale_type), ''), 'غير محدد') END`;

const SALE_SUBTYPE_SQL = `CASE contract.sale_subtype
  WHEN 'definitive' THEN 'نهائية'
  WHEN 'temporary' THEN 'مؤقتة'
  WHEN 'free' THEN 'مجانية'
  ELSE COALESCE(NULLIF(BTRIM(contract.sale_subtype), ''), 'غير محدد') END`;

const PAYMENT_TYPES = new Set(['cash', 'installment']);

const EXECUTION_STAGES = new Set(['pending_delivery', 'delivered', 'installed', 'activated']);

/**
 * Read by stage precedence, not by date order: the schema allows a delivery date
 * recorded after the installation date, and a date-ordered rule would mislabel it.
 */
const EXECUTION_STAGE_KEY_SQL = `CASE
  WHEN device.activated_at IS NOT NULL THEN 'activated'
  WHEN device.installation_date IS NOT NULL THEN 'installed'
  WHEN device.delivery_date IS NOT NULL THEN 'delivered'
  ELSE 'pending_delivery' END`;

const EXECUTION_STAGE_LABEL_SQL = `CASE
  WHEN device.activated_at IS NOT NULL THEN 'مشغَّل'
  WHEN device.installation_date IS NOT NULL THEN 'مركَّب بانتظار التشغيل'
  WHEN device.delivery_date IS NOT NULL THEN 'مسلَّم بانتظار التركيب'
  ELSE 'بانتظار التسليم' END`;

/** Both columns are CHECK-guarded at the schema level, so the allowlist is the constraint itself. */
const SALE_TYPES = new Set(['direct', 'tradein', 'retention']);

const SALE_SUBTYPES = new Set(['definitive', 'temporary', 'free']);

/**
 * «عليها متبقٍّ» is deliberately `> 0` only: a cancelled contract whose collections
 * exceed its charges carries a negative balance, which is a refund case and not a
 * collection case, so it stays with the settled sales instead of the debt list.
 */
const REMAINING_BALANCE_MODES = new Set(['with_remaining', 'settled']);

const REMAINING_BALANCE_SQL = `COALESCE(money.remaining_balance, 0)`;

/**
 * The ledger holds every obligation of the client, and a task-money movement carries the
 * device's contract id too — a maintenance or installation charge is booked against the
 * contract without being part of its price. So the contract money columns read the
 * contract-originated sources only. The list is a positive allowlist on purpose: a future
 * task-money source type would otherwise leak into the contract balance unnoticed.
 */
const CONTRACT_MONEY_SOURCES_SQL = `movement.source_type IN ('contract', 'contract_installment', 'contract_payment')`;

/** The model is read from the created device first, then from the contract itself. */
const DEVICE_MODEL_ID_SQL = `COALESCE(device.device_model_id, contract.device_model_id)`;

/** The same fallback chain the visible column uses, minus its final «unknown» label. */
const DEVICE_MODEL_NAME_SQL = `COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''), NULLIF(BTRIM(model.name), ''),
                    NULLIF(BTRIM(device.device_model_name), ''), NULLIF(BTRIM(device.external_device_name), ''),
                    NULLIF(BTRIM(contract.device_model_name), ''))`;

const PAYMENT_TYPE_SQL = `CASE contract.payment_type
  WHEN 'cash' THEN 'نقدي'
  WHEN 'installment' THEN 'تقسيط'
  ELSE COALESCE(NULLIF(BTRIM(contract.payment_type), ''), 'غير محدد') END`;

const PAYMENT_METHOD_SQL = `CASE entry.method
  WHEN 'cash' THEN 'نقدي'
  WHEN 'sham_cash' THEN 'شام كاش'
  WHEN 'syriatel_cash' THEN 'سيرياتيل كاش'
  WHEN 'mtn_cash' THEN 'إم تي إن كاش'
  WHEN 'alharam' THEN 'الهرم'
  WHEN 'bank_transfer' THEN 'حوالة مصرفية'
  WHEN 'barter' THEN 'مقايضة'
  WHEN 'usd_cash' THEN 'نقدي دولار'
  ELSE entry.method END`;

/** The visit team is always the effective one: reassignment wins over the frozen snapshot. */
const VISIT_TECHNICIAN_ID_SQL = `COALESCE(visit.reassigned_technician_id, NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int)`;
const VISIT_SUPERVISOR_ID_SQL = `COALESCE(visit.reassigned_supervisor_id, NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int)`;

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value))
    .filter((value): value is number => value != null)));
}

function textFilter(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateFilter(value: unknown, label: string): string | null {
  const normalized = textFilter(value);
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

export function buildDailyWorkSalesFileQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = [];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`contract.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (
      SELECT 1 FROM hr_users scoped_user
       WHERE scoped_user.id = $${params.length}
         AND scoped_user.employee_id = contract.sale_owner_id
    )`);
  }

  const fromDate = dateFilter(request.fromDate, 'بداية مدى تاريخ العقد');
  const toDate = dateFilter(request.toDate, 'نهاية مدى تاريخ العقد');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدى تاريخ العقد مطلوب لتوليد التقرير');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية مدى تاريخ العقد يجب ألا تكون بعد نهايته');
  // ISO-shaped text sorts chronologically, so the range is compared on the stored
  // column itself: an expression cast would be non-IMMUTABLE and unindexable.
  filters.push(CONTRACT_DATE_SHAPE_SQL);
  params.push(fromDate);
  filters.push(`contract.contract_date >= $${params.length}`);
  params.push(toDate);
  filters.push(`contract.contract_date <= $${params.length}`);

  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    filters.push(`geo.unit_ids && $${params.length}::int[]`);
  }

  const contractStatus = textFilter(request.contractStatus);
  if (contractStatus != null) {
    if (!CONTRACT_STATUSES.has(contractStatus)) throw new ReportingError(400, 'حالة العقد غير صالحة');
    params.push(contractStatus);
    filters.push(`contract.status = $${params.length}`);
  }

  const sellerEmployeeId = positiveInt(request.sellerEmployeeId);
  if (sellerEmployeeId != null) {
    params.push(sellerEmployeeId);
    filters.push(`contract.sale_owner_id = $${params.length}`);
  }

  const sellerDepartmentTypeId = positiveInt(request.sellerDepartmentTypeId);
  if (sellerDepartmentTypeId != null) {
    params.push(sellerDepartmentTypeId);
    filters.push(`department.department_type_id = $${params.length}`);
  }

  const paymentType = textFilter(request.paymentType);
  if (paymentType != null) {
    if (!PAYMENT_TYPES.has(paymentType)) throw new ReportingError(400, 'طريقة الدفع غير صالحة');
    params.push(paymentType);
    filters.push(`contract.payment_type = $${params.length}`);
  }

  const executionStage = textFilter(request.executionStage);
  if (executionStage != null) {
    if (!EXECUTION_STAGES.has(executionStage)) throw new ReportingError(400, 'مرحلة التنفيذ غير صالحة');
    params.push(executionStage);
    filters.push(`(${EXECUTION_STAGE_KEY_SQL}) = $${params.length}`);
  }

  const saleType = textFilter(request.saleType);
  if (saleType != null) {
    if (!SALE_TYPES.has(saleType)) throw new ReportingError(400, 'نوع البيعة غير صالح');
    params.push(saleType);
    filters.push(`contract.sale_type = $${params.length}`);
  }

  const saleSubtype = textFilter(request.saleSubtype);
  if (saleSubtype != null) {
    if (!SALE_SUBTYPES.has(saleSubtype)) throw new ReportingError(400, 'صفة البيعة غير صالحة');
    params.push(saleSubtype);
    filters.push(`contract.sale_subtype = $${params.length}`);
  }

  // Applied on the aggregated ledger column itself, not on any contract form field.
  const remainingBalance = textFilter(request.remainingBalance);
  if (remainingBalance != null) {
    if (!REMAINING_BALANCE_MODES.has(remainingBalance)) throw new ReportingError(400, 'قيمة فلتر المتبقي المالي غير صالحة');
    filters.push(`${REMAINING_BALANCE_SQL} ${remainingBalance === 'with_remaining' ? '>' : '<='} 0`);
  }

  const deviceModelValue = textFilter(request.deviceModel);
  const deviceModelId = positiveInt(request.deviceModelId
    ?? (deviceModelValue?.startsWith('catalog:') ? deviceModelValue.slice(8) : null));
  if (deviceModelId != null) {
    params.push(deviceModelId);
    filters.push(`${DEVICE_MODEL_ID_SQL} = $${params.length}`);
  } else if (deviceModelValue?.startsWith('external:')) {
    params.push(deviceModelValue.slice(9));
    filters.push(`${DEVICE_MODEL_ID_SQL} IS NULL AND ${DEVICE_MODEL_NAME_SQL} = $${params.length}`);
  } else if (deviceModelValue != null) {
    throw new ReportingError(400, 'نوع الجهاز غير صالح');
  }

  // The «specific sale» picker sends a row identifier, so no free text ever reaches SQL.
  if (request.contractId != null && request.contractId !== '') {
    const contractId = positiveInt(request.contractId);
    if (contractId == null) throw new ReportingError(400, 'البيعة المحددة غير صالحة');
    params.push(contractId);
    filters.push(`contract.id = $${params.length}`);
  }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT contract.branch_id AS "branchId",
           COALESCE(branch.name, 'غير محدد') AS "branchName",
           COALESCE(NULLIF(BTRIM(department_type.value), ''), 'غير محدد') AS "sellerDepartmentName",
           ${CONTRACT_STATUS_SQL} AS "contractStatus",
           COALESCE(NULLIF(BTRIM(client.name), ''), NULLIF(BTRIM(contract.customer_name), ''), 'غير محدد') AS "customerName",
           NULLIF(BTRIM(client.mobile), '') AS "primaryContactNumber",
           COALESCE(geo.governorate_name, 'غير محدد') AS "governorateName",
           COALESCE(geo.region_name, 'غير محدد') AS "regionName",
           COALESCE(geo.subarea_name, 'غير محدد') AS "subareaName",
           COALESCE(geo.neighborhood_name, 'غير محدد') AS "neighborhoodName",
           NULLIF(BTRIM(device.installation_address_text), '') AS "installationAddress",
           TO_CHAR(${CONTRACT_DATE_SQL}, 'YYYY-MM-DD') AS "contractDate",
           TO_CHAR(device.delivery_date, 'YYYY-MM-DD') AS "deliveryDate",
           TO_CHAR(device.installation_date, 'YYYY-MM-DD') AS "installationDate",
           TO_CHAR((device.activated_at AT TIME ZONE 'Asia/Damascus')::date, 'YYYY-MM-DD') AS "activationDate",
           ${EXECUTION_STAGE_LABEL_SQL} AS "executionStage",
           COALESCE(NULLIF(BTRIM(device.serial_number), ''), NULLIF(BTRIM(device.external_device_serial), '')) AS "serialNumber",
           COALESCE(${DEVICE_MODEL_NAME_SQL}, 'جهاز غير محدد') AS "deviceModelName",
           COALESCE(contract.final_price, 0)::numeric AS "saleValue",
           ${SALE_TYPE_SQL} AS "saleType",
           ${SALE_SUBTYPE_SQL} AS "saleSubtype",
           COALESCE(NULLIF(BTRIM(contract.sale_source), ''), 'غير محدد') AS "saleSource",
           ${PAYMENT_TYPE_SQL} AS "paymentMethodType",
           first_payment.amount_syp AS "firstPaymentAmount",
           TO_CHAR((first_payment.occurred_at AT TIME ZONE 'Asia/Damascus')::date, 'YYYY-MM-DD') AS "firstPaymentDate",
           COALESCE(installments.total, 0) AS "installmentsCount",
           COALESCE(money.collected_total, 0)::numeric AS "collectedTotal",
           COALESCE(money.remaining_balance, 0)::numeric AS "remainingBalance",
           payment_methods.methods AS "paymentMethodsUsed",
           gift.names AS "giftName",
           gift.conditions AS "giftConditionLabel",
           TO_CHAR((gift.delivered_at AT TIME ZONE 'Asia/Damascus')::date, 'YYYY-MM-DD') AS "giftDeliveredAt",
           COALESCE(NULLIF(BTRIM(client.source_channel), ''), 'غير محدد') AS "acquisitionChannel",
           CASE
             WHEN client.referral_sheet_id IS NOT NULL THEN 'لائحة أسماء'
             WHEN client.is_candidate IS TRUE THEN 'محوَّل من اسم مقترح'
             ELSE 'إدخال يدوي'
           END AS "nameEntryPath",
           COALESCE(
             other_owners.names,
             CASE WHEN client.candidate_status IN ('OP', 'FOP') THEN 'ملكية الفرع' ELSE 'بلا مالك' END
           ) AS "otherClientOwners",
           NULLIF(BTRIM(contract.invoice_notes), '') AS "contractNotes",
           COALESCE(NULLIF(BTRIM(seller.name), ''), 'غير محدد') AS "sellerName",
           NULLIF(BTRIM(contract.sale_reference_number), '') AS "saleReferenceNumber",
           sale_visit.technician_name AS "saleVisitTechnicianName",
           installation.technician_name AS "installationTechnicianName",
           installation.supervisor_name AS "installationSupervisorName",
           COALESCE(NULLIF(BTRIM(closer.name), ''), 'غير محدد') AS "saleCloserName",
           sale_visit.telemarketer_name AS "telemarketerName",
           COALESCE(mediator.name, 'غير محدد') AS "mediatorName",
           CASE mediator.type
             WHEN 'Client' THEN 'زبون'
             WHEN 'Employee' THEN 'موظف'
             WHEN 'Personal' THEN 'شخصي'
             ELSE 'غير محدد'
           END AS "mediatorType",
           mediator_contact.number AS "mediatorContactNumber",
           mediator.additional_names AS "additionalMediators"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM contracts contract
      LEFT JOIN branches branch ON branch.id = contract.branch_id
      LEFT JOIN clients client ON client.id = contract.customer_id
      LEFT JOIN installed_devices device ON device.contract_id = contract.id
      LEFT JOIN device_models model ON model.id = ${DEVICE_MODEL_ID_SQL}
      LEFT JOIN employees seller ON seller.id = contract.sale_owner_id
      LEFT JOIN departments department ON department.id = seller.department_id
      LEFT JOIN system_lists department_type ON department_type.id = department.department_type_id
      LEFT JOIN hr_users closer ON closer.id = contract.closing_employee_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE ancestors AS (
          SELECT unit.id, unit.name, unit.level, unit.parent_id
            FROM geo_units unit WHERE unit.id = device.installation_geo_unit_id
          UNION ALL
          SELECT parent.id, parent.name, parent.level, parent.parent_id
            FROM geo_units parent JOIN ancestors child ON child.parent_id = parent.id
        )
        SELECT MAX(name) FILTER (WHERE level = 1) AS governorate_name,
               MAX(name) FILTER (WHERE level = 2) AS region_name,
               MAX(name) FILTER (WHERE level = 3) AS subarea_name,
               MAX(name) FILTER (WHERE level = 4) AS neighborhood_name,
               COALESCE(ARRAY_AGG(id), ARRAY[]::int[]) AS unit_ids
          FROM ancestors
      ) geo ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(movement.amount_syp) FILTER (WHERE movement.kind = 'payment'), 0) AS collected_total,
               COALESCE(SUM(movement.amount_syp) FILTER (WHERE movement.kind IN ('charge', 'refund')), 0)
                 - COALESCE(SUM(movement.amount_syp) FILTER (WHERE movement.kind IN ('payment', 'discount')), 0)
                 AS remaining_balance
          FROM financial_movements movement
         WHERE movement.contract_id = contract.id
           AND ${CONTRACT_MONEY_SOURCES_SQL}
      ) money ON TRUE
      LEFT JOIN LATERAL (
        SELECT movement.amount_syp, movement.occurred_at
          FROM financial_movements movement
         WHERE movement.contract_id = contract.id AND movement.kind = 'payment'
           AND ${CONTRACT_MONEY_SOURCES_SQL}
         ORDER BY movement.occurred_at ASC, movement.id ASC
         LIMIT 1
      ) first_payment ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(label, '، ' ORDER BY label) AS methods
          FROM (
            SELECT DISTINCT ${PAYMENT_METHOD_SQL} AS label
              FROM contract_payment_entries entry
             WHERE entry.contract_id = contract.id AND entry.entry_type = 'collection'
          ) distinct_methods
      ) payment_methods ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total
          FROM contract_installments installment
         WHERE installment.contract_id = contract.id
      ) installments ON TRUE
      LEFT JOIN LATERAL (
        SELECT (SELECT STRING_AGG(label, '، ' ORDER BY label) FROM (
                  SELECT DISTINCT COALESCE(NULLIF(BTRIM(definition.name), ''), 'هدية غير محددة') AS label
                    FROM gift_records record
                    LEFT JOIN gift_definitions definition ON definition.id = record.gift_definition_id
                   WHERE record.contract_id = contract.id
                ) gift_names) AS names,
               (SELECT STRING_AGG(label, '، ' ORDER BY label) FROM (
                  SELECT DISTINCT NULLIF(BTRIM(record.condition_label), '') AS label
                    FROM gift_records record
                   WHERE record.contract_id = contract.id
                     AND NULLIF(BTRIM(record.condition_label), '') IS NOT NULL
                ) gift_conditions) AS conditions,
               (SELECT MAX(COALESCE(record.manual_delivered_at, gift_task.closed_at))
                  FROM gift_records record
                  LEFT JOIN LATERAL (
                    SELECT result.closed_at
                      FROM visit_tasks task
                      JOIN visit_task_results result ON result.visit_task_id = task.id
                     WHERE task.source_open_task_id = record.delivery_task_id
                     ORDER BY result.closed_at DESC NULLS LAST, task.id DESC
                     LIMIT 1
                  ) gift_task ON TRUE
                 WHERE record.contract_id = contract.id) AS delivered_at
      ) gift ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(label, '، ' ORDER BY label) AS names
          FROM (
            SELECT DISTINCT NULLIF(BTRIM(owner.name), '') AS label
              FROM client_assignments assignment
              JOIN hr_users owner ON owner.id = assignment.hr_user_id
             WHERE assignment.client_id = client.id
               AND (contract.sale_owner_id IS NULL OR owner.employee_id IS DISTINCT FROM contract.sale_owner_id)
               AND NULLIF(BTRIM(owner.name), '') IS NOT NULL
          ) distinct_owners
      ) other_owners ON TRUE
      LEFT JOIN LATERAL (
        SELECT technician.name AS technician_name,
               COALESCE(telemarketer_employee.name, telemarketer_user.name) AS telemarketer_name
          FROM visit_task_device_demo_results demo
          JOIN visit_task_results demo_result ON demo_result.id = demo.visit_task_result_id
          JOIN visit_tasks demo_task ON demo_task.id = demo_result.visit_task_id
          JOIN field_visits visit ON visit.id = demo_task.field_visit_id
          LEFT JOIN employees technician ON technician.id = ${VISIT_TECHNICIAN_ID_SQL}
          LEFT JOIN hr_users telemarketer_user ON telemarketer_user.id = visit.booked_by_telemarketer_id
          LEFT JOIN employees telemarketer_employee ON telemarketer_employee.id = telemarketer_user.employee_id
         WHERE NULLIF(BTRIM(contract.sale_reference_number), '') IS NOT NULL
           AND demo.sale_reference_number = contract.sale_reference_number
         ORDER BY demo.id DESC
         LIMIT 1
      ) sale_visit ON TRUE
      LEFT JOIN LATERAL (
        SELECT technician.name AS technician_name, supervisor.name AS supervisor_name
          FROM open_tasks installation_task
          JOIN visit_tasks installation_visit_task ON installation_visit_task.source_open_task_id = installation_task.id
          JOIN field_visits visit ON visit.id = installation_visit_task.field_visit_id
          LEFT JOIN visit_task_results installation_result ON installation_result.visit_task_id = installation_visit_task.id
          LEFT JOIN employees technician ON technician.id = ${VISIT_TECHNICIAN_ID_SQL}
          LEFT JOIN employees supervisor ON supervisor.id = ${VISIT_SUPERVISOR_ID_SQL}
         WHERE installation_task.contract_id = contract.id
           AND installation_task.task_type = 'device_installation'
         ORDER BY installation_result.closed_at DESC NULLS LAST, installation_visit_task.id DESC
         LIMIT 1
      ) installation ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
                 NULLIF(BTRIM(contract.contract_referrers->0->>'referrerName'), ''),
                 NULLIF(BTRIM(client.referrer_name), '')
               ) AS name,
               COALESCE(
                 NULLIF(BTRIM(contract.contract_referrers->0->>'referrerType'), ''),
                 NULLIF(BTRIM(client.referrer_type), '')
               ) AS type,
               NULLIF(BTRIM(contract.contract_referrers->0->>'referralEntityId'), '')::int AS entity_id,
               (SELECT STRING_AGG(label, '، ' ORDER BY label) FROM (
                  SELECT DISTINCT NULLIF(BTRIM(extra->>'referrerName'), '') AS label
                    FROM JSONB_ARRAY_ELEMENTS(
                           CASE WHEN JSONB_TYPEOF(contract.contract_referrers) = 'array'
                                THEN contract.contract_referrers ELSE '[]'::jsonb END
                         ) WITH ORDINALITY AS referrers(extra, element_index)
                   WHERE element_index > 1 AND NULLIF(BTRIM(extra->>'referrerName'), '') IS NOT NULL
                ) extra_names) AS additional_names
      ) mediator ON TRUE
      LEFT JOIN LATERAL (
        SELECT number FROM (
          SELECT NULLIF(BTRIM(referrer_client.mobile), '') AS number
            FROM clients referrer_client
           WHERE mediator.type = 'Client' AND referrer_client.id = mediator.entity_id
          UNION ALL
          SELECT NULLIF(BTRIM(referrer_employee.mobile), '') AS number
            FROM employees referrer_employee
           WHERE mediator.type = 'Employee' AND referrer_employee.id = mediator.entity_id
        ) resolved WHERE number IS NOT NULL LIMIT 1
      ) mediator_contact ON TRUE
     ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY ${buildTabularReportOrderBy(
       'daily_work.sales_file', access, request, 'contract.contract_date DESC NULLS LAST, contract.id DESC',
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getDailyWorkSalesFileReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildDailyWorkSalesFileQuery(access, request, options);
  const { rows } = await pool.query<DailyWorkSalesFileRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/** Disclosed in the report guide: the sale picker lists at most this many sales of the chosen range. */
export const SALE_PICKER_OPTION_LIMIT = 300;

/**
 * Contract statuses, sale types and sale subtypes are closed schema-level enums, so the
 * UI holds them statically. Sellers, their departments, the device models and the sale
 * picker are derived inside the caller's own scope, so no dropdown ever reveals a row the
 * user cannot see in the report itself. The sale picker is additionally bounded by the
 * requested contract-date range — the report's own mandatory filter — so it offers exactly
 * the sales the run can contain instead of every sale ever recorded.
 */
export async function getDailyWorkSalesFileFilterOptions(
  access: TabularReportAccess,
  request: TabularReportRequestParams = {},
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeParams: unknown[] = [];
  const scope: string[] = [];
  if (access.branchIds.length > 0) {
    scopeParams.push(access.branchIds);
    scope.push(`contract.branch_id = ANY($${scopeParams.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    scopeParams.push(access.userId);
    scope.push(`EXISTS (
      SELECT 1 FROM hr_users scoped_user
       WHERE scoped_user.id = $${scopeParams.length}
         AND scoped_user.employee_id = contract.sale_owner_id
    )`);
  }
  const where = scope.length > 0 ? `WHERE ${scope.join(' AND ')}` : '';

  const saleParams = [...scopeParams];
  const saleFilters = [...scope];
  const fromDate = dateFilter(request.fromDate, 'بداية مدى تاريخ العقد');
  const toDate = dateFilter(request.toDate, 'نهاية مدى تاريخ العقد');
  if (fromDate && toDate && fromDate <= toDate) {
    saleFilters.push(CONTRACT_DATE_SHAPE_SQL);
    saleParams.push(fromDate);
    saleFilters.push(`contract.contract_date >= $${saleParams.length}`);
    saleParams.push(toDate);
    saleFilters.push(`contract.contract_date <= $${saleParams.length}`);
  }
  const salesInRange = fromDate != null && toDate != null && fromDate <= toDate;

  const [scoped, sales] = await Promise.all([
    pool.query(`
      WITH scoped_contracts AS (
        SELECT contract.sale_owner_id,
               ${DEVICE_MODEL_ID_SQL} AS device_model_id,
               COALESCE(NULLIF(BTRIM(device.device_model_name), ''), NULLIF(BTRIM(device.external_device_name), ''),
                        NULLIF(BTRIM(contract.device_model_name), '')) AS fallback_model_name
          FROM contracts contract
          LEFT JOIN installed_devices device ON device.contract_id = contract.id
          ${where}
      )
      SELECT
        COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
          SELECT DISTINCT JSONB_BUILD_OBJECT('value', seller.id::text, 'label', seller.name) AS item
            FROM scoped_contracts contract
            JOIN employees seller ON seller.id = contract.sale_owner_id
           WHERE NULLIF(BTRIM(seller.name), '') IS NOT NULL
        ) sellers), '[]'::jsonb) AS "contractSellers",
        COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
          SELECT DISTINCT JSONB_BUILD_OBJECT('value', department_type.id::text, 'label', department_type.value) AS item
            FROM scoped_contracts contract
            JOIN employees seller ON seller.id = contract.sale_owner_id
            JOIN departments department ON department.id = seller.department_id
            JOIN system_lists department_type ON department_type.id = department.department_type_id
           WHERE NULLIF(BTRIM(department_type.value), '') IS NOT NULL
        ) departments), '[]'::jsonb) AS "contractSellerDepartments",
        COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
          SELECT DISTINCT JSONB_BUILD_OBJECT('value', value, 'label', label) AS item
            FROM (
              SELECT CASE WHEN contract.device_model_id IS NOT NULL
                          THEN 'catalog:' || contract.device_model_id::text
                          ELSE 'external:' || contract.fallback_model_name END AS value,
                     COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''),
                              NULLIF(BTRIM(model.name), ''), contract.fallback_model_name) AS label
                FROM scoped_contracts contract
                LEFT JOIN device_models model ON model.id = contract.device_model_id
            ) resolved
           WHERE value IS NOT NULL AND label IS NOT NULL
        ) models), '[]'::jsonb) AS "deviceModels"
    `, scopeParams),
    salesInRange
      ? pool.query(`
          SELECT contract.id::text AS value,
                 CONCAT_WS(' · ',
                   -- A sale with no reference number still needs a unique visible identity,
                   -- so it falls back to the row grain key itself instead of one shared label.
                   COALESCE(NULLIF(BTRIM(contract.sale_reference_number), ''), 'عقد #' || contract.id::text),
                   COALESCE(NULLIF(BTRIM(client.name), ''), NULLIF(BTRIM(contract.customer_name), ''), 'زبون غير محدد'),
                   COALESCE(NULLIF(BTRIM(device.serial_number), ''), NULLIF(BTRIM(device.external_device_serial), '')),
                   contract.contract_date
                 ) AS label
            FROM contracts contract
            LEFT JOIN clients client ON client.id = contract.customer_id
            LEFT JOIN installed_devices device ON device.contract_id = contract.id
           WHERE ${saleFilters.join(' AND ')}
           ORDER BY contract.contract_date DESC, contract.id DESC
           LIMIT ${SALE_PICKER_OPTION_LIMIT}
        `, saleParams)
      : Promise.resolve({ rows: [] as Array<{ value: string; label: string }> }),
  ]);
  const row = scoped.rows[0] ?? {};
  return {
    contractStatuses: [
      { value: 'draft', label: 'مسودة' },
      { value: 'active', label: 'نشط' },
      { value: 'completed', label: 'مكتمل' },
      { value: 'cancelled', label: 'ملغى' },
      { value: 'discarded', label: 'مُستبعَد' },
    ],
    contractSellers: row.contractSellers ?? [],
    contractSellerDepartments: row.contractSellerDepartments ?? [],
    deviceModels: row.deviceModels ?? [],
    contractSales: sales.rows.map(option => ({ value: String(option.value), label: String(option.label) })),
  };
}
