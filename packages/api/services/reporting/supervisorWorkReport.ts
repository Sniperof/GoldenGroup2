import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { employeeDimensionConditions, getEmployeeDimensionOptions } from './reportEmployeeDimension.js';
import {
  agreementsLateral, candidatesAddedLateral, damascusDayBounds, duesLateral, emergencyMoneyLateral,
  ownedSalesLateral, periodicMoneyLateral, reportDateFilter,
} from './fieldWorkLaterals.js';
import { OFFER_IS_CONVERTED_SQL } from './salesByTypeReport.js';

const WORK_ACTIVITY = new Set(['with_work', 'without_work']);

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface SupervisorWorkRow {
  branchId: number | null;
  employeeId: number;
  branchName: string;
  supervisorName: string;
  jobTitle: string | null;
  departmentName: string | null;
  employmentStatus: string;
  periodicDone: number;
  emergencyDone: number;
  maintenanceCollected: string;
  goldenWarrantyCollected: string;
  serviceAgreementsValue: string;
  serviceDuesCollected: string;
  scheduledTasks: number;
  totalExecutedTasks: number;
  executionRate: string | null;
  demosDone: number;
  definitiveSales: number;
  firstPayments: string;
  instantVisits: number;
  instantDemos: number;
  instantSales: number;
  candidatesAdded: number;
  candidatesPerExecutedTask: string | null;
  fieldDays: number;
  periodicWithinDue: number;
  periodicPastDue: number;
  goldenWarrantyOffers: number;
  temporaryContracts: number;
}

/** Which job titles are «مشرفة», read from an admin setting rather than pinned here. */
export const SUPERVISOR_TITLES_SETTING_KEY = 'supervisor_job_titles';

/** The supervisor of the visit, after any reassignment — as every visit report reads her. */
const VISIT_SUPERVISOR_ID_SQL =
  `COALESCE(visit.reassigned_supervisor_id, NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int)`;

const SUPERVISOR_TITLES_SQL = `SELECT BTRIM(title.value) AS job_title
        FROM system_settings setting
        CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(setting.value::jsonb) title(value)
       WHERE setting.key = '${SUPERVISOR_TITLES_SETTING_KEY}'
         AND NULLIF(BTRIM(title.value), '') IS NOT NULL`;

function optionalAllowListed(value: unknown, allowed: Set<string>, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!allowed.has(normalized)) throw new ReportingError(400, `${label} غير صالحة`);
  return normalized;
}

/**
 * The twin of the technician work report: the row is a supervisor drawn from the
 * STAFF table, so one with no work still appears (DEC-V). Two time axes live in one
 * row by decision (DEC-SW-2): what was scheduled reads the visit's scheduled date,
 * what was done reads the result's close date. Each population sits in its own
 * LATERAL so no two multiply.
 */
export function buildSupervisorWorkQuery(
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

  const fromDate = reportDateFilter(request.fromDate, 'بداية المدة');
  const toDate = reportDateFilter(request.toDate, 'نهاية المدة');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدة التقرير مطلوبة لتوليده');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية المدة يجب ألا تكون بعد نهايتها');
  params.push(fromDate);
  const fromRef = `$${params.length}`;
  params.push(toDate);
  const toRef = `$${params.length}`;
  const { fromStampSql, toStampSql } = damascusDayBounds(fromRef, toRef);

  const supervisorEmployeeId = positiveInt(request.supervisorEmployeeId);
  if (supervisorEmployeeId != null) {
    params.push(supervisorEmployeeId);
    rowFilters.push(`employee.id = $${params.length}`);
  }

  rowFilters.push(...employeeDimensionConditions(request, params, 'employee.id'));

  // «لها عمل» reads the same aggregate as the «إجمالي المهام المنفذة» column, so the
  // filter and the column can never disagree (§9.7.1). The request key is shared with
  // the technician report because the UI filter is the same one.
  const activity = optionalAllowListed(request.technicianActivity, WORK_ACTIVITY, 'حالة العمل');
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
    WITH supervisor_titles AS (
      ${SUPERVISOR_TITLES_SQL}
    ), executed AS (
      SELECT task.id AS visit_task_id,
             task.task_type,
             task.source_open_task_id,
             result.id AS result_id,
             result.closed_at,
             visit.origin_type,
             ${VISIT_SUPERVISOR_ID_SQL} AS supervisor_id
        FROM visit_tasks task
        JOIN visit_task_results result ON result.visit_task_id = task.id
        JOIN field_visits visit ON visit.id = task.field_visit_id
       WHERE result.closed_at >= ${fromStampSql}
         AND result.closed_at < ${toStampSql}
    ), scheduled AS (
      -- Every visit scheduled in the period with its tasks, in any status: what was
      -- planned for her, done or not (DEC-SW-2). A visit with no task still counts as
      -- an instant visit, so the tasks are LEFT JOINed.
      SELECT visit.id AS visit_id,
             visit.scheduled_date,
             visit.origin_type,
             task.id AS visit_task_id,
             ${VISIT_SUPERVISOR_ID_SQL} AS supervisor_id
        FROM field_visits visit
        LEFT JOIN visit_tasks task ON task.field_visit_id = visit.id
       WHERE visit.scheduled_date >= ${fromRef}::date
         AND visit.scheduled_date <= ${toRef}::date
    ), report_rows AS (
      SELECT employee.id, employee.branch_id, employee.name,
             employee.job_title, employee.status, employee.department_id
        FROM employees employee
       WHERE (
               (employee.status = 'active'
                 AND BTRIM(employee.job_title) IN (SELECT job_title FROM supervisor_titles))
               OR EXISTS (SELECT 1 FROM executed WHERE executed.supervisor_id = employee.id)
               OR EXISTS (SELECT 1 FROM scheduled WHERE scheduled.supervisor_id = employee.id)
             )
         ${rowFilters.map(filter => `AND ${filter}`).join('\n         ')}
    )
    SELECT row.branch_id AS "branchId",
           row.id AS "employeeId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           COALESCE(NULLIF(BTRIM(row.name), ''), 'مشرفة #' || row.id::text) AS "supervisorName",
           NULLIF(BTRIM(row.job_title), '') AS "jobTitle",
           NULLIF(BTRIM(department.name), '') AS "departmentName",
           CASE WHEN row.status = 'active' THEN 'على رأس العمل' ELSE 'خارج الخدمة' END AS "employmentStatus",
           COALESCE(tasks.periodic_done, 0) AS "periodicDone",
           COALESCE(tasks.emergency_done, 0) AS "emergencyDone",
           (COALESCE(periodic_money.collected, 0) + COALESCE(emergency_money.collected, 0))::numeric AS "maintenanceCollected",
           COALESCE(warranty_money.collected, 0)::numeric AS "goldenWarrantyCollected",
           COALESCE(agreements.value, 0)::numeric AS "serviceAgreementsValue",
           COALESCE(dues.service_dues, 0)::numeric AS "serviceDuesCollected",
           COALESCE(plan.scheduled_tasks, 0) AS "scheduledTasks",
           COALESCE(tasks.total_done, 0) AS "totalExecutedTasks",
           CASE WHEN COALESCE(plan.scheduled_tasks, 0) = 0 THEN NULL
                ELSE ROUND(COALESCE(tasks.total_done, 0) * 100.0 / plan.scheduled_tasks, 1)
           END AS "executionRate",
           COALESCE(tasks.demos_done, 0) AS "demosDone",
           COALESCE(sales.definitive_sales, 0) AS "definitiveSales",
           COALESCE(sales.first_payments, 0)::numeric AS "firstPayments",
           COALESCE(plan.instant_visits, 0) AS "instantVisits",
           COALESCE(tasks.instant_demos, 0) AS "instantDemos",
           COALESCE(tasks.instant_sales, 0) AS "instantSales",
           COALESCE(names.candidates_added, 0) AS "candidatesAdded",
           CASE WHEN COALESCE(tasks.total_done, 0) = 0 THEN NULL
                ELSE ROUND(COALESCE(names.candidates_added, 0)::numeric / tasks.total_done, 2)
           END AS "candidatesPerExecutedTask",
           COALESCE(plan.field_days, 0) AS "fieldDays",
           COALESCE(tasks.periodic_within, 0) AS "periodicWithinDue",
           COALESCE(tasks.periodic_past_due, 0) AS "periodicPastDue",
           COALESCE(tasks.warranty_offers, 0) AS "goldenWarrantyOffers",
           COALESCE(sales.temporary_contracts, 0) AS "temporaryContracts"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM report_rows row
      LEFT JOIN branches branch ON branch.id = row.branch_id
      LEFT JOIN departments department ON department.id = row.department_id
      LEFT JOIN LATERAL (
        SELECT COUNT(scheduled.visit_task_id)::int AS scheduled_tasks,
               COUNT(DISTINCT scheduled.scheduled_date)
                 FILTER (WHERE scheduled.visit_task_id IS NOT NULL)::int AS field_days,
               COUNT(DISTINCT scheduled.visit_id)
                 FILTER (WHERE scheduled.origin_type = 'field_initiated')::int AS instant_visits
          FROM scheduled
         WHERE scheduled.supervisor_id = row.id
      ) plan ON TRUE
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
                                       OR ${closedDaySql} > open_task.due_date))::int AS periodic_past_due,
               COUNT(*) FILTER (WHERE executed.task_type = 'device_demo'
                                  AND executed.origin_type = 'field_initiated')::int AS instant_demos,
               -- Converted by the contract behind the offer, not by the seller on it
               -- (DEC-SW-1): this is «a sale from a direct appointment».
               COUNT(*) FILTER (WHERE executed.task_type = 'device_demo'
                                  AND executed.origin_type = 'field_initiated'
                                  AND EXISTS (
                                    SELECT 1 FROM visit_task_device_demo_results demo
                                     WHERE demo.visit_task_result_id = executed.result_id
                                       AND ${OFFER_IS_CONVERTED_SQL}
                                  ))::int AS instant_sales
          FROM executed
          LEFT JOIN open_tasks open_task ON open_task.id = executed.source_open_task_id
         WHERE executed.supervisor_id = row.id
      ) tasks ON TRUE
      ${periodicMoneyLateral('supervisor_id')}
      ${emergencyMoneyLateral('supervisor_id')}
      ${duesLateral('supervisor_id')}
      ${agreementsLateral('supervisor_id')}
      LEFT JOIN LATERAL (
        -- By who received the money, not by who offered the warranty (DEC-SW-4): a
        -- later payment someone else collected is not hers. Refunds are netted out.
        SELECT COALESCE(SUM(CASE WHEN payment.entry_type = 'refund'
                                 THEN -payment.amount_syp ELSE payment.amount_syp END), 0)::numeric AS collected
          FROM device_warranty_payments payment
         WHERE payment.received_by_employee_id = row.id
           AND payment.received_at >= ${fromStampSql}
           AND payment.received_at < ${toStampSql}
      ) warranty_money ON TRUE
      ${ownedSalesLateral(fromRef, toRef, { firstPayment: true })}
      ${candidatesAddedLateral(fromStampSql, toStampSql)}
     ${activitySql}
     ORDER BY ${buildTabularReportOrderBy(
       'performance.supervisor_work', access, request,
       `COALESCE(tasks.total_done, 0) DESC, row.branch_id ASC NULLS LAST, row.id ASC`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getSupervisorWorkReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildSupervisorWorkQuery(access, request, options);
  const { rows } = await pool.query<SupervisorWorkRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * The supervisor picker offers the same people the report can show (§9.7.1): active
 * supervisors, plus anyone who was ever a visit's supervisor. The job-title picker is
 * narrowed to the titles the admin setting counts as «مشرفة».
 */
export async function getSupervisorWorkFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeIds = access.branchIds.length > 0 ? access.branchIds : null;
  const dimension = await getEmployeeDimensionOptions(
    access.branchIds,
    `AND BTRIM(employee.job_title) IN (${SUPERVISOR_TITLES_SQL})`,
  );
  const { rows } = await pool.query(`
    WITH supervisor_titles AS (
      ${SUPERVISOR_TITLES_SQL}
    )
    SELECT employee.id::text AS value,
           COALESCE(NULLIF(BTRIM(employee.name), ''), 'مشرفة #' || employee.id::text)
             || CASE WHEN employee.status = 'active' THEN '' ELSE ' (خارج الخدمة)' END AS label
      FROM employees employee
     WHERE ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
       AND (
         (employee.status = 'active'
           AND BTRIM(employee.job_title) IN (SELECT job_title FROM supervisor_titles))
         OR EXISTS (
           SELECT 1 FROM field_visits visit
            WHERE ${VISIT_SUPERVISOR_ID_SQL} = employee.id
         )
       )
     ORDER BY label
  `, [scopeIds]);
  return {
    ...dimension,
    supervisors: rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
