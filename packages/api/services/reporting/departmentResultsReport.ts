import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { getEmployeeDimensionOptions } from './reportEmployeeDimension.js';
import { parseDeviceModelIds } from './salesByTypeReport.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface DepartmentResultsRow {
  branchId: number;
  departmentId: number | null;
  branchName: string;
  departmentName: string;
  dealerCount: number | null;
  scheduledDemoTasks: number;
  executedDemoTasks: number;
  offerRate: string | null;
  namesCount: number;
  namesPerOffer: string | null;
  salesPoints: string;
  saleRatio: string | null;
  pace: string | null;
  challengerSales: number;
  doubleMembraneSales: number;
  aquanovaSales: number;
  softenerStationSales: number;
  safeLifeSales: number;
  goldenSales: number;
  firstPaymentTotal: string;
  periodicDone: number;
  serviceRevenue: string;
  receivablesRevenue: string;
  totalRevenue: string;
}

/** A sale is what counts as a sale today, consistently across every population. */
const COUNTED_CONTRACT_STATUSES_SQL = `('active', 'completed')`;

/** `contracts.contract_date` is VARCHAR, so it is read behind a shape guard. */
const CONTRACT_DATE_SHAPE_SQL = `contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`;

/** The device model is read from the created device first, then from the contract. */
const DEVICE_MODEL_ID_SQL = `COALESCE(device.device_model_id, contract.device_model_id)`;

/** Money that belongs to the contract price, as opposed to task money. */
const CONTRACT_MONEY_SOURCES_SQL = `('contract', 'contract_installment', 'contract_payment')`;

/**
 * Which job title counts as «البائع» depends on the department: a marketing
 * department sells through dealers and marketing representatives, while a
 * customer-service department sells through its supervisors. The mapping is read from
 * the department type's own metadata (migration 452) and never hardcoded here, so a
 * new department type needs no code change.
 */
const SELLER_TITLES_SQL = `CASE WHEN JSONB_TYPEOF(dept_type.metadata->'sellerJobTitles') = 'array'
                  THEN ARRAY(SELECT JSONB_ARRAY_ELEMENTS_TEXT(dept_type.metadata->'sellerJobTitles')) END`;

/** The effective visit team member after any reassignment. */
const VISIT_SUPERVISOR_ID_SQL = `COALESCE(visit.reassigned_supervisor_id, NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int)`;
const VISIT_TECHNICIAN_ID_SQL = `COALESCE(visit.reassigned_technician_id, NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int)`;

function dateFilter(value: unknown, label: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

/**
 * Pace is a projection, not a comparison against a target (the schema holds no
 * targets): definitive sales × days in the month ÷ the day the period ends on. It is
 * anchored on the requested end date and never on «today», so reopening an old run
 * shows the same number. A period spanning more than one month has no «days in the
 * month», so the factor is null and the column reads «—» instead of a made-up value.
 */
export function paceFactor(fromDate: string, toDate: string): number | null {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (from.getUTCFullYear() !== to.getUTCFullYear() || from.getUTCMonth() !== to.getUTCMonth()) return null;
  const dayOfMonth = to.getUTCDate();
  const daysInMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  return daysInMonth / dayOfMonth;
}

/**
 * The row is a department, and most of what the report measures carries no department
 * (DEC-E). So each population resolves its own department and matches it against the
 * row — and the row whose department is NULL collects exactly what could not be
 * attributed, instead of dropping it out of the report.
 */
function departmentMatch(column: string): string {
  return `(CASE WHEN row.department_id IS NULL THEN ${column} IS NULL ELSE ${column} = row.department_id END)`;
}

export function buildDepartmentResultsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];

  let branchScopeSql = '';
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    branchScopeSql = ` WHERE branch.id = ANY($${params.length}::int[])`;
  }

  const fromDate = dateFilter(request.fromDate, 'بداية المدة');
  const toDate = dateFilter(request.toDate, 'نهاية المدة');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدة التقرير مطلوبة لتوليده');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية المدة يجب ألا تكون بعد نهايتها');
  params.push(fromDate);
  const fromRef = `$${params.length}`;
  params.push(toDate);
  const toRef = `$${params.length}`;

  // Damascus day boundaries as timestamps, so the timestamp filters stay indexable.
  const fromStampSql = `(${fromRef}::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`;
  const toStampSql = `((${toRef}::text::date + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`;

  const departmentTypeId = positiveInt(request.departmentTypeId);
  let departmentTypeSql = '';
  if (departmentTypeId != null) {
    params.push(departmentTypeId);
    departmentTypeSql = ` AND dept.department_type_id = $${params.length}`;
  }

  // One named department, beside the existing filter on its type. The row grain is a
  // department, so this narrows which rows exist and leaves every measure computed
  // over that department's own work. The «غير منسوب» row per branch is dropped with
  // it: work attributed to no department is not this department's work.
  const departmentId = positiveInt(request.departmentId);
  let departmentIdSql = '';
  let unattributedSql = `
      UNION ALL
      SELECT NULL::int, branch.id, 'غير منسوب إلى قسم', NULL::text[] FROM scope_branches branch`;
  if (departmentId != null) {
    params.push(departmentId);
    departmentIdSql = ` AND dept.id = $${params.length}`;
    unattributedSql = '';
  }

  const factor = paceFactor(fromDate, toDate);
  let paceSql = 'NULL::numeric AS "pace"';
  if (factor != null) {
    params.push(factor);
    paceSql = `ROUND(COALESCE(sales.definitive_sales, 0) * $${params.length}::numeric, 2) AS "pace"`;
  }

  // Optional per-run device columns, on top of the six fixed family columns.
  const deviceModelIds = parseDeviceModelIds(request);
  let deviceInLateralSql = '';
  let deviceInSelectSql = '';
  if (deviceModelIds.length > 0) {
    params.push(deviceModelIds);
    const idsRef = `$${params.length}::int[]`;
    deviceInLateralSql = deviceModelIds.map(id => `,
               COUNT(*) FILTER (WHERE ${DEVICE_MODEL_ID_SQL} = ${id})::int AS "deviceModel_${id}"`).join('')
      + `,
               COUNT(*) FILTER (WHERE ${DEVICE_MODEL_ID_SQL} = ANY(${idsRef}))::int AS "selectedDevicesTotal"`;
    deviceInSelectSql = deviceModelIds.map(id => `,
           COALESCE(sales."deviceModel_${id}", 0) AS "deviceModel_${id}"`).join('')
      + `,
           COALESCE(sales."selectedDevicesTotal", 0) AS "selectedDevicesTotal"`;
  }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    WITH scope_branches AS (
      SELECT branch.id, branch.name FROM branches branch${branchScopeSql}
    ), report_rows AS (
      SELECT dept.id AS department_id, dept.branch_id,
             COALESCE(NULLIF(BTRIM(dept.name), ''), 'قسم غير مسمّى') AS department_name,
             ${SELLER_TITLES_SQL} AS seller_titles
        FROM departments dept
        JOIN scope_branches branch ON branch.id = dept.branch_id
        LEFT JOIN system_lists dept_type ON dept_type.id = dept.department_type_id
       WHERE TRUE${departmentTypeSql}${departmentIdSql}${unattributedSql}
    )
    SELECT row.branch_id AS "branchId",
           row.department_id AS "departmentId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           row.department_name AS "departmentName",
           sellers.seller_count AS "dealerCount",
           COALESCE(demos.scheduled_demos, 0) AS "scheduledDemoTasks",
           COALESCE(demos.executed_demos, 0) AS "executedDemoTasks",
           CASE WHEN COALESCE(demos.scheduled_demos, 0) > 0
                THEN ROUND(demos.executed_demos * 100.0 / demos.scheduled_demos, 1) END AS "offerRate",
           COALESCE(names.names_count, 0) AS "namesCount",
           CASE WHEN COALESCE(demos.executed_demos, 0) > 0
                THEN ROUND(names.names_count::numeric / demos.executed_demos, 2) END AS "namesPerOffer",
           COALESCE(sales.sales_points, 0)::numeric AS "salesPoints",
           CASE WHEN COALESCE(sales.definitive_sales, 0) > 0
                THEN ROUND(COALESCE(demos.executed_demos, 0)::numeric / sales.definitive_sales, 2) END AS "saleRatio",
           ${paceSql},
           COALESCE(sales.challenger_sales, 0) AS "challengerSales",
           COALESCE(sales.double_membrane_sales, 0) AS "doubleMembraneSales",
           COALESCE(sales.aquanova_sales, 0) AS "aquanovaSales",
           COALESCE(sales.softener_station_sales, 0) AS "softenerStationSales",
           COALESCE(sales.safe_life_sales, 0) AS "safeLifeSales",
           COALESCE(sales.golden_sales, 0) AS "goldenSales",
           COALESCE(sales.first_payment_total, 0)::numeric AS "firstPaymentTotal",
           COALESCE(periodic.periodic_done, 0) AS "periodicDone",
           COALESCE(money.service_revenue, 0)::numeric AS "serviceRevenue",
           COALESCE(money.receivables_revenue, 0)::numeric AS "receivablesRevenue",
           (COALESCE(sales.first_payment_total, 0) + COALESCE(money.service_revenue, 0)
              + COALESCE(money.receivables_revenue, 0))::numeric AS "totalRevenue"${deviceInSelectSql}
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM report_rows row
      JOIN branches branch ON branch.id = row.branch_id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN row.seller_titles IS NULL THEN NULL::int ELSE (
                 SELECT COUNT(*)::int
                   FROM employees emp
                  WHERE emp.branch_id = row.branch_id
                    AND emp.status = 'active'
                    AND emp.job_title = ANY(row.seller_titles)
                    AND ${departmentMatch('emp.department_id')}
               ) END AS seller_count
      ) sellers ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS scheduled_demos,
               COUNT(result.id)::int AS executed_demos
          FROM visit_tasks task
          JOIN field_visits visit ON visit.id = task.field_visit_id
          LEFT JOIN visit_task_results result ON result.visit_task_id = task.id
          LEFT JOIN employees performer ON performer.id = ${VISIT_SUPERVISOR_ID_SQL}
         WHERE task.task_type = 'device_demo'
           AND visit.branch_id = row.branch_id
           AND visit.scheduled_date >= ${fromRef}::text::date
           AND visit.scheduled_date <= ${toRef}::text::date
           AND ${departmentMatch('performer.department_id')}
      ) demos ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS names_count
          FROM candidates candidate
          LEFT JOIN hr_users owner_account ON owner_account.id = candidate.owner_user_id
          LEFT JOIN employees owner_employee ON owner_employee.id = owner_account.employee_id
         WHERE candidate.branch_id = row.branch_id
           AND candidate.created_at >= ${fromStampSql}
           AND candidate.created_at < ${toStampSql}
           AND ${departmentMatch('owner_employee.department_id')}
      ) names ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS definitive_sales,
               COALESCE(SUM(model.sale_points), 0)::numeric AS sales_points,
               COUNT(*) FILTER (WHERE model.sale_family = 'challenger')::int AS challenger_sales,
               COUNT(*) FILTER (WHERE model.sale_family = 'double_membrane')::int AS double_membrane_sales,
               COUNT(*) FILTER (WHERE model.sale_family = 'aquanova')::int AS aquanova_sales,
               COUNT(*) FILTER (WHERE model.sale_family IN ('softener', 'station'))::int AS softener_station_sales,
               COUNT(*) FILTER (WHERE model.sale_family = 'safe_life')::int AS safe_life_sales,
               COUNT(*) FILTER (WHERE model.sale_family = 'golden')::int AS golden_sales,
               COALESCE(SUM(first_payment.amount_syp), 0)::numeric AS first_payment_total${deviceInLateralSql}
          FROM contracts contract
          LEFT JOIN employees owner ON owner.id = contract.sale_owner_id
          LEFT JOIN installed_devices device ON device.contract_id = contract.id
          LEFT JOIN device_models model ON model.id = ${DEVICE_MODEL_ID_SQL}
          LEFT JOIN LATERAL (
            SELECT movement.amount_syp
              FROM financial_movements movement
             WHERE movement.contract_id = contract.id
               AND movement.kind = 'payment'
               AND movement.source_type IN ${CONTRACT_MONEY_SOURCES_SQL}
             ORDER BY movement.occurred_at ASC, movement.id ASC
             LIMIT 1
          ) first_payment ON TRUE
         WHERE contract.branch_id = row.branch_id
           AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
           AND contract.sale_subtype = 'definitive'
           AND ${CONTRACT_DATE_SHAPE_SQL}
           AND contract.contract_date >= ${fromRef}::text
           AND contract.contract_date <= ${toRef}::text
           AND ${departmentMatch('owner.department_id')}
      ) sales ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS periodic_done
          FROM open_tasks task
          JOIN visit_tasks visit_task ON visit_task.source_open_task_id = task.id
          JOIN visit_task_results result ON result.visit_task_id = visit_task.id
          JOIN field_visits visit ON visit.id = visit_task.field_visit_id
          LEFT JOIN employees performer
                 ON performer.id = COALESCE(${VISIT_TECHNICIAN_ID_SQL}, ${VISIT_SUPERVISOR_ID_SQL})
         WHERE task.task_type = 'periodic_maintenance'
           AND task.status = 'completed'
           AND task.branch_id = row.branch_id
           AND result.closed_at >= ${fromStampSql}
           AND result.closed_at < ${toStampSql}
           AND ${departmentMatch('performer.department_id')}
      ) periodic ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(movement.amount_syp) FILTER (
                 WHERE movement.source_type NOT IN ${CONTRACT_MONEY_SOURCES_SQL}), 0)::numeric AS service_revenue,
               COALESCE(SUM(movement.amount_syp) FILTER (
                 WHERE movement.source_type IN ${CONTRACT_MONEY_SOURCES_SQL}
                   AND EXISTS (
                     SELECT 1 FROM financial_movements earlier
                      WHERE earlier.contract_id = movement.contract_id
                        AND earlier.kind = 'payment'
                        AND earlier.source_type IN ${CONTRACT_MONEY_SOURCES_SQL}
                        AND (earlier.occurred_at, earlier.id) < (movement.occurred_at, movement.id)
                   )), 0)::numeric AS receivables_revenue
          FROM financial_movements movement
          LEFT JOIN contracts money_contract ON money_contract.id = movement.contract_id
          LEFT JOIN employees money_owner ON money_owner.id = money_contract.sale_owner_id
         WHERE movement.kind = 'payment'
           AND COALESCE(money_contract.branch_id, movement.occurred_branch_id) = row.branch_id
           AND movement.occurred_at >= ${fromStampSql}
           AND movement.occurred_at < ${toStampSql}
           AND ${departmentMatch('money_owner.department_id')}
      ) money ON TRUE
     WHERE row.department_id IS NOT NULL
        OR COALESCE(sellers.seller_count, 0) + COALESCE(demos.scheduled_demos, 0)
         + COALESCE(names.names_count, 0) + COALESCE(sales.definitive_sales, 0)
         + COALESCE(periodic.periodic_done, 0) + COALESCE(money.service_revenue, 0)
         + COALESCE(money.receivables_revenue, 0) + COALESCE(sales.first_payment_total, 0) > 0
     ORDER BY ${buildTabularReportOrderBy(
       'performance.department_results', access, request,
       `COALESCE(sales.first_payment_total, 0) DESC, row.branch_id ASC, row.department_id ASC NULLS LAST`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getDepartmentResultsReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildDepartmentResultsQuery(access, request, options);
  const { rows } = await pool.query<DepartmentResultsRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * Department types come from the managed list and are limited to the types that
 * actually exist inside the caller's branch scope; the device options are the whole
 * catalogue, as in the sales-by-type report.
 */
export async function getDepartmentResultsFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const params: unknown[] = [];
  let scopeSql = '';
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    scopeSql = ` AND dept.branch_id = ANY($${params.length}::int[])`;
  }
  const [types, models] = await Promise.all([
    pool.query(`
      SELECT DISTINCT list.id::text AS value, list.value AS label
        FROM departments dept
        JOIN system_lists list ON list.id = dept.department_type_id
       WHERE NULLIF(BTRIM(list.value), '') IS NOT NULL${scopeSql}
       ORDER BY label
    `, params),
    pool.query(`
      SELECT model.id::text AS value,
             COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''),
                      NULLIF(BTRIM(model.name), ''), 'جهاز #' || model.id::text)
               || CASE WHEN model.is_active THEN '' ELSE ' (غير نشط)' END AS label
        FROM device_models model
       WHERE model.deleted_at IS NULL
       ORDER BY model.is_active DESC, label
    `),
  ]);
  return {
    ...await getEmployeeDimensionOptions(access.branchIds),
    departmentTypes: types.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    deviceModels: models.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
