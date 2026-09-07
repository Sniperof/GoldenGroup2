import pool from '../../db.js';
import { buildClientLifecycleStatusSql, eligiblePersonalOwnerCondition } from '../customerOwnership.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';

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

  const employeeId = positiveInt(request.employeeId);
  if (employeeId != null) {
    params.push(employeeId);
    filters.push(`employee.id = $${params.length}`);
  }
  const geoIds = String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value)).filter((value): value is number => value != null);
  if (geoIds.length > 0) {
    params.push(Array.from(new Set(geoIds)));
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
  const employeeId = positiveInt(request.employeeId);
  if (employeeId != null) { params.push(employeeId); filters.push(`demo_supervisor.id = $${params.length}`); }
  const geoIds = String(request.geoIds ?? request.geoUnitId ?? '').split(',').map(value => positiveInt(value)).filter((value): value is number => value != null);
  if (geoIds.length > 0) { params.push(Array.from(new Set(geoIds))); filters.push(`COALESCE(c.neighborhood,c.district) = ANY($${params.length}::int[])`); }
  return filters.length ? ` AND ${filters.join(' AND ')}` : '';
}

export function buildWorkFilesGeoSupervisorsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [ACTIVE_DEVICE_DEMO_STATUSES];
  const filters = appendFilters(access, request, params);
  const closedDemoFilters = appendClosedDemoFilters(access, request, params);
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
    LEFT JOIN visit_candidates latest_visit
      ON latest_visit.branch_id = report_rows.branch_id
     AND latest_visit.supervisor_employee_id = report_rows.employee_id
     AND latest_visit.geo_unit_id = report_rows.geo_unit_id
     AND latest_visit.visit_rank = 1
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
