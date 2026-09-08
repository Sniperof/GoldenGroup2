import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { ReportingError } from './reportingError.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';

interface QueryOptions {
  offset?: number;
  limit: number;
  includeTotalRows?: boolean;
}

export interface SalesFollowUpTaskRow {
  branchId: number;
  branchName: string;
  supervisorName: string | null;
  technicianName: string | null;
  customerName: string;
  governorateName: string;
  regionName: string;
  subareaName: string;
  neighborhoodName: string;
  taskType: string;
  taskResult: string | null;
  executedDate: string;
  resultNotes: string | null;
}

export interface SalesFollowUpFilterOptions {
  supervisors: Array<{ value: string; label: string }>;
  technicians: Array<{ value: string; label: string }>;
  taskTypes: Array<{ value: string; label: string }>;
  taskResults: Array<{ value: string; label: string }>;
}

/**
 * The recorded outcome of the task, in the project's own wording.
 *
 * The report spans device-demo and every service-classified task type, and each
 * carries its own decision vocabulary — so the map is held once here and used by
 * BOTH the visible column and the labels of its filter's option list. An outcome
 * nobody has translated yet falls through to its stored code rather than being
 * hidden: a row with no readable outcome is a translation gap to fix, not a row to
 * drop out of a report about executed work.
 */
const TASK_RESULT_LABEL_SQL = `CASE result.final_decision
          WHEN 'offer_presented' THEN 'تقديم عرض'
          WHEN 'device_sold' THEN 'تم البيع'
          WHEN 'rescheduled' THEN 'إعادة جدولة'
          WHEN 'cancelled' THEN 'إلغاء'
          WHEN 'delivered_successfully' THEN 'تم التسليم'
          WHEN 'delivered' THEN 'تم التسليم'
          WHEN 'refused_delivery' THEN 'رفض التسليم'
          WHEN 'installed_successfully' THEN 'تم التركيب'
          WHEN 'installation_incomplete' THEN 'التركيب غير مكتمل'
          WHEN 'refused_installation' THEN 'رفض التركيب'
          WHEN 'activated_successfully' THEN 'تم التشغيل'
          WHEN 'activated' THEN 'تم التشغيل'
          WHEN 'device_issue' THEN 'مشكلة في الجهاز'
          WHEN 'disconnected_successfully' THEN 'تم الفك'
          WHEN 'retrieved_successfully' THEN 'تم السحب'
          WHEN 'returned_successfully' THEN 'تم الإرجاع'
          WHEN 'transferred_successfully' THEN 'تم النقل'
          WHEN 'resolved' THEN 'تم الإصلاح'
          WHEN 'unresolved' THEN 'لم يُحَل بالكامل'
          WHEN 'needs_follow_up' THEN 'بحاجة متابعة'
          WHEN 'refused_gift' THEN 'رفض الهدية'
          WHEN 'customer_not_available' THEN 'الزبون غير متوفر'
          WHEN 'wrong_address' THEN 'عنوان خاطئ'
          WHEN 'paid_full' THEN 'تم التسديد بالكامل'
          WHEN 'paid_partial' THEN 'تم التسديد جزئيًا'
          WHEN 'refused_to_pay' THEN 'رفض الدفع'
          ELSE NULLIF(BTRIM(result.final_decision), '')
        END`;

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function requireSalesFollowUpDateRange(request: TabularReportRequestParams) {
  if (!validIsoDate(request.fromDate) || !validIsoDate(request.toDate)) {
    throw new ReportingError(400, 'يجب تحديد تاريخ بداية ونهاية صالحين للتقرير');
  }
  if (request.fromDate > request.toDate) {
    throw new ReportingError(400, 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية');
  }
  return { fromDate: request.fromDate, toDate: request.toDate };
}

function appendAccessFilters(access: TabularReportAccess, params: unknown[], filters: string[]) {
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
         AND scoped_user.employee_id IN (
           COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int),
           COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
         )
    )`);
  }
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(
    String(request.geoIds ?? request.geoUnitId ?? '')
      .split(',')
      .map(value => positiveInt(value))
      .filter((value): value is number => value != null),
  ));
}

export function buildSalesFollowUpTasksQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const range = requireSalesFollowUpDateRange(request);
  const params: unknown[] = [range.fromDate, range.toDate];
  const filters = [
    `(result.closed_at AT TIME ZONE 'Asia/Damascus')::date >= $1::date`,
    `(result.closed_at AT TIME ZONE 'Asia/Damascus')::date <= $2::date`,
    `vt.status = 'completed'`,
    `(vt.task_type = 'device_demo' OR config.contact_target_visit_type = 'service')`,
  ];
  appendAccessFilters(access, params, filters);

  const supervisorId = positiveInt(request.supervisorEmployeeId);
  if (supervisorId != null) {
    params.push(supervisorId);
    filters.push(`COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int) = $${params.length}`);
  }
  const technicianId = positiveInt(request.technicianEmployeeId);
  if (technicianId != null) {
    params.push(technicianId);
    filters.push(`COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int) = $${params.length}`);
  }
  if (typeof request.taskType === 'string' && request.taskType.trim() !== '') {
    params.push(request.taskType.trim());
    filters.push(`vt.task_type = $${params.length}`);
  }
  // The stable decision code, never its Arabic label: the label is display text that
  // can be reworded, while the code is what the row was closed with.
  if (typeof request.taskResult === 'string' && request.taskResult.trim() !== '') {
    params.push(request.taskResult.trim());
    filters.push(`result.final_decision = $${params.length}`);
  }
  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    filters.push(`effective_location.geo_unit_id = ANY($${params.length}::int[])`);
  }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  return {
    params,
    sql: `
      SELECT fv.branch_id AS "branchId",
             branch.name AS "branchName",
             COALESCE(supervisor.name, NULLIF(fv.team_snapshot->>'supervisorName','')) AS "supervisorName",
             COALESCE(technician.name, NULLIF(fv.team_snapshot->>'technicianName','')) AS "technicianName",
             COALESCE(NULLIF(fv.customer_snapshot->>'name',''), customer.name) AS "customerName",
             COALESCE(governorate.name, 'غير محدد') AS "governorateName",
             COALESCE(region.name, 'غير محدد') AS "regionName",
             COALESCE(subarea.name, 'غير محدد') AS "subareaName",
             COALESCE(neighborhood.name, 'غير محدد') AS "neighborhoodName",
             COALESCE(NULLIF(config.arabic_label,''), vt.task_type) AS "taskType",
             ${TASK_RESULT_LABEL_SQL} AS "taskResult",
             TO_CHAR(result.closed_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS "executedDate",
             NULLIF(BTRIM(result.closing_notes),'') AS "resultNotes"
             ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
        FROM visit_tasks vt
        JOIN field_visits fv ON fv.id = vt.field_visit_id
        JOIN visit_task_results result ON result.visit_task_id = vt.id
        JOIN clients customer ON customer.id = fv.client_id
        JOIN branches branch ON branch.id = fv.branch_id
        LEFT JOIN task_type_config config ON config.task_type = vt.task_type
        LEFT JOIN open_tasks source_task ON source_task.id = vt.source_open_task_id
        LEFT JOIN contracts contract ON contract.id = COALESCE(vt.contract_id, source_task.contract_id)
        LEFT JOIN installed_devices device ON device.id = COALESCE(source_task.device_id, contract.installed_device_id)
        LEFT JOIN employees supervisor
          ON supervisor.id = COALESCE(fv.reassigned_supervisor_id, NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
        LEFT JOIN employees technician
          ON technician.id = COALESCE(fv.reassigned_technician_id, NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN config.location_basis IN ('contract','device') THEN device.installation_geo_unit_id
            ELSE COALESCE(customer.neighborhood, customer.district, customer.governorate)
          END AS geo_unit_id
        ) effective_location ON TRUE
        LEFT JOIN geo_units location0 ON location0.id = effective_location.geo_unit_id
        LEFT JOIN geo_units location1 ON location1.id = location0.parent_id
        LEFT JOIN geo_units location2 ON location2.id = location1.parent_id
        LEFT JOIN geo_units location3 ON location3.id = location2.parent_id
        LEFT JOIN geo_units location4 ON location4.id = location3.parent_id
        LEFT JOIN geo_units governorate ON governorate.id = COALESCE(
          CASE WHEN location0.level=1 THEN location0.id END, CASE WHEN location1.level=1 THEN location1.id END,
          CASE WHEN location2.level=1 THEN location2.id END, CASE WHEN location3.level=1 THEN location3.id END,
          CASE WHEN location4.level=1 THEN location4.id END)
        LEFT JOIN geo_units region ON region.id = COALESCE(
          CASE WHEN location0.level=2 THEN location0.id END, CASE WHEN location1.level=2 THEN location1.id END,
          CASE WHEN location2.level=2 THEN location2.id END, CASE WHEN location3.level=2 THEN location3.id END,
          CASE WHEN location4.level=2 THEN location4.id END)
        LEFT JOIN geo_units subarea ON subarea.id = COALESCE(
          CASE WHEN location0.level=3 THEN location0.id END, CASE WHEN location1.level=3 THEN location1.id END,
          CASE WHEN location2.level=3 THEN location2.id END, CASE WHEN location3.level=3 THEN location3.id END,
          CASE WHEN location4.level=3 THEN location4.id END)
        LEFT JOIN geo_units neighborhood ON neighborhood.id = COALESCE(
          CASE WHEN location0.level=4 THEN location0.id END, CASE WHEN location1.level=4 THEN location1.id END,
          CASE WHEN location2.level=4 THEN location2.id END, CASE WHEN location3.level=4 THEN location3.id END,
          CASE WHEN location4.level=4 THEN location4.id END)
       WHERE ${filters.join('\n         AND ')}
       ORDER BY ${buildTabularReportOrderBy(
         'performance.sales_follow_up_tasks', access, request, 'result.closed_at DESC, vt.id DESC',
       )}
       LIMIT ${limitRef}${offsetSql}`,
  };
}

export async function getSalesFollowUpTasksReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): Promise<{ rows: SalesFollowUpTaskRow[]; total: number }> {
  const query = buildSalesFollowUpTasksQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  return {
    total: Number(rows[0]?.totalRows ?? 0),
    rows: rows.map(row => ({
      branchId: Number(row.branchId),
      branchName: String(row.branchName),
      supervisorName: row.supervisorName == null ? null : String(row.supervisorName),
      technicianName: row.technicianName == null ? null : String(row.technicianName),
      customerName: String(row.customerName),
      governorateName: String(row.governorateName),
      regionName: String(row.regionName),
      subareaName: String(row.subareaName),
      neighborhoodName: String(row.neighborhoodName),
      taskType: String(row.taskType),
      taskResult: row.taskResult == null ? null : String(row.taskResult),
      executedDate: String(row.executedDate),
      resultNotes: row.resultNotes == null ? null : String(row.resultNotes),
    })),
  };
}

export async function getSalesFollowUpFilterOptions(access: TabularReportAccess): Promise<SalesFollowUpFilterOptions> {
  const params: unknown[] = [];
  const filters = [`(vt.task_type = 'device_demo' OR config.contact_target_visit_type = 'service')`];
  appendAccessFilters(access, params, filters);
  const where = `WHERE ${filters.join(' AND ')}`;
  const base = `FROM visit_tasks vt JOIN field_visits fv ON fv.id=vt.field_visit_id LEFT JOIN task_type_config config ON config.task_type=vt.task_type`;
  const [supervisors, technicians, taskTypes, taskResults] = await Promise.all([
    pool.query(
      `SELECT DISTINCT employee.id AS value, employee.name AS label ${base}
       JOIN employees employee ON employee.id=COALESCE(fv.reassigned_supervisor_id,NULLIF(fv.team_snapshot->>'supervisorEmployeeId','')::int)
       ${where} ORDER BY label`, params,
    ),
    pool.query(
      `SELECT DISTINCT employee.id AS value, employee.name AS label ${base}
       JOIN employees employee ON employee.id=COALESCE(fv.reassigned_technician_id,NULLIF(fv.team_snapshot->>'technicianEmployeeId','')::int)
       ${where} ORDER BY label`, params,
    ),
    pool.query(
      `SELECT DISTINCT vt.task_type AS value, COALESCE(NULLIF(config.arabic_label,''),vt.task_type) AS label ${base}
       ${where} ORDER BY label`, params,
    ),
    // Labelled by the very expression the column shows, so the choice the user picks
    // reads exactly as the value they saw in the table.
    pool.query(
      `SELECT DISTINCT result.final_decision AS value, ${TASK_RESULT_LABEL_SQL} AS label ${base}
       JOIN visit_task_results result ON result.visit_task_id = vt.id
       ${where} AND vt.status = 'completed' AND result.final_decision IS NOT NULL
       ORDER BY label`, params,
    ),
  ]);
  const map = (rows: Array<{ value: unknown; label: unknown }>) => rows
    .filter(row => row.value != null && row.label != null)
    .map(row => ({ value: String(row.value), label: String(row.label) }));
  return {
    supervisors: map(supervisors.rows), technicians: map(technicians.rows),
    taskTypes: map(taskTypes.rows), taskResults: map(taskResults.rows),
  };
}
