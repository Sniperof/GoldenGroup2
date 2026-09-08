import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { employeeDimensionConditions, getEmployeeDimensionOptions } from './reportEmployeeDimension.js';

const TECHNICIAN_ACTIVITY = new Set(['with_work', 'without_work']);

function optionalAllowListed(value: unknown, allowed: Set<string>, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!allowed.has(normalized)) throw new ReportingError(400, `${label} غير صالحة`);
  return normalized;
}

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface TechnicianWorkRow {
  branchId: number | null;
  employeeId: number;
  branchName: string;
  technicianName: string;
  jobTitle: string | null;
  departmentName: string | null;
  employmentStatus: string;
  periodicDone: number;
  periodicCollected: string;
  emergencyDone: number;
  emergencyCollected: string;
  serviceDuesCollected: string;
  contractDuesCollected: string;
  taskMoneyExcludingContractDues: string;
  serviceAgreementsValue: string;
  personalSaleInstalls: number;
  otherSaleInstalls: number;
  totalExecutedTasks: number;
  definitiveSales: number;
  periodicWithinDue: number;
  periodicPastDue: number;
  demosDone: number;
  candidatesAdded: number;
  goldenWarrantyOffers: number;
  temporaryContracts: number;
}

/** Which job titles are «فني», read from an admin setting rather than pinned here. */
export const TECHNICIAN_TITLES_SETTING_KEY = 'technician_job_titles';

/** A sale is what counts as a sale in every other report (§1.2). */
const COUNTED_CONTRACT_STATUSES_SQL = `('active', 'completed')`;

/** `contracts.contract_date` is VARCHAR, so it is read behind a shape guard. */
const CONTRACT_DATE_SHAPE_SQL = `contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`;

/** The technician who actually did the visit, after any reassignment. */
const VISIT_TECHNICIAN_ID_SQL =
  `COALESCE(visit.reassigned_technician_id, NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int)`;

const TECHNICIAN_TITLES_SQL = `SELECT BTRIM(title.value) AS job_title
        FROM system_settings setting
        CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(setting.value::jsonb) title(value)
       WHERE setting.key = '${TECHNICIAN_TITLES_SETTING_KEY}'
         AND NULLIF(BTRIM(title.value), '') IS NOT NULL`;

function dateFilter(value: unknown, label: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

/**
 * The row is a technician, and unlike every other report in this group the rows come
 * from the STAFF table rather than from the work: «كل الفنيين في الفروع» was the
 * request, and a technician with no work is a fact the manager wants to see, not an
 * empty row to hide. Each population sits in its own LATERAL so no two multiply.
 */
export function buildTechnicianWorkQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const rowFilters: string[] = [];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    rowFilters.push(`employee.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    rowFilters.push(`EXISTS (
        SELECT 1 FROM hr_users scoped_user
         WHERE scoped_user.id = $${params.length}
           AND scoped_user.employee_id = employee.id
      )`);
  }

  const fromDate = dateFilter(request.fromDate, 'بداية المدة');
  const toDate = dateFilter(request.toDate, 'نهاية المدة');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدة التقرير مطلوبة لتوليده');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية المدة يجب ألا تكون بعد نهايتها');
  params.push(fromDate);
  const fromRef = `$${params.length}`;
  params.push(toDate);
  const toRef = `$${params.length}`;

  // Damascus day boundaries as timestamps, so the filters stay indexable.
  const fromStampSql = `(${fromRef}::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`;
  const toStampSql = `((${toRef}::text::date + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`;

  const technicianEmployeeId = positiveInt(request.technicianEmployeeId);
  if (technicianEmployeeId != null) {
    params.push(technicianEmployeeId);
    rowFilters.push(`employee.id = $${params.length}`);
  }

  rowFilters.push(...employeeDimensionConditions(request, params, 'employee.id'));

  // «له عمل» reads the same aggregate as the «إجمالي مواعيد منفذة» column, so the
  // filter and the column can never disagree. It is a filter and not the default
  // because the row set is the staff list on purpose: a technician who executed
  // nothing all month is the finding, not a blank to hide (§9.7.1).
  const activity = optionalAllowListed(request.technicianActivity, TECHNICIAN_ACTIVITY, 'حالة العمل');
  const activitySql = activity === 'with_work'
    ? 'WHERE COALESCE(tasks.total_done, 0) > 0'
    : activity === 'without_work'
      ? 'WHERE COALESCE(tasks.total_done, 0) = 0'
      : '';

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  /** The day a task closed, in Damascus, which is what the due-date rule compares. */
  const closedDaySql = `(executed.closed_at AT TIME ZONE 'Asia/Damascus')::date`;

  const sql = `
    WITH technician_titles AS (
      ${TECHNICIAN_TITLES_SQL}
    ), executed AS (
      SELECT task.id AS visit_task_id,
             task.task_type,
             task.source_open_task_id,
             result.id AS result_id,
             result.closed_at,
             ${VISIT_TECHNICIAN_ID_SQL} AS technician_id
        FROM visit_tasks task
        JOIN visit_task_results result ON result.visit_task_id = task.id
        JOIN field_visits visit ON visit.id = task.field_visit_id
       WHERE result.closed_at >= ${fromStampSql}
         AND result.closed_at < ${toStampSql}
    ), report_rows AS (
      SELECT employee.id, employee.branch_id, employee.name,
             employee.job_title, employee.status, employee.department_id
        FROM employees employee
       WHERE (
               (employee.status = 'active'
                 AND BTRIM(employee.job_title) IN (SELECT job_title FROM technician_titles))
               OR EXISTS (SELECT 1 FROM executed WHERE executed.technician_id = employee.id)
             )
         ${rowFilters.map(filter => `AND ${filter}`).join('\n         ')}
    )
    SELECT row.branch_id AS "branchId",
           row.id AS "employeeId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           COALESCE(NULLIF(BTRIM(row.name), ''), 'فني #' || row.id::text) AS "technicianName",
           NULLIF(BTRIM(row.job_title), '') AS "jobTitle",
           NULLIF(BTRIM(department.name), '') AS "departmentName",
           CASE WHEN row.status = 'active' THEN 'على رأس العمل' ELSE 'خارج الخدمة' END AS "employmentStatus",
           COALESCE(tasks.periodic_done, 0) AS "periodicDone",
           COALESCE(periodic_money.collected, 0)::numeric AS "periodicCollected",
           COALESCE(tasks.emergency_done, 0) AS "emergencyDone",
           COALESCE(emergency_money.collected, 0)::numeric AS "emergencyCollected",
           COALESCE(dues.service_dues, 0)::numeric AS "serviceDuesCollected",
           COALESCE(dues.contract_dues, 0)::numeric AS "contractDuesCollected",
           (COALESCE(periodic_money.collected, 0) + COALESCE(emergency_money.collected, 0)
              + COALESCE(dues.service_dues, 0))::numeric AS "taskMoneyExcludingContractDues",
           COALESCE(agreements.value, 0)::numeric AS "serviceAgreementsValue",
           COALESCE(installs.personal_installs, 0) AS "personalSaleInstalls",
           COALESCE(installs.other_installs, 0) AS "otherSaleInstalls",
           COALESCE(tasks.total_done, 0) AS "totalExecutedTasks",
           COALESCE(sales.definitive_sales, 0) AS "definitiveSales",
           COALESCE(tasks.periodic_within, 0) AS "periodicWithinDue",
           COALESCE(tasks.periodic_past_due, 0) AS "periodicPastDue",
           COALESCE(tasks.demos_done, 0) AS "demosDone",
           COALESCE(names.candidates_added, 0) AS "candidatesAdded",
           COALESCE(tasks.warranty_offers, 0) AS "goldenWarrantyOffers",
           COALESCE(sales.temporary_contracts, 0) AS "temporaryContracts"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM report_rows row
      LEFT JOIN branches branch ON branch.id = row.branch_id
      LEFT JOIN departments department ON department.id = row.department_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_done,
               COUNT(*) FILTER (WHERE executed.task_type = 'periodic_maintenance')::int AS periodic_done,
               COUNT(*) FILTER (WHERE executed.task_type = 'emergency_maintenance')::int AS emergency_done,
               COUNT(*) FILTER (WHERE executed.task_type = 'device_demo')::int AS demos_done,
               COUNT(*) FILTER (WHERE executed.task_type = 'golden_warranty_offer')::int AS warranty_offers,
               COUNT(*) FILTER (WHERE executed.task_type = 'periodic_maintenance'
                                  AND open_task.due_date IS NOT NULL
                                  AND ${closedDaySql} <= open_task.due_date)::int AS periodic_within,
               COUNT(*) FILTER (WHERE executed.task_type = 'periodic_maintenance'
                                  AND (open_task.due_date IS NULL
                                       OR ${closedDaySql} > open_task.due_date))::int AS periodic_past_due
          FROM executed
          LEFT JOIN open_tasks open_task ON open_task.id = executed.source_open_task_id
         WHERE executed.technician_id = row.id
      ) tasks ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(movement.amount_syp), 0)::numeric AS collected
          FROM executed
          JOIN financial_movements movement
            ON movement.source_type = 'periodic_maintenance'
           AND movement.kind = 'payment'
           AND movement.source_id = executed.source_open_task_id
         WHERE executed.technician_id = row.id
           AND executed.task_type = 'periodic_maintenance'
      ) periodic_money ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(financials.collected_amount), 0)::numeric AS collected
          FROM executed
          JOIN visit_task_emergency_financials financials
            ON financials.visit_task_result_id = executed.result_id
         WHERE executed.technician_id = row.id
      ) emergency_money ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(collection.paid_amount_syp)
                 FILTER (WHERE collection.receivable_source_type = 'contract'), 0)::numeric AS contract_dues,
               COALESCE(SUM(collection.paid_amount_syp)
                 FILTER (WHERE collection.receivable_source_type IS DISTINCT FROM 'contract'), 0)::numeric AS service_dues
          FROM executed
          JOIN visit_task_installment_collection_results collection
            ON collection.visit_task_result_id = executed.result_id
         WHERE executed.technician_id = row.id
      ) dues ON TRUE
      LEFT JOIN LATERAL (
        -- Distinct agreement: two visits of the same agreement performed by the same
        -- technician must not add its fee twice.
        SELECT COALESCE(SUM(agreement.fee_syp), 0)::numeric AS value
          FROM (
            SELECT DISTINCT payload.service_agreement_id AS agreement_id
              FROM executed
              JOIN open_task_periodic_payload payload
                ON payload.open_task_id = executed.source_open_task_id
             WHERE executed.technician_id = row.id
               AND payload.service_agreement_id IS NOT NULL
          ) linked
          JOIN service_agreements agreement ON agreement.id = linked.agreement_id
      ) agreements ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE contract.sale_owner_id = row.id)::int AS personal_installs,
               COUNT(*) FILTER (WHERE contract.sale_owner_id IS NULL
                                  OR contract.sale_owner_id <> row.id)::int AS other_installs
          FROM executed
          LEFT JOIN open_tasks open_task ON open_task.id = executed.source_open_task_id
          LEFT JOIN installed_devices device ON device.id = open_task.device_id
          JOIN contracts contract
            ON contract.id = COALESCE(open_task.contract_id, device.contract_id)
         WHERE executed.technician_id = row.id
           AND executed.task_type = 'device_installation'
           AND contract.sale_subtype = 'definitive'
           AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
      ) installs ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE contract.sale_subtype = 'definitive'
                                  AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL})::int AS definitive_sales,
               COUNT(*) FILTER (WHERE contract.sale_subtype = 'temporary'
                                  AND contract.status <> 'cancelled')::int AS temporary_contracts
          FROM contracts contract
         WHERE contract.sale_owner_id = row.id
           AND ${CONTRACT_DATE_SHAPE_SQL}
           AND contract.contract_date >= ${fromRef}::text
           AND contract.contract_date <= ${toRef}::text
      ) sales ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS candidates_added
          FROM candidates candidate
          JOIN hr_users owner_account ON owner_account.id = candidate.owner_user_id
         WHERE owner_account.employee_id = row.id
           AND candidate.created_at >= ${fromStampSql}
           AND candidate.created_at < ${toStampSql}
      ) names ON TRUE
     ${activitySql}
     ORDER BY ${buildTabularReportOrderBy(
       'performance.technician_work', access, request,
       `COALESCE(tasks.total_done, 0) DESC, row.branch_id ASC NULLS LAST, row.id ASC`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getTechnicianWorkReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildTechnicianWorkQuery(access, request, options);
  const { rows } = await pool.query<TechnicianWorkRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * The technician picker offers the same people the report can show (§9.7.1), and the
 * job-title picker is narrowed to the titles the admin setting counts as «فني» — the
 * report has no rows for a «مشرفة», so offering her title would be a dead choice.
 */
export async function getTechnicianWorkFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeIds = access.branchIds.length > 0 ? access.branchIds : null;
  const dimension = await getEmployeeDimensionOptions(
    access.branchIds,
    `AND BTRIM(employee.job_title) IN (${TECHNICIAN_TITLES_SQL})`,
  );
  const { rows } = await pool.query(`
    WITH technician_titles AS (
      ${TECHNICIAN_TITLES_SQL}
    )
    SELECT employee.id::text AS value,
           COALESCE(NULLIF(BTRIM(employee.name), ''), 'فني #' || employee.id::text)
             || CASE WHEN employee.status = 'active' THEN '' ELSE ' (خارج الخدمة)' END AS label
      FROM employees employee
     WHERE ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
       AND BTRIM(employee.job_title) IN (SELECT job_title FROM technician_titles)
       AND (
         employee.status = 'active'
         OR EXISTS (
           SELECT 1 FROM field_visits visit
            WHERE COALESCE(visit.reassigned_technician_id,
                           NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int) = employee.id
         )
       )
     ORDER BY label
  `, [scopeIds]);
  return {
    ...dimension,
    technicians: rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
