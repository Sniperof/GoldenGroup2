import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { employeeDimensionConditions, getEmployeeDimensionOptions } from './reportEmployeeDimension.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

const CALL_BOOKING_PRESENCE = new Set(['booked', 'not_booked']);

function callBookingPresence(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!CALL_BOOKING_PRESENCE.has(normalized)) throw new ReportingError(400, 'نتيجة الحجز غير صالحة');
  return normalized;
}

export interface CustomerCallsRow {
  branchId: number | null;
  employeeId: number | null;
  branchName: string;
  employeeName: string;
  jobTitle: string | null;
  departmentName: string | null;
  marketingAttempts: number;
  marketingAppointments: number;
  demosExecuted: number;
  demoExecutionRate: string | null;
  periodicAttempts: number;
  periodicAppointments: number;
  periodicExecuted: number;
  periodicExecutionRate: string | null;
  bookedWithinDue: number;
  bookedPastDue: number;
  marketingSales: number;
  serviceSales: number;
  totalSales: number;
  collectionsCount: number;
  otherAppointments: number;
  otherExecuted: number;
  totalAppointments: number;
  totalExecuted: number;
  overallExecutionRate: string | null;
  otherAttempts: number;
  totalCalls: number;
  distinctCustomers: number;
  callsPerActiveDay: string | null;
}

/** The call that books an appointment; every appointment column starts here. */
const BOOKING_OUTCOME_SQL = `'booked_marketing_appointment'`;

/** A sale is what counts as a sale in every other report (§1.2). */
const COUNTED_CONTRACT_STATUSES_SQL = `('active', 'completed')`;

/**
 * Which task a call was ABOUT (DEC-R). The write path links a call to every sibling
 * task of the same contact target so the call shows on their pages, so a link alone
 * proves nothing. The subject is the link marked as such; failing that, the only link
 * the call has; failing that, unknown — and an unknown subject is counted under «other
 * attempts» instead of being spread across the columns by guesswork.
 */
const SUBJECT_LINK_SQL = `LEFT JOIN LATERAL (
        SELECT link.task_id, task.task_type,
               COALESCE(link.task_due_date_snapshot, task.due_date) AS due_at_call
          FROM call_task_links link
          JOIN open_tasks task ON task.id = link.task_id
         WHERE link.call_id = call_log.id
           AND (link.is_primary
                OR (SELECT COUNT(*) FROM call_task_links solo WHERE solo.call_id = call_log.id) = 1)
         ORDER BY link.is_primary DESC, link.task_id ASC
         LIMIT 1
      ) subject ON TRUE`;

function dateFilter(value: unknown, label: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

/**
 * The row is an employee inside a branch, and the calls themselves produce the rows:
 * a call from an account with no employee record collects into one «غير منسوب» row per
 * branch instead of dropping out. Two aggregates meet at the grain — one over calls,
 * one over the distinct tasks those calls booked — so a task called twice counts as
 * one appointment while both attempts still count as attempts.
 */
export function buildCustomerCallsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = [];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`call_log.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (
      SELECT 1 FROM hr_users scoped_user
       WHERE scoped_user.id = $${params.length}
         AND scoped_user.employee_id IS NOT NULL
         AND scoped_user.employee_id = caller.employee_id
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

  // Damascus day boundaries as timestamps, so the filter stays indexable.
  const fromStampSql = `(${fromRef}::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`;
  const toStampSql = `((${toRef}::text::date + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`;

  const employeeId = positiveInt(request.employeeId);
  if (employeeId != null) {
    params.push(employeeId);
    filters.push(`caller.employee_id = $${params.length}`);
  }

  const callOutcome = typeof request.callOutcome === 'string' && request.callOutcome.trim()
    ? request.callOutcome.trim() : null;
  if (callOutcome != null) {
    params.push(callOutcome);
    filters.push(`call_log.outcome = $${params.length}`);
  }

  filters.push(...employeeDimensionConditions(request, params, 'caller.employee_id'));

  // «حجز» reads the «إجمالي المواعيد» column, which is the report's own answer to
  // whether the calling turned into work. A «له مكالمات» filter would be inert
  // instead: the row exists only because a call exists, so it can never be zero.
  const bookingPresence = callBookingPresence(request.callBookingPresence);
  const bookingSql = bookingPresence === 'booked'
    ? 'WHERE COALESCE(task_totals.total_appointments, 0) > 0'
    : bookingPresence === 'not_booked'
      ? 'WHERE COALESCE(task_totals.total_appointments, 0) = 0'
      : '';

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  /** The call's own day in Damascus, which is what every date comparison uses. */
  const callDaySql = `(resolved.call_date AT TIME ZONE 'Asia/Damascus')::date`;

  const sql = `
    WITH resolved AS (
      SELECT call_log.id AS call_id,
             call_log.customer_id,
             call_log.branch_id,
             call_log.call_date,
             caller.employee_id,
             subject.task_id,
             subject.task_type,
             subject.due_at_call,
             (call_log.outcome = ${BOOKING_OUTCOME_SQL}) AS is_booking
        FROM customer_call_logs call_log
        LEFT JOIN hr_users caller ON caller.id = call_log.caller_id
        ${SUBJECT_LINK_SQL}
       WHERE call_log.call_date >= ${fromStampSql}
         AND call_log.call_date < ${toStampSql}
         ${filters.map(filter => `AND ${filter}`).join('\n         ')}
    ), booked_tasks AS (
      SELECT resolved.branch_id, resolved.employee_id, resolved.task_id, resolved.task_type,
             EXISTS (
               SELECT 1 FROM visit_tasks visit_task
                 JOIN visit_task_results result ON result.visit_task_id = visit_task.id
                WHERE visit_task.source_open_task_id = resolved.task_id
             ) AS executed,
             EXISTS (
               SELECT 1 FROM contracts contract
                WHERE contract.source_open_task_id = resolved.task_id
                  AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
                  AND contract.sale_subtype = 'definitive'
             ) AS sold,
             EXISTS (
               SELECT 1 FROM visit_tasks visit_task
                 JOIN visit_task_results result ON result.visit_task_id = visit_task.id
                 JOIN visit_task_installment_collection_results collection
                   ON collection.visit_task_result_id = result.id
                WHERE visit_task.source_open_task_id = resolved.task_id
                  AND collection.paid_amount_syp > 0
             ) AS collected
        FROM resolved
       WHERE resolved.is_booking AND resolved.task_id IS NOT NULL
       GROUP BY 1, 2, 3, 4
    ), call_totals AS (
      SELECT resolved.branch_id, resolved.employee_id,
             COUNT(*)::int AS total_calls,
             COUNT(*) FILTER (WHERE resolved.task_type = 'device_demo')::int AS marketing_attempts,
             COUNT(*) FILTER (WHERE resolved.task_type = 'periodic_maintenance')::int AS periodic_attempts,
             COUNT(*) FILTER (WHERE resolved.task_type IS NULL
                                OR resolved.task_type NOT IN ('device_demo', 'periodic_maintenance'))::int AS other_attempts,
             COUNT(DISTINCT resolved.customer_id)::int AS distinct_customers,
             COUNT(DISTINCT ${callDaySql})::int AS active_days,
             COUNT(*) FILTER (WHERE resolved.is_booking AND resolved.due_at_call IS NOT NULL
                                AND ${callDaySql} <= resolved.due_at_call)::int AS booked_within_due,
             COUNT(*) FILTER (WHERE resolved.is_booking AND resolved.due_at_call IS NOT NULL
                                AND ${callDaySql} > resolved.due_at_call)::int AS booked_past_due
        FROM resolved
       GROUP BY 1, 2
    ), task_totals AS (
      SELECT booked_tasks.branch_id, booked_tasks.employee_id,
             COUNT(*) FILTER (WHERE booked_tasks.task_type = 'device_demo')::int AS marketing_appointments,
             COUNT(*) FILTER (WHERE booked_tasks.task_type = 'device_demo' AND booked_tasks.executed)::int AS demos_executed,
             COUNT(*) FILTER (WHERE booked_tasks.task_type = 'periodic_maintenance')::int AS periodic_appointments,
             COUNT(*) FILTER (WHERE booked_tasks.task_type = 'periodic_maintenance' AND booked_tasks.executed)::int AS periodic_executed,
             COUNT(*) FILTER (WHERE booked_tasks.task_type = 'device_demo' AND booked_tasks.sold)::int AS marketing_sales,
             COUNT(*) FILTER (WHERE booked_tasks.task_type <> 'device_demo' AND booked_tasks.sold)::int AS service_sales,
             COUNT(*) FILTER (WHERE booked_tasks.collected)::int AS collections_count,
             COUNT(*) FILTER (WHERE COALESCE(booked_tasks.task_type, '') NOT IN ('device_demo', 'periodic_maintenance'))::int AS other_appointments,
             COUNT(*) FILTER (WHERE COALESCE(booked_tasks.task_type, '') NOT IN ('device_demo', 'periodic_maintenance')
                                AND booked_tasks.executed)::int AS other_executed,
             COUNT(*)::int AS total_appointments,
             COUNT(*) FILTER (WHERE booked_tasks.executed)::int AS total_executed
        FROM booked_tasks
       GROUP BY 1, 2
    )
    SELECT call_totals.branch_id AS "branchId",
           call_totals.employee_id AS "employeeId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           COALESCE(NULLIF(BTRIM(employee.name), ''), 'غير منسوب إلى موظف') AS "employeeName",
           NULLIF(BTRIM(employee.job_title), '') AS "jobTitle",
           NULLIF(BTRIM(department.name), '') AS "departmentName",
           call_totals.marketing_attempts AS "marketingAttempts",
           COALESCE(task_totals.marketing_appointments, 0) AS "marketingAppointments",
           COALESCE(task_totals.demos_executed, 0) AS "demosExecuted",
           CASE WHEN COALESCE(task_totals.marketing_appointments, 0) > 0
                THEN ROUND(task_totals.demos_executed * 100.0 / task_totals.marketing_appointments, 1) END AS "demoExecutionRate",
           call_totals.periodic_attempts AS "periodicAttempts",
           COALESCE(task_totals.periodic_appointments, 0) AS "periodicAppointments",
           COALESCE(task_totals.periodic_executed, 0) AS "periodicExecuted",
           CASE WHEN COALESCE(task_totals.periodic_appointments, 0) > 0
                THEN ROUND(task_totals.periodic_executed * 100.0 / task_totals.periodic_appointments, 1) END AS "periodicExecutionRate",
           call_totals.booked_within_due AS "bookedWithinDue",
           call_totals.booked_past_due AS "bookedPastDue",
           COALESCE(task_totals.marketing_sales, 0) AS "marketingSales",
           COALESCE(task_totals.service_sales, 0) AS "serviceSales",
           (COALESCE(task_totals.marketing_sales, 0) + COALESCE(task_totals.service_sales, 0)) AS "totalSales",
           COALESCE(task_totals.collections_count, 0) AS "collectionsCount",
           COALESCE(task_totals.other_appointments, 0) AS "otherAppointments",
           COALESCE(task_totals.other_executed, 0) AS "otherExecuted",
           COALESCE(task_totals.total_appointments, 0) AS "totalAppointments",
           COALESCE(task_totals.total_executed, 0) AS "totalExecuted",
           CASE WHEN COALESCE(task_totals.total_appointments, 0) > 0
                THEN ROUND(task_totals.total_executed * 100.0 / task_totals.total_appointments, 1) END AS "overallExecutionRate",
           call_totals.other_attempts AS "otherAttempts",
           call_totals.total_calls AS "totalCalls",
           call_totals.distinct_customers AS "distinctCustomers",
           CASE WHEN call_totals.active_days > 0
                THEN ROUND(call_totals.total_calls::numeric / call_totals.active_days, 2) END AS "callsPerActiveDay"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM call_totals
      LEFT JOIN task_totals
             ON task_totals.branch_id IS NOT DISTINCT FROM call_totals.branch_id
            AND task_totals.employee_id IS NOT DISTINCT FROM call_totals.employee_id
      LEFT JOIN branches branch ON branch.id = call_totals.branch_id
      LEFT JOIN employees employee ON employee.id = call_totals.employee_id
      LEFT JOIN departments department ON department.id = employee.department_id
     ${bookingSql}
     ORDER BY ${buildTabularReportOrderBy(
       'performance.customer_calls', access, request,
       `call_totals.total_calls DESC, call_totals.branch_id ASC NULLS LAST, call_totals.employee_id ASC NULLS LAST`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getCustomerCallsReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildCustomerCallsQuery(access, request, options);
  const { rows } = await pool.query<CustomerCallsRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * The employee list offers everyone who could be calling — the active staff plus
 * anyone who actually logged a call inside the requested period even after leaving —
 * and the outcome list offers only the outcomes recorded inside the caller's own
 * scope, so neither dropdown reveals what the report itself would not show (§9.7.1).
 */
export async function getCustomerCallsFilterOptions(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeIds = access.branchIds.length > 0 ? access.branchIds : null;
  const fromDate = dateFilter(request.fromDate, 'بداية المدة');
  const toDate = dateFilter(request.toDate, 'نهاية المدة');

  const [employees, outcomes] = await Promise.all([
    pool.query(`
      SELECT employee.id::text AS value,
             COALESCE(NULLIF(BTRIM(employee.name), ''), 'موظف #' || employee.id::text)
               || CASE WHEN employee.status = 'active' THEN '' ELSE ' (خارج الخدمة)' END AS label
        FROM employees employee
       WHERE ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
         AND (
           employee.status = 'active'
           OR EXISTS (
             SELECT 1
               FROM customer_call_logs call_log
               JOIN hr_users caller ON caller.id = call_log.caller_id
              WHERE caller.employee_id = employee.id
                AND ($2::text IS NULL OR (call_log.call_date AT TIME ZONE 'Asia/Damascus')::date >= $2::date)
                AND ($3::text IS NULL OR (call_log.call_date AT TIME ZONE 'Asia/Damascus')::date <= $3::date)
                AND ($1::int[] IS NULL OR call_log.branch_id = ANY($1::int[]))
           )
         )
       ORDER BY label
    `, [scopeIds, fromDate, toDate]),
    pool.query(`
      SELECT DISTINCT call_log.outcome AS value, call_log.outcome AS label
        FROM customer_call_logs call_log
       WHERE NULLIF(BTRIM(call_log.outcome), '') IS NOT NULL
         AND ($1::int[] IS NULL OR call_log.branch_id = ANY($1::int[]))
       ORDER BY label
    `, [scopeIds]),
  ]);

  return {
    ...await getEmployeeDimensionOptions(access.branchIds),
    callEmployees: employees.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    callOutcomes: outcomes.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
