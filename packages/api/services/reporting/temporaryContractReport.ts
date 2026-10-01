import pool from '../../db.js';
import { contractSaleOwnerSql } from '../../policies/contractPolicy.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { ReportingError } from './reportingError.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions {
  offset?: number;
  limit: number;
  includeTotalRows?: boolean;
}

const TRIAL_OUTCOMES = new Set(['settled', 'refused', 'open', 'unknown']);
const GRACE_STATES = new Set(['within', 'elapsed', 'unknown']);
const MEDIATOR_TYPES = new Set(['Client', 'Employee', 'unknown']);

/** The admin-owned grace length, seeded at 30 days by migration 465. */
export const TRIAL_GRACE_SETTING_KEY = 'trial_grace_period_days';

/**
 * How long the customer may keep the trial device before the company may take it
 * back. Read from an admin setting rather than pinned here, because the period is a
 * commercial decision that must change without a code release (DEC-TC-2). A missing
 * or malformed setting yields NULL, so the column reads empty instead of inventing
 * a deadline from a guessed number.
 */
const GRACE_DAYS_SQL = `(
  SELECT NULLIF(BTRIM(setting.value), '')::int
    FROM system_settings setting
   WHERE setting.key = '${TRIAL_GRACE_SETTING_KEY}'
     AND BTRIM(setting.value) ~ '^\\d+$'
)`;

/** The deadline itself: no installation date means no clock has started. */
const GRACE_END_SQL = `(
  CASE WHEN device.installation_date IS NOT NULL AND ${GRACE_DAYS_SQL} IS NOT NULL
    THEN device.installation_date + (${GRACE_DAYS_SQL} || ' days')::interval
  END
)::date`;

/**
 * The outcome of the trial, derived from what the contract already records — the
 * settlement stamp and explicit purchase refusal. Other terminal states do not
 * prove that the customer refused to buy. `started_as_temporary` is what
 * keeps a settled trial visible at all: settling flips `sale_subtype` to definitive
 * in place, so filtering on the subtype would erase every successful trial
 * (migration 458).
 */
const OUTCOME_SQL = `CASE
  WHEN contract.temporary_settled_at IS NOT NULL THEN 'settled'
  WHEN contract.cancellation_reason = 'trial_purchase_refused' THEN 'refused'
  WHEN contract.status IN ('draft', 'active') THEN 'open'
  ELSE 'unknown'
END`;

const OUTCOME_LABEL_SQL = `CASE ${OUTCOME_SQL}
  WHEN 'settled' THEN 'تم تثبيت البيعة'
  WHEN 'refused' THEN 'تم الرفض'
  WHEN 'open' THEN 'لم تتم بعد'
  ELSE 'غير مسجلة'
END`;

/**
 * Match the sale-source choice shown in the contract form: its quick demo
 * option, or the saved value from the managed "other sources" list.
 */
const APPOINTMENT_SOURCE_SQL = `CASE
  WHEN BTRIM(contract.sale_source) = 'device_demo_task' THEN 'مهمة عرض جهاز'
  ELSE COALESCE(NULLIF(BTRIM(contract.sale_source), ''), 'غير مسجل')
END`;

const VISIT_TECHNICIAN_ID_SQL = `COALESCE(visit.reassigned_technician_id, NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int)`;
const VISIT_SUPERVISOR_ID_SQL = `COALESCE(visit.reassigned_supervisor_id, NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int)`;

/** The same fallback chain the sales-file report reads, so both name one model. */
const DEVICE_MODEL_NAME_SQL = `COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''), NULLIF(BTRIM(model.name), ''),
  NULLIF(BTRIM(device.device_model_name), ''), NULLIF(BTRIM(device.external_device_name), ''),
  NULLIF(BTRIM(contract.device_model_name), ''))`;

/**
 * One device per row. The sales-file report joins the device directly; here it is a
 * LATERAL because the grain is the contract and a contract carrying two device rows
 * would otherwise duplicate it (§9.4.2). The contract's own pointer wins, and the
 * order is deterministic when it is absent.
 */
const DEVICE_LATERAL_SQL = `
    SELECT installed.*
      FROM installed_devices installed
     WHERE installed.id = contract.installed_device_id
        OR (contract.installed_device_id IS NULL AND installed.contract_id = contract.id)
     ORDER BY (installed.id = contract.installed_device_id) DESC, installed.id ASC
     LIMIT 1`;

/**
 * Show a selling technician only when that technician is the responsible user
 * of the source visit. A technician accompanying a supervisor is not the seller.
 */
const SALE_VISIT_LATERAL_SQL = `
    SELECT technician.name AS technician_name
      FROM field_visits visit
      JOIN hr_users responsible ON responsible.id = visit.team_responsible_user_id
      LEFT JOIN employees technician ON technician.id = ${VISIT_TECHNICIAN_ID_SQL}
     WHERE responsible.employee_id = ${VISIT_TECHNICIAN_ID_SQL}
       AND visit.id = COALESCE(contract.source_visit_id, (
         SELECT demo_task.field_visit_id
           FROM visit_task_device_demo_results demo
           JOIN visit_task_results demo_result ON demo_result.id = demo.visit_task_result_id
           JOIN visit_tasks demo_task ON demo_task.id = demo_result.visit_task_id
          WHERE NULLIF(BTRIM(contract.sale_reference_number), '') IS NOT NULL
            AND demo.sale_reference_number = contract.sale_reference_number
          ORDER BY demo.id DESC LIMIT 1
       ))
     LIMIT 1`;

const INSTALLATION_LATERAL_SQL = `
    SELECT technician.name AS technician_name, supervisor.name AS supervisor_name,
           technician.id AS technician_employee_id, supervisor.id AS supervisor_employee_id
      FROM open_tasks installation_task
      JOIN visit_tasks installation_visit_task ON installation_visit_task.source_open_task_id = installation_task.id
      JOIN field_visits visit ON visit.id = installation_visit_task.field_visit_id
      JOIN visit_task_results installation_result ON installation_result.visit_task_id = installation_visit_task.id
      LEFT JOIN employees technician ON technician.id = ${VISIT_TECHNICIAN_ID_SQL}
      LEFT JOIN employees supervisor ON supervisor.id = ${VISIT_SUPERVISOR_ID_SQL}
     WHERE installation_task.contract_id = contract.id
       AND installation_task.task_type = 'device_installation'
       AND installation_result.final_decision = 'installed_successfully'
     ORDER BY installation_result.closed_at DESC NULLS LAST, installation_visit_task.id DESC
     LIMIT 1`;

/** The first referrer on the contract's own snapshot (DEC-TC-8). */
const MEDIATOR_LATERAL_SQL = `
    SELECT NULLIF(BTRIM(contract.contract_referrers->0->>'referrerName'), '') AS name,
           CASE LOWER(BTRIM(contract.contract_referrers->0->>'referrerType'))
             WHEN 'client' THEN 'Client' WHEN 'customer' THEN 'Client'
             WHEN 'employee' THEN 'Employee'
           END AS type,
           NULLIF(BTRIM(contract.contract_referrers->0->>'referralEntityId'), '')::int AS entity_id`;

const MEDIATOR_CONTACT_LATERAL_SQL = `
    SELECT number FROM (
      SELECT NULLIF(BTRIM(referrer_client.mobile), '') AS number
        FROM clients referrer_client
       WHERE mediator.type = 'Client' AND referrer_client.id = mediator.entity_id
      UNION ALL
      SELECT NULLIF(BTRIM(referrer_employee.mobile), '') AS number
        FROM employees referrer_employee
       WHERE mediator.type = 'Employee' AND referrer_employee.id = mediator.entity_id
    ) resolved WHERE number IS NOT NULL LIMIT 1`;

function allowListed(value: unknown, values: Set<string>, message: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!values.has(normalized)) throw new ReportingError(400, message);
  return normalized;
}

function dateOnly(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  const date = new Date(`${normalized}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

function addDateRange(
  filters: string[], params: unknown[], column: string,
  fromValue: unknown, toValue: unknown, label: string,
) {
  const from = dateOnly(fromValue, `بداية ${label}`);
  const to = dateOnly(toValue, `نهاية ${label}`);
  if (from && to && from > to) throw new ReportingError(400, `بداية ${label} يجب ألا تكون بعد نهايته`);
  if (from) filters.push(`${column} >= $${params.push(from)}::date`);
  if (to) filters.push(`${column} <= $${params.push(to)}::date`);
}

export function buildTemporaryContractQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters = ['contract.started_as_temporary IS TRUE'];

  if (access.branchIds.length > 0) {
    filters.push(`contract.branch_id = ANY($${params.push(access.branchIds)}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    filters.push(contractSaleOwnerSql('contract', `$${params.push(access.userId)}`));
  }

  const outcome = allowListed(request.trialOutcome, TRIAL_OUTCOMES, 'نتيجة التجربة غير صالحة');
  if (outcome) filters.push(`(${OUTCOME_SQL}) = $${params.push(outcome)}`);

  // Reads the very expression that feeds the deadline column, so the filter and the
  // column can never disagree (§9.7.5).
  const graceState = allowListed(request.trialGraceState, GRACE_STATES, 'حالة المهلة غير صالحة');
  if (graceState === 'within') filters.push(`${GRACE_END_SQL} >= CURRENT_DATE`);
  else if (graceState === 'elapsed') filters.push(`${GRACE_END_SQL} < CURRENT_DATE`);
  else if (graceState === 'unknown') filters.push(`${GRACE_END_SQL} IS NULL`);

  const sellerId = positiveInt(request.sellerEmployeeId);
  if (sellerId != null) filters.push(`contract.sale_owner_id = $${params.push(sellerId)}`);

  const sellerDepartmentTypeId = positiveInt(request.sellerDepartmentTypeId);
  if (sellerDepartmentTypeId != null) {
    filters.push(`department.department_type_id = $${params.push(sellerDepartmentTypeId)}`);
  }

  const mediatorType = allowListed(request.mediatorType, MEDIATOR_TYPES, 'تصنيف الوسيط غير صالح');
  if (mediatorType === 'unknown') filters.push('mediator.type IS NULL');
  else if (mediatorType) filters.push(`mediator.type = $${params.push(mediatorType)}`);

  const deviceModelKey = typeof request.deviceModel === 'string' ? request.deviceModel : '';
  const deviceModelId = positiveInt(
    request.deviceModelId ?? (deviceModelKey.startsWith('catalog:') ? deviceModelKey.slice(8) : null),
  );
  if (deviceModelId != null) {
    filters.push(`COALESCE(device.device_model_id, contract.device_model_id) = $${params.push(deviceModelId)}`);
  } else if (deviceModelKey.startsWith('external:')) {
    filters.push(
      `COALESCE(device.device_model_id, contract.device_model_id) IS NULL
         AND COALESCE(device.external_device_name, device.device_model_name, contract.device_model_name, '') = $${params.push(deviceModelKey.slice(9))}`,
    );
  }

  const supervisorId = positiveInt(request.supervisorEmployeeId);
  if (supervisorId != null) filters.push(`installation.supervisor_name IS NOT NULL AND installation.supervisor_employee_id = $${params.push(supervisorId)}`);

  const technicianId = positiveInt(request.technicianEmployeeId);
  if (technicianId != null) filters.push(`installation.technician_employee_id = $${params.push(technicianId)}`);

  addDateRange(filters, params, 'device.installation_date', request.installationFrom, request.installationTo, 'تاريخ التركيب');

  const limitRef = `$${params.push(options.limit)}`;
  const offsetSql = options.offset == null ? '' : ` OFFSET $${params.push(options.offset)}`;

  const sql = `
    SELECT
      COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
      COALESCE(NULLIF(BTRIM(department_type.value), ''), 'غير محدد') AS "sellerDepartmentName",
      COALESCE(NULLIF(BTRIM(client.name), ''), NULLIF(BTRIM(contract.customer_name), ''), 'غير محدد') AS "customerName",
      NULLIF(BTRIM(client.mobile), '') AS "primaryContactNumber",
      NULLIF(BTRIM(client.detailed_address), '') AS "installationAddress",
      TO_CHAR(device.installation_date, 'YYYY-MM-DD') AS "installationDate",
      TO_CHAR(${GRACE_END_SQL}, 'YYYY-MM-DD') AS "graceEndDate",
      COALESCE(NULLIF(BTRIM(device.serial_number), ''), NULLIF(BTRIM(device.external_device_serial), '')) AS "serialNumber",
      COALESCE(${DEVICE_MODEL_NAME_SQL}, 'غير محدد') AS "deviceModelName",
      CASE mediator.type
        WHEN 'Client' THEN 'زبون'
        WHEN 'Employee' THEN 'موظف'
        ELSE 'غير محدد'
      END AS "mediatorType",
      COALESCE(mediator.name, 'غير محدد') AS "mediatorName",
      mediator_contact.number AS "mediatorContactNumber",
      ${APPOINTMENT_SOURCE_SQL} AS "appointmentSource",
      COALESCE(NULLIF(BTRIM(seller.name), ''), 'غير منسوب') AS "sellerName",
      sale_visit.technician_name AS "saleVisitTechnicianName",
      COALESCE(NULLIF(BTRIM(closer.name), ''), 'غير مسكَّر') AS "saleCloserName",
      installation.technician_name AS "installationTechnicianName",
      installation.supervisor_name AS "installationSupervisorName",
      ${OUTCOME_LABEL_SQL} AS "trialOutcome"
      ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
    FROM contracts contract
    LEFT JOIN branches branch ON branch.id = contract.branch_id
    LEFT JOIN clients client ON client.id = contract.customer_id
    LEFT JOIN employees seller ON seller.id = contract.sale_owner_id
    LEFT JOIN departments department ON department.id = seller.department_id
    LEFT JOIN system_lists department_type ON department_type.id = department.department_type_id
    LEFT JOIN hr_users closer ON closer.id = contract.closing_employee_id
    LEFT JOIN LATERAL (${DEVICE_LATERAL_SQL}) device ON TRUE
    LEFT JOIN device_models model ON model.id = COALESCE(device.device_model_id, contract.device_model_id)
    LEFT JOIN LATERAL (${SALE_VISIT_LATERAL_SQL}) sale_visit ON TRUE
    LEFT JOIN LATERAL (${INSTALLATION_LATERAL_SQL}) installation ON TRUE
    LEFT JOIN LATERAL (${MEDIATOR_LATERAL_SQL}) mediator ON TRUE
    LEFT JOIN LATERAL (${MEDIATOR_CONTACT_LATERAL_SQL}) mediator_contact ON TRUE
    WHERE ${filters.join('\n      AND ')}
    ORDER BY ${buildTabularReportOrderBy(
      'daily_work.temporary_contract', access, request,
      'device.installation_date DESC NULLS LAST, contract.id DESC',
    )}
    LIMIT ${limitRef}${offsetSql}`;

  return { sql, params };
}

export async function getTemporaryContractReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildTemporaryContractQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  return { rows, total: Number(rows[0]?.totalRows ?? 0) };
}

/** Each picker offers only what this report's own rows can contain (§9.7.1). */
export async function getTemporaryContractFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const params: unknown[] = [];
  const scope: string[] = ['contract.started_as_temporary IS TRUE'];
  if (access.branchIds.length > 0) {
    scope.push(`contract.branch_id = ANY($${params.push(access.branchIds)}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    scope.push(contractSaleOwnerSql('contract', `$${params.push(access.userId)}`));
  }
  const where = `WHERE ${scope.join(' AND ')}`;

  const [sellers, departments, models, supervisors, technicians] = await Promise.all([
    pool.query(
      `SELECT DISTINCT seller.id::text AS value, seller.name AS label
         FROM contracts contract
         JOIN employees seller ON seller.id = contract.sale_owner_id
         ${where} AND NULLIF(BTRIM(seller.name), '') IS NOT NULL
        ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT department_type.id::text AS value, department_type.value AS label
         FROM contracts contract
         JOIN employees seller ON seller.id = contract.sale_owner_id
         JOIN departments department ON department.id = seller.department_id
         JOIN system_lists department_type ON department_type.id = department.department_type_id
         ${where} AND NULLIF(BTRIM(department_type.value), '') IS NOT NULL
        ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT
              CASE WHEN COALESCE(device.device_model_id, contract.device_model_id) IS NOT NULL
                   THEN 'catalog:' || COALESCE(device.device_model_id, contract.device_model_id)::text
                   ELSE 'external:' || COALESCE(device.external_device_name, device.device_model_name, contract.device_model_name, '') END AS value,
              ${DEVICE_MODEL_NAME_SQL} AS label
         FROM contracts contract
         LEFT JOIN LATERAL (${DEVICE_LATERAL_SQL}) device ON TRUE
         LEFT JOIN device_models model ON model.id = COALESCE(device.device_model_id, contract.device_model_id)
         ${where}
           AND ${DEVICE_MODEL_NAME_SQL} IS NOT NULL
        ORDER BY label`,
      params,
    ),
    ...['supervisor', 'technician'].map(role => pool.query(
      `SELECT DISTINCT installation.${role}_employee_id::text AS value,
              installation.${role}_name AS label
         FROM contracts contract
         LEFT JOIN LATERAL (${INSTALLATION_LATERAL_SQL}) installation ON TRUE
         ${where} AND installation.${role}_employee_id IS NOT NULL
        ORDER BY label`, params,
    )),
  ]);

  const option = (row: { value: unknown; label: unknown }) => ({ value: String(row.value), label: String(row.label) });
  return {
    contractSellers: sellers.rows.map(option),
    contractSellerDepartments: departments.rows.map(option),
    deviceModels: models.rows.map(option),
    supervisors: supervisors.rows.map(option),
    technicians: technicians.rows.map(option),
  };
}
