// ============================================================
// reportEmployeeDimension.ts — the shared staff dimension of the roll-up reports
// ============================================================
// The performance reports whose row grain is a person (technician, caller, seller)
// all displayed «الصفة» and «القسم» while offering no way to filter by them: a
// branch manager could read that a technician sits in maintenance, and could not
// ask for the maintenance technicians. The three predicates live here once so the
// reports cannot drift into three spellings of the same question (§9.7.1).
//
// Every predicate is expressed as an EXISTS over `employees` keyed by whatever
// expression the report already uses to identify its person — `caller.employee_id`,
// `contract.sale_owner_id`, `employee.id` — so a report adopts the dimension without
// rearranging its joins. A row whose person is NULL (the «غير منسوب» row each of
// these reports carries) matches none of them, which is correct: an unattributed row
// belongs to no department and holds no job title.
// ============================================================

import type { TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import pool from '../../db.js';

/** Whether the person is still on staff. Kept as two values, never as a free string. */
const EMPLOYMENT_STATUSES = new Set(['active', 'inactive']);

export function employmentStatusFilter(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!EMPLOYMENT_STATUSES.has(normalized)) throw new ReportingError(400, 'حالة الخدمة غير صالحة');
  return normalized;
}

/**
 * The department, job title and employment-status predicates for one report.
 *
 * `personIdSql` is the report's own expression for the row's employee id. The
 * conditions are returned rather than appended, so each report keeps deciding where
 * they belong — a WHERE on the row source for some, a CTE filter for others.
 */
export function employeeDimensionConditions(
  request: TabularReportRequestParams,
  params: unknown[],
  personIdSql: string,
): string[] {
  const conditions: string[] = [];

  const departmentId = positiveInt(request.departmentId);
  if (departmentId != null) {
    params.push(departmentId);
    conditions.push(`EXISTS (
        SELECT 1 FROM employees dimension_employee
         WHERE dimension_employee.id = ${personIdSql}
           AND dimension_employee.department_id = $${params.length}
      )`);
  }

  // Compared on the trimmed value because the picker offers the trimmed value: an
  // employee saved with a trailing space would otherwise never match her own title.
  const jobTitle = typeof request.jobTitle === 'string' && request.jobTitle.trim()
    ? request.jobTitle.trim() : null;
  if (jobTitle != null) {
    params.push(jobTitle);
    conditions.push(`EXISTS (
        SELECT 1 FROM employees dimension_employee
         WHERE dimension_employee.id = ${personIdSql}
           AND BTRIM(dimension_employee.job_title) = $${params.length}
      )`);
  }

  const employmentStatus = employmentStatusFilter(request.employmentStatus);
  if (employmentStatus === 'active') {
    conditions.push(`EXISTS (
        SELECT 1 FROM employees dimension_employee
         WHERE dimension_employee.id = ${personIdSql}
           AND dimension_employee.status = 'active'
      )`);
  } else if (employmentStatus === 'inactive') {
    conditions.push(`EXISTS (
        SELECT 1 FROM employees dimension_employee
         WHERE dimension_employee.id = ${personIdSql}
           AND dimension_employee.status IS DISTINCT FROM 'active'
      )`);
  }

  return conditions;
}

/**
 * The department and job-title pickers, scoped to the granted branches.
 *
 * `jobTitleCondition` lets a report narrow the titles to the population it actually
 * reports on — the technician report has no business offering «مشرفة» — while the
 * department list stays the branch's own departments either way.
 */
export async function getEmployeeDimensionOptions(
  branchIds: number[],
  jobTitleCondition = '',
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeIds = branchIds.length > 0 ? branchIds : null;
  const [departments, jobTitles] = await Promise.all([
    pool.query(`
      SELECT department.id::text AS value,
             COALESCE(NULLIF(BTRIM(department.name), ''), 'قسم #' || department.id::text)
               || CASE WHEN $2::boolean THEN ' — ' || COALESCE(NULLIF(BTRIM(branch.name), ''), 'فرع غير مسمّى')
                       ELSE '' END AS label
        FROM departments department
        LEFT JOIN branches branch ON branch.id = department.branch_id
       WHERE ($1::int[] IS NULL OR department.branch_id = ANY($1::int[]))
       ORDER BY label
    `, [scopeIds, scopeIds == null]),
    pool.query(`
      SELECT DISTINCT BTRIM(employee.job_title) AS value, BTRIM(employee.job_title) AS label
        FROM employees employee
       WHERE NULLIF(BTRIM(employee.job_title), '') IS NOT NULL
         AND ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
         ${jobTitleCondition}
       ORDER BY label
    `, [scopeIds]),
  ]);
  return {
    departments: departments.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    jobTitles: jobTitles.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
