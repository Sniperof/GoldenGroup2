import pool from '../../db.js';
import { buildClientLifecycleStatusSql, eligiblePersonalOwnerCondition } from '../customerOwnership.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

const ACTIVE_DEVICE_DEMO_STATUSES = [
  'open',
  'needs_follow_up',
  'assigned',
  'in_scheduling',
  'scheduled',
  'waiting_execution',
  'in_execution',
  'ended',
] as const;

export interface WorkFilesGeoSupervisorRow {
  branchId: number;
  branchName: string;
  employeeId: number;
  employeeName: string;
  departmentName: string | null;
  geoUnitId: number;
  geoUnitName: string;
  leadCount: number;
  salesFollowUpCount: number;
  fopClosedDemoCount: number;
  opClosedDemoCount: number;
  lastVisitAt: string | null;
  lastVisitTechnicianName: string | null;
}

export interface WorkFilesGeoSupervisorsResult {
  rows: WorkFilesGeoSupervisorRow[];
  total: number;
}

interface QueryOptions {
  offset?: number;
  limit: number;
  includeTotalRows?: boolean;
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value))
    .filter((value): value is number => value != null)));
}

/**
 * The row's subject is the supervisor, so her department is read off her employee
 * record through the department's type — the same admin-managed list every other
 * report's «نوع القسم» filter uses.
 */
function departmentTypeCondition(supervisorAlias: string, placeholder: string): string {
  return `EXISTS (
        SELECT 1 FROM departments supervisor_department
         WHERE supervisor_department.id = ${supervisorAlias}.department_id
           AND supervisor_department.department_type_id = ${placeholder}
      )`;
}

function dateOnly(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

function appendFilters(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  params: unknown[],
): string {
  const filters: string[] = [];
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`c.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`owner.id = $${params.length}`);
  }

  const supervisorEmployeeId = positiveInt(request.supervisorEmployeeId);
  if (supervisorEmployeeId != null) {
    params.push(supervisorEmployeeId);
    filters.push(`employee.id = $${params.length}`);
  }
  const departmentTypeId = positiveInt(request.departmentTypeId);
  if (departmentTypeId != null) {
    params.push(departmentTypeId);
    filters.push(departmentTypeCondition('employee', `$${params.length}`));
  }
  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    filters.push(`COALESCE(c.neighborhood, c.district) = ANY($${params.length}::int[])`);
  }
  return filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
}

function appendClosedDemoFilters(access: TabularReportAccess, request: TabularReportRequestParams, params: unknown[]): string {
  const filters: string[] = [];
  if (access.branchIds.length > 0) { params.push(access.branchIds); filters.push(`c.branch_id = ANY($${params.length}::int[])`); }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (SELECT 1 FROM hr_users scoped_user WHERE scoped_user.id=$${params.length} AND scoped_user.employee_id=demo_supervisor.id)`);
  }
  const supervisorEmployeeId = positiveInt(request.supervisorEmployeeId);
  if (supervisorEmployeeId != null) { params.push(supervisorEmployeeId); filters.push(`demo_supervisor.id = $${params.length}`); }
  const departmentTypeId = positiveInt(request.departmentTypeId);
  if (departmentTypeId != null) {
    params.push(departmentTypeId);
    filters.push(departmentTypeCondition('demo_supervisor', `$${params.length}`));
  }
  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) { params.push(geoIds); filters.push(`COALESCE(c.neighborhood,c.district) = ANY($${params.length}::int[])`); }
  return filters.length ? ` AND ${filters.join(' AND ')}` : '';
}

/**
 * Filters that read the «آخر زيارة» pair. They cannot sit inside the CTEs: the
 * displayed values are whatever survived the rank=1 pick, so narrowing earlier would
 * promote an older visit into the columns and answer a different question (§9.7.1).
 * Both therefore drop rows with no recorded visit at all, which is what «آخر زيارة
 * ضمن هذا المدى» and «الفني المرافق فلان» each mean.
 */
function latestVisitConditions(request: TabularReportRequestParams, params: unknown[]): string {
  const conditions: string[] = [];
  const technicianId = positiveInt(request.accompanyingTechnicianId);
  if (technicianId != null) {
    params.push(technicianId);
    conditions.push(`latest_visit.technician_employee_id = $${params.length}`);
  }
  const from = dateOnly(request.lastVisitFrom, 'بداية مدى آخر زيارة');
  const to = dateOnly(request.lastVisitTo, 'نهاية مدى آخر زيارة');
  if (from && to && from > to) {
    throw new ReportingError(400, 'بداية مدى آخر زيارة يجب ألا تكون بعد نهايته');
  }
  if (from) {
    params.push(from);
    conditions.push(`latest_visit.actual_end_time >= ($${params.length}::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`);
  }
  if (to) {
    params.push(to);
    conditions.push(`latest_visit.actual_end_time < (($${params.length}::text::date + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`);
  }
  return conditions.length > 0 ? `\n    WHERE ${conditions.join('\n      AND ')}` : '';
}

export function buildWorkFilesGeoSupervisorsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [ACTIVE_DEVICE_DEMO_STATUSES];
  const filters = appendFilters(access, request, params);
  const closedDemoFilters = appendClosedDemoFilters(access, request, params);
  const latestVisitFilters = latestVisitConditions(request, params);
  params.push(options.limit);
  const limitPlaceholder = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const lifecycleStatus = buildClientLifecycleStatusSql('c');
  const eligibleOwner = eligiblePersonalOwnerCondition('owner', 'owner_role', 'employee');

  const sql = `
    WITH owned_leads AS (
      SELECT
        c.id AS client_id,
        c.branch_id,
        branch.name AS branch_name,
        owner.id AS owner_user_id,
        employee.id AS employee_id,
        employee.name AS employee_name,
        COALESCE(c.neighborhood, c.district) AS geo_unit_id,
        geo.name AS geo_unit_name
      FROM clients c
      JOIN branches branch ON branch.id = c.branch_id
      JOIN client_assignments assignment ON assignment.client_id = c.id
      JOIN hr_users owner ON owner.id = assignment.hr_user_id
      JOIN roles owner_role ON owner_role.id = owner.role_id
      JOIN employees employee ON employee.id = owner.employee_id
      JOIN geo_units geo ON geo.id = COALESCE(c.neighborhood, c.district)
      WHERE c.deleted_at IS NULL
        AND c.is_active IS NOT FALSE
        AND (${lifecycleStatus}) = 'LEAD'
        AND owner_role.team_slot_type = 'SUPERVISOR'
        AND ${eligibleOwner}
        AND COALESCE(c.neighborhood, c.district) IS NOT NULL
        ${filters}
    ),
    grouped AS (
      SELECT
        branch_id,
        branch_name,
        owner_user_id,
        employee_id,
        employee_name,
        geo_unit_id,
        geo_unit_name,
        COUNT(DISTINCT client_id)::int AS lead_count
      FROM owned_leads
      GROUP BY branch_id, branch_name, owner_user_id, employee_id, employee_name, geo_unit_id, geo_unit_name
    ),
    active_followup_clients AS (
      SELECT DISTINCT
        c.branch_id,
        branch.name AS branch_name,
        followup_supervisor.id AS employee_id,
        followup_supervisor.name AS employee_name,
        COALESCE(c.neighborhood,c.district) AS geo_unit_id,
        geo.name AS geo_unit_name,
        ot.client_id
      FROM open_tasks ot
      JOIN clients c ON c.id=ot.client_id
      JOIN branches branch ON branch.id=c.branch_id
      JOIN geo_units geo ON geo.id=COALESCE(c.neighborhood,c.district)
      LEFT JOIN LATERAL (
        SELECT COALESCE(fv.reassigned_supervisor_id,NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int) AS employee_id
        FROM visit_tasks vt
        JOIN field_visits fv ON fv.id=vt.field_visit_id
        WHERE vt.source_open_task_id=ot.id AND fv.status<>'cancelled'
        ORDER BY fv.created_at DESC,fv.id DESC LIMIT 1
      ) visit_owner ON TRUE
      LEFT JOIN LATERAL (
        SELECT assigned_employee.id AS employee_id
        FROM client_assignments ca
        JOIN hr_users assigned_user ON assigned_user.id=ca.hr_user_id
        JOIN roles assigned_role ON assigned_role.id=assigned_user.role_id
        JOIN employees assigned_employee ON assigned_employee.id=assigned_user.employee_id
        WHERE ca.client_id=c.id
          AND assigned_role.team_slot_type='SUPERVISOR'
          AND ${eligiblePersonalOwnerCondition('assigned_user','assigned_role','assigned_employee')}
        ORDER BY ca.assigned_at DESC,ca.id DESC LIMIT 1
      ) current_owner ON TRUE
      JOIN employees followup_supervisor ON followup_supervisor.id=COALESCE(
        visit_owner.employee_id,
        NULLIF(ot.team_snapshot->>'supervisorEmployeeId','')::int,
        current_owner.employee_id
      )
      WHERE ot.task_type='device_demo'
        AND ot.status=ANY($1::text[])
        AND c.deleted_at IS NULL
        AND c.is_active IS NOT FALSE
        AND COALESCE(c.neighborhood,c.district) IS NOT NULL
        ${closedDemoFilters.replaceAll('demo_supervisor', 'followup_supervisor')}
    ),
    active_followup_grouped AS (
      SELECT branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name,
        COUNT(DISTINCT client_id)::int AS sales_follow_up_count
      FROM active_followup_clients
      GROUP BY branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name
    ),
    closed_demo_clients AS (
      SELECT DISTINCT
        c.branch_id,
        branch.name AS branch_name,
        demo_supervisor.id AS employee_id,
        demo_supervisor.name AS employee_name,
        COALESCE(c.neighborhood,c.district) AS geo_unit_id,
        geo.name AS geo_unit_name,
        ot.client_id,
        (${lifecycleStatus}) AS lifecycle_status
      FROM open_tasks ot
      JOIN clients c ON c.id=ot.client_id
      JOIN visit_tasks vt ON vt.source_open_task_id=ot.id AND vt.task_type='device_demo'
      JOIN field_visits fv ON fv.id=vt.field_visit_id
      JOIN employees demo_supervisor ON demo_supervisor.id=COALESCE(
        fv.reassigned_supervisor_id,
        NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int
      )
      JOIN branches branch ON branch.id=c.branch_id
      JOIN geo_units geo ON geo.id=COALESCE(c.neighborhood,c.district)
      WHERE ot.task_type='device_demo'
        AND ot.status='closed'
        AND c.deleted_at IS NULL
        AND c.is_active IS NOT FALSE
        AND COALESCE(c.neighborhood,c.district) IS NOT NULL
        AND (${lifecycleStatus}) IN ('FOP','OP')
        ${closedDemoFilters}
    ),
    closed_demo_grouped AS (
      SELECT branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name,
        COUNT(DISTINCT client_id) FILTER (WHERE lifecycle_status='FOP')::int AS fop_closed_demo_count,
        COUNT(DISTINCT client_id) FILTER (WHERE lifecycle_status='OP')::int AS op_closed_demo_count
      FROM closed_demo_clients
      GROUP BY branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name
    ),
    report_dimensions AS (
      SELECT branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name FROM grouped
      UNION
      SELECT branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name FROM active_followup_grouped
      UNION
      SELECT branch_id,branch_name,employee_id,employee_name,geo_unit_id,geo_unit_name FROM closed_demo_grouped
    ),
    report_rows AS (
      SELECT d.*,
        COALESCE(g.lead_count,0)::int AS lead_count,
        COALESCE(af.sales_follow_up_count,0)::int AS sales_follow_up_count,
        COALESCE(cd.fop_closed_demo_count,0)::int AS fop_closed_demo_count,
        COALESCE(cd.op_closed_demo_count,0)::int AS op_closed_demo_count
      FROM report_dimensions d
      LEFT JOIN grouped g USING (branch_id,employee_id,geo_unit_id)
      LEFT JOIN active_followup_grouped af USING (branch_id,employee_id,geo_unit_id)
      LEFT JOIN closed_demo_grouped cd USING (branch_id,employee_id,geo_unit_id)
    ),
    visit_candidates AS (
      SELECT
        fv.branch_id,
        COALESCE(
          fv.reassigned_supervisor_id,
          NULLIF(fv.team_snapshot->>'supervisorEmployeeId', '')::int
        ) AS supervisor_employee_id,
        COALESCE(vc.neighborhood, vc.district) AS geo_unit_id,
        vgl.actual_end_time,
        CASE
          WHEN fv.reassigned_technician_id IS NOT NULL THEN reassigned_technician.name
          ELSE COALESCE(
            NULLIF(fv.team_snapshot->>'technicianName', ''),
            snapshot_technician.name
          )
        END AS technician_name,
        -- The identity behind that name, for the picker. A legacy snapshot that kept
        -- only a name has no id, so such a row matches no technician choice rather
        -- than being matched by a name comparison that Arabic spelling can break.
        COALESCE(
          fv.reassigned_technician_id,
          NULLIF(fv.team_snapshot->>'technicianEmployeeId', '')::int
        ) AS technician_employee_id,
        ROW_NUMBER() OVER (
          PARTITION BY
            fv.branch_id,
            COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId', '')::int),
            COALESCE(vc.neighborhood, vc.district)
          ORDER BY vgl.actual_end_time DESC, fv.id DESC
        ) AS visit_rank
      FROM field_visits fv
      JOIN visit_geo_logs vgl ON vgl.visit_id = fv.id AND vgl.actual_end_time IS NOT NULL
      JOIN clients vc ON vc.id = fv.client_id
      JOIN report_rows visit_group
        ON visit_group.branch_id = fv.branch_id
       AND visit_group.employee_id = COALESCE(
         fv.reassigned_supervisor_id,
         NULLIF(fv.team_snapshot->>'supervisorEmployeeId', '')::int
       )
       AND visit_group.geo_unit_id = COALESCE(vc.neighborhood, vc.district)
      LEFT JOIN employees reassigned_technician ON reassigned_technician.id = fv.reassigned_technician_id
      LEFT JOIN employees snapshot_technician
        ON snapshot_technician.id = NULLIF(fv.team_snapshot->>'technicianEmployeeId', '')::int
      WHERE COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId', '')::int) IS NOT NULL
        AND COALESCE(vc.neighborhood, vc.district) IS NOT NULL
    )
    SELECT
      report_rows.branch_id AS "branchId",
      report_rows.branch_name AS "branchName",
      report_rows.employee_id AS "employeeId",
      report_rows.employee_name AS "employeeName",
      NULLIF(BTRIM(supervisor_department.name), '') AS "departmentName",
      report_rows.geo_unit_id AS "geoUnitId",
      report_rows.geo_unit_name AS "geoUnitName",
      report_rows.lead_count AS "leadCount",
      report_rows.sales_follow_up_count AS "salesFollowUpCount",
      report_rows.fop_closed_demo_count AS "fopClosedDemoCount",
      report_rows.op_closed_demo_count AS "opClosedDemoCount",
      latest_visit.actual_end_time AS "lastVisitAt",
      latest_visit.technician_name AS "lastVisitTechnicianName"
      ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
    FROM report_rows
    LEFT JOIN employees supervisor_employee ON supervisor_employee.id = report_rows.employee_id
    LEFT JOIN departments supervisor_department ON supervisor_department.id = supervisor_employee.department_id
    LEFT JOIN visit_candidates latest_visit
      ON latest_visit.branch_id = report_rows.branch_id
     AND latest_visit.supervisor_employee_id = report_rows.employee_id
     AND latest_visit.geo_unit_id = report_rows.geo_unit_id
     AND latest_visit.visit_rank = 1${latestVisitFilters}
    ORDER BY ${buildTabularReportOrderBy(
      'work_files.geo_supervisors', access, request,
      'report_rows.employee_name, report_rows.geo_unit_name, report_rows.employee_id, report_rows.geo_unit_id',
    )}
    LIMIT ${limitPlaceholder}${offsetSql}`;

  return { sql, params };
}

export async function getWorkFilesGeoSupervisorsReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): Promise<WorkFilesGeoSupervisorsResult> {
  const query = buildWorkFilesGeoSupervisorsQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  return {
    total: Number(rows[0]?.totalRows ?? 0),
    rows: rows.map(row => ({
      branchId: Number(row.branchId),
      branchName: String(row.branchName),
      employeeId: Number(row.employeeId),
      employeeName: String(row.employeeName),
      departmentName: row.departmentName == null ? null : String(row.departmentName),
      geoUnitId: Number(row.geoUnitId),
      geoUnitName: String(row.geoUnitName),
      leadCount: Number(row.leadCount),
      salesFollowUpCount: Number(row.salesFollowUpCount),
      fopClosedDemoCount: Number(row.fopClosedDemoCount),
      opClosedDemoCount: Number(row.opClosedDemoCount),
      lastVisitAt: row.lastVisitAt == null ? null : new Date(row.lastVisitAt).toISOString(),
      lastVisitTechnicianName: row.lastVisitTechnicianName == null ? null : String(row.lastVisitTechnicianName),
    })),
  };
}

/**
 * Each picker offers only what this report can put in a row for this user (§9.7.1):
 * supervisors are the ones holding a SUPERVISOR team slot inside the granted
 * branches, and the technicians are those who actually appear on a recorded visit
 * there — never the full staff directory.
 */
export async function getWorkFilesGeoSupervisorsFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeIds = access.branchIds.length > 0 ? access.branchIds : null;
  const [supervisors, technicians, departmentTypes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT employee.id::text AS value, employee.name AS label
         FROM hr_users supervisor_user
         JOIN roles supervisor_role ON supervisor_role.id = supervisor_user.role_id
         JOIN employees employee ON employee.id = supervisor_user.employee_id
        WHERE supervisor_role.team_slot_type = 'SUPERVISOR'
          AND ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
          AND NULLIF(BTRIM(employee.name), '') IS NOT NULL
        ORDER BY label`,
      [scopeIds],
    ),
    pool.query(
      `SELECT DISTINCT employee.id::text AS value, employee.name AS label
         FROM field_visits fv
         JOIN visit_geo_logs vgl ON vgl.visit_id = fv.id AND vgl.actual_end_time IS NOT NULL
         JOIN employees employee
           ON employee.id = COALESCE(fv.reassigned_technician_id,
                                     NULLIF(fv.team_snapshot->>'technicianEmployeeId', '')::int)
        WHERE ($1::int[] IS NULL OR fv.branch_id = ANY($1::int[]))
          AND NULLIF(BTRIM(employee.name), '') IS NOT NULL
        ORDER BY label`,
      [scopeIds],
    ),
    pool.query(
      `SELECT DISTINCT department_type.id::text AS value, department_type.value AS label
         FROM hr_users supervisor_user
         JOIN roles supervisor_role ON supervisor_role.id = supervisor_user.role_id
         JOIN employees employee ON employee.id = supervisor_user.employee_id
         JOIN departments department ON department.id = employee.department_id
         JOIN system_lists department_type ON department_type.id = department.department_type_id
        WHERE supervisor_role.team_slot_type = 'SUPERVISOR'
          AND ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
        ORDER BY label`,
      [scopeIds],
    ),
  ]);
  return {
    supervisors: supervisors.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    accompanyingTechnicians: technicians.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    departmentTypes: departmentTypes.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
