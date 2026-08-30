import pool from '../../db.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';

export interface DailyVisitReportRow {
  visitId: number;
  branchId: number;
  branchName: string;
  visitDate: string;
  supervisorName: string | null;
  technicianName: string | null;
  telemarketerName: string | null;
  traineeName: string | null;
  visitTime: string | null;
  appointmentNotes: string | null;
  geoUnitId: number | null;
  geoUnitName: string | null;
  visitLocation: string | null;
  gpsMissingReason: string | null;
  clientName: string;
  clientNotes: string | null;
  primaryContactNumber: string | null;
  actualStartAt: string | null;
  visitStatus: string;
  cancellationReason: string | null;
  cancellationNotes: string | null;
  taskCount: number;
  actualNamesCount: number;
}

interface QueryOptions {
  offset?: number;
  limit: number;
}

const VISIT_STATUS_LABELS = {
  scheduled: 'مجدولة',
  in_progress: 'قيد التنفيذ',
  ended: 'منتهية ميدانياً',
  completed: 'مكتملة',
  not_completed: 'لم تكتمل',
  cancelled: 'ملغاة',
  closed: 'مغلقة',
} as const;

type VisitStatus = keyof typeof VISIT_STATUS_LABELS;

export interface DailyVisitFilterOption {
  value: string;
  label: string;
}

export interface DailyVisitFilterOptions {
  supervisors: DailyVisitFilterOption[];
  technicians: DailyVisitFilterOption[];
  telemarketers: DailyVisitFilterOption[];
  visitStatuses: DailyVisitFilterOption[];
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function requireDailyVisitDateRange(request: TabularReportRequestParams) {
  if (!validIsoDate(request.fromDate) || !validIsoDate(request.toDate)) {
    throw new ReportingError(400, 'يجب تحديد تاريخ بداية ونهاية صالحين للتقرير');
  }
  if (request.fromDate > request.toDate) {
    throw new ReportingError(400, 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية');
  }
  return { fromDate: request.fromDate, toDate: request.toDate };
}

function appendVisitFilters(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  params: unknown[],
) {
  const filters: string[] = [];
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`fv.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (
      SELECT 1
      FROM hr_users scoped_user
      WHERE scoped_user.id = $${params.length}
        AND scoped_user.is_active = TRUE
        AND (
          fv.booked_by_telemarketer_id = scoped_user.id
          OR scoped_user.employee_id = COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
          OR scoped_user.employee_id = COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
          OR scoped_user.employee_id = COALESCE(fv.reassigned_trainee_id, NULLIF(fv.team_snapshot->>'traineeEmployeeId','')::int)
        )
    )`);
  }

  const employeeId = positiveInt(request.employeeId);
  if (employeeId != null) {
    params.push(employeeId);
    filters.push(`(
      $${params.length} = COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
      OR $${params.length} = COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
      OR $${params.length} = COALESCE(fv.reassigned_trainee_id, NULLIF(fv.team_snapshot->>'traineeEmployeeId','')::int)
      OR $${params.length} = telemarketer_employee.id
    )`);
  }

  const supervisorEmployeeId = positiveInt(request.supervisorEmployeeId);
  if (supervisorEmployeeId != null) {
    params.push(supervisorEmployeeId);
    filters.push(`COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int) = $${params.length}`);
  }

  const technicianEmployeeId = positiveInt(request.technicianEmployeeId);
  if (technicianEmployeeId != null) {
    params.push(technicianEmployeeId);
    filters.push(`COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int) = $${params.length}`);
  }

  const telemarketerUserId = positiveInt(request.telemarketerUserId);
  if (telemarketerUserId != null) {
    params.push(telemarketerUserId);
    filters.push(`fv.booked_by_telemarketer_id = $${params.length}`);
  }

  if (request.visitStatus != null && request.visitStatus !== '') {
    if (!(request.visitStatus in VISIT_STATUS_LABELS)) {
      throw new ReportingError(400, 'حالة الزيارة المحددة غير صالحة');
    }
    params.push(request.visitStatus);
    filters.push(`fv.status = $${params.length}`);
  }

  const geoIds = String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',')
    .map(value => positiveInt(value))
    .filter((value): value is number => value != null);
  if (geoIds.length > 0) {
    params.push(Array.from(new Set(geoIds)));
    filters.push(`COALESCE(c.neighborhood,c.district) = ANY($${params.length}::int[])`);
  }
  return filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
}

export function buildDailyVisitsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const range = requireDailyVisitDateRange(request);
  const params: unknown[] = [range.fromDate, range.toDate];
  const filters = appendVisitFilters(access, request, params);
  params.push(options.limit);
  const limitPlaceholder = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT
      fv.id AS "visitId",
      fv.branch_id AS "branchId",
      branch.name AS "branchName",
      TO_CHAR(fv.scheduled_date,'YYYY-MM-DD') AS "visitDate",
      COALESCE(supervisor.name,NULLIF(fv.team_snapshot->>'supervisorName','')) AS "supervisorName",
      COALESCE(technician.name,NULLIF(fv.team_snapshot->>'technicianName','')) AS "technicianName",
      COALESCE(telemarketer_employee.name,telemarketer_user.name) AS "telemarketerName",
      COALESCE(trainee.name,NULLIF(fv.team_snapshot->>'traineeName','')) AS "traineeName",
      NULLIF(LEFT(fv.scheduled_time,5),'') AS "visitTime",
      COALESCE(NULLIF(BTRIM(fv.field_instructions),''),NULLIF(BTRIM(fv.telemarketer_notes),''),NULLIF(BTRIM(fv.field_notes),'')) AS "appointmentNotes",
      COALESCE(c.neighborhood,c.district) AS "geoUnitId",
      geo.name AS "geoUnitName",
      CASE WHEN geo_log.actual_start_lat IS NOT NULL AND geo_log.actual_start_lng IS NOT NULL
        THEN 'https://www.google.com/maps?q=' || geo_log.actual_start_lat::text || ',' || geo_log.actual_start_lng::text
        ELSE NULL END AS "visitLocation",
      CASE WHEN geo_log.location_missing IS TRUE THEN gps_reason.value ELSE NULL END AS "gpsMissingReason",
      COALESCE(NULLIF(fv.customer_snapshot->>'name',''),c.name) AS "clientName",
      NULLIF(BTRIM(c.notes),'') AS "clientNotes",
      COALESCE(NULLIF(fv.customer_snapshot->>'mobile',''),NULLIF(c.mobile,'')) AS "primaryContactNumber",
      geo_log.actual_start_time AT TIME ZONE 'Asia/Damascus' AS "actualStartAt",
      CASE fv.status
        WHEN 'scheduled' THEN 'مجدولة'
        WHEN 'in_progress' THEN 'قيد التنفيذ'
        WHEN 'ended' THEN 'منتهية ميدانياً'
        WHEN 'completed' THEN 'مكتملة'
        WHEN 'not_completed' THEN 'لم تكتمل'
        WHEN 'cancelled' THEN 'ملغاة'
        WHEN 'closed' THEN 'مغلقة'
        ELSE fv.status
      END AS "visitStatus",
      CASE WHEN fv.status='cancelled' THEN cancellation_reason.value ELSE NULL END AS "cancellationReason",
      CASE WHEN fv.status='cancelled' THEN NULLIF(BTRIM(fv.cancellation_notes),'') ELSE NULL END AS "cancellationNotes",
      COALESCE(task_summary.task_count,0)::int AS "taskCount",
      COALESCE(sheet_summary.actual_names_count,0)::int AS "actualNamesCount",
      COUNT(*) OVER()::int AS "totalRows"
    FROM field_visits fv
    JOIN clients c ON c.id=fv.client_id
    JOIN branches branch ON branch.id=fv.branch_id
    LEFT JOIN geo_units geo ON geo.id=COALESCE(c.neighborhood,c.district)
    LEFT JOIN visit_geo_logs geo_log ON geo_log.visit_id=fv.id
    LEFT JOIN system_lists gps_reason ON gps_reason.id=geo_log.location_missing_reason
    LEFT JOIN system_lists cancellation_reason ON cancellation_reason.id=fv.cancellation_reason_id
    LEFT JOIN employees supervisor ON supervisor.id=COALESCE(fv.reassigned_supervisor_id,NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
    LEFT JOIN employees technician ON technician.id=COALESCE(fv.reassigned_technician_id,NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
    LEFT JOIN employees trainee ON trainee.id=COALESCE(fv.reassigned_trainee_id,NULLIF(fv.team_snapshot->>'traineeEmployeeId','')::int)
    LEFT JOIN hr_users telemarketer_user ON telemarketer_user.id=fv.booked_by_telemarketer_id
    LEFT JOIN employees telemarketer_employee ON telemarketer_employee.id=telemarketer_user.employee_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS task_count FROM visit_tasks vt WHERE vt.field_visit_id=fv.id
    ) task_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(MAX(rs.total_candidates),0)::int AS actual_names_count
      FROM referral_sheets rs WHERE rs.field_visit_id=fv.id
    ) sheet_summary ON TRUE
    WHERE fv.scheduled_date BETWEEN $1::date AND $2::date
      ${filters}
    ORDER BY fv.scheduled_date DESC,LEFT(COALESCE(fv.scheduled_time,''),5) DESC,fv.id DESC
    LIMIT ${limitPlaceholder}${offsetSql}`;
  return { sql, params };
}

export async function getDailyVisitsReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildDailyVisitsQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  return {
    total: Number(rows[0]?.totalRows ?? 0),
    rows: rows.map(row => ({
      visitId: Number(row.visitId),
      branchId: Number(row.branchId),
      branchName: String(row.branchName),
      visitDate: String(row.visitDate),
      supervisorName: row.supervisorName == null ? null : String(row.supervisorName),
      technicianName: row.technicianName == null ? null : String(row.technicianName),
      telemarketerName: row.telemarketerName == null ? null : String(row.telemarketerName),
      traineeName: row.traineeName == null ? null : String(row.traineeName),
      visitTime: row.visitTime == null ? null : String(row.visitTime),
      appointmentNotes: row.appointmentNotes == null ? null : String(row.appointmentNotes),
      geoUnitId: row.geoUnitId == null ? null : Number(row.geoUnitId),
      geoUnitName: row.geoUnitName == null ? null : String(row.geoUnitName),
      visitLocation: row.visitLocation == null ? null : String(row.visitLocation),
      gpsMissingReason: row.gpsMissingReason == null ? null : String(row.gpsMissingReason),
      clientName: String(row.clientName),
      clientNotes: row.clientNotes == null ? null : String(row.clientNotes),
      primaryContactNumber: row.primaryContactNumber == null ? null : String(row.primaryContactNumber),
      actualStartAt: row.actualStartAt == null ? null : new Date(row.actualStartAt).toISOString(),
      visitStatus: String(row.visitStatus),
      cancellationReason: row.cancellationReason == null ? null : String(row.cancellationReason),
      cancellationNotes: row.cancellationNotes == null ? null : String(row.cancellationNotes),
      taskCount: Number(row.taskCount),
      actualNamesCount: Number(row.actualNamesCount),
    } satisfies DailyVisitReportRow)),
  };
}

function buildFilterOptionsAccess(access: TabularReportAccess) {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`fv.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (
      SELECT 1 FROM hr_users scoped_user
      WHERE scoped_user.id = $${params.length}
        AND scoped_user.is_active = TRUE
        AND (
          fv.booked_by_telemarketer_id = scoped_user.id
          OR scoped_user.employee_id = COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
          OR scoped_user.employee_id = COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
          OR scoped_user.employee_id = COALESCE(fv.reassigned_trainee_id, NULLIF(fv.team_snapshot->>'traineeEmployeeId','')::int)
        )
    )`);
  }
  return { params, where: filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '' };
}

function mapNamedOptions(rows: Array<{ value: unknown; label: unknown }>): DailyVisitFilterOption[] {
  return rows
    .filter(row => row.value != null && row.label != null && String(row.label).trim() !== '')
    .map(row => ({ value: String(row.value), label: String(row.label) }));
}

export async function getDailyVisitsFilterOptions(access: TabularReportAccess): Promise<DailyVisitFilterOptions> {
  const { params, where } = buildFilterOptionsAccess(access);
  const [supervisors, technicians, telemarketers, statuses] = await Promise.all([
    pool.query(
      `SELECT DISTINCT employee.id AS value, employee.name AS label
       FROM field_visits fv
       JOIN employees employee ON employee.id=COALESCE(fv.reassigned_supervisor_id,NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
       ${where} ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT employee.id AS value, employee.name AS label
       FROM field_visits fv
       JOIN employees employee ON employee.id=COALESCE(fv.reassigned_technician_id,NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
       ${where} ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT telemarketer_user.id AS value, COALESCE(telemarketer_employee.name,telemarketer_user.name) AS label
       FROM field_visits fv
       JOIN hr_users telemarketer_user ON telemarketer_user.id=fv.booked_by_telemarketer_id
       LEFT JOIN employees telemarketer_employee ON telemarketer_employee.id=telemarketer_user.employee_id
       ${where} ORDER BY label`,
      params,
    ),
    pool.query(`SELECT DISTINCT fv.status AS value FROM field_visits fv ${where} ORDER BY value`, params),
  ]);
  return {
    supervisors: mapNamedOptions(supervisors.rows),
    technicians: mapNamedOptions(technicians.rows),
    telemarketers: mapNamedOptions(telemarketers.rows),
    visitStatuses: statuses.rows.flatMap(row => {
      const value = String(row.value ?? '') as VisitStatus;
      return value in VISIT_STATUS_LABELS ? [{ value, label: VISIT_STATUS_LABELS[value] }] : [];
    }),
  };
}
