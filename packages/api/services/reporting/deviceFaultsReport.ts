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

const FAULT_STATUSES = new Set([
  'reported', 'confirmed', 'resolved_at_intake', 'resolved',
  'deferred', 'unresolvable_field', 'cancelled',
]);
const DISCOVERY_PHASES = new Set(['intake', 'in_review', 'technical_consultation', 'field_discovery']);
const DURATION_BUCKETS = new Set(['same_day', 'one_to_three', 'four_to_seven', 'over_seven']);
const PARTS_USAGE = new Set(['yes', 'no']);

function dateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function requiredPeriod(request: TabularReportRequestParams) {
  const fromDate = dateOnly(request.fromDate);
  const toDate = dateOnly(request.toDate);
  if (!fromDate || !toDate) throw new ReportingError(400, 'تاريخ بداية ونهاية تسجيل الأعطال مطلوبان');
  if (fromDate > toDate) throw new ReportingError(400, 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية');
  return { fromDate, toDate };
}

function optionalAllowListed(value: unknown, allowed: Set<string>, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!allowed.has(normalized)) throw new ReportingError(400, `${label} غير صالح`);
  return normalized;
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value))
    .filter((value): value is number => value != null)));
}

/**
 * The fault belongs to a device, and the device's location is its installation site —
 * not the customer's current address and not the branch's. The chain is resolved
 * upward so every level can be named and so a geography selection at any level
 * matches: the row carries every ancestor id, the request carries the chosen
 * node's subtree (§9.7.2).
 */
const GEO_LATERAL_SQL = `
        WITH RECURSIVE ancestors AS (
          SELECT unit.id, unit.name, unit.level, unit.parent_id
            FROM geo_units unit
           WHERE unit.id = device.installation_geo_unit_id
          UNION ALL
          SELECT parent.id, parent.name, parent.level, parent.parent_id
            FROM geo_units parent
            JOIN ancestors child ON child.parent_id = parent.id
        )
        SELECT MAX(name) FILTER (WHERE level = 1) AS governorate_name,
               MAX(name) FILTER (WHERE level = 2) AS region_name,
               MAX(name) FILTER (WHERE level = 3) AS subarea_name,
               MAX(name) FILTER (WHERE level = 4) AS neighborhood_name,
               COALESCE(ARRAY_AGG(id), ARRAY[]::int[]) AS unit_ids
          FROM ancestors`;

/** The technician who actually attended the treatment visit, after any reassignment. */
const VISIT_TECHNICIAN_ID_SQL = `COALESCE(
        resolution_visit.reassigned_technician_id,
        NULLIF(resolution_visit.team_snapshot->>'technicianEmployeeId', '')::int
      )`;

export function buildDeviceFaultsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'تقرير الأعطال متاح على مستوى كل الفروع أو الفرع فقط');
  }

  const { fromDate, toDate } = requiredPeriod(request);
  const params: unknown[] = [];
  const filters = [
    'problem.deleted_at IS NULL',
    `problem.created_at >= ($${params.push(fromDate)}::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`,
    `problem.created_at < (($${params.push(toDate)}::text::date + 1)::text || ' 00:00')::timestamp AT TIME ZONE 'Asia/Damascus'`,
  ];
  const branchExpression = 'COALESCE(service_request.branch_id, device.branch_id)';
  if (access.branchIds.length > 0) {
    filters.push(`${branchExpression} = ANY($${params.push(access.branchIds)}::int[])`);
  }

  const faultTypeId = positiveInt(request.faultTypeId);
  if (faultTypeId != null) filters.push(`problem.problem_type_id = $${params.push(faultTypeId)}`);

  const faultStatus = optionalAllowListed(request.faultStatus, FAULT_STATUSES, 'حالة العطل');
  if (faultStatus) filters.push(`problem.status = $${params.push(faultStatus)}`);

  const discoveryPhase = optionalAllowListed(request.faultDiscoveryPhase, DISCOVERY_PHASES, 'مرحلة اكتشاف العطل');
  if (discoveryPhase) filters.push(`problem.added_during_phase = $${params.push(discoveryPhase)}`);

  const repairTechnicianId = positiveInt(request.repairTechnicianEmployeeId);
  if (repairTechnicianId != null) {
    filters.push(`problem.repaired_by_employee_id = $${params.push(repairTechnicianId)}`);
  }

  // Distinct from the repair technician: whoever attended the treatment visit is not
  // always the one credited with the repair, and the report shows both columns.
  const visitTechnicianId = positiveInt(request.visitTechnicianEmployeeId);
  if (visitTechnicianId != null) {
    filters.push(`${VISIT_TECHNICIAN_ID_SQL} = $${params.push(visitTechnicianId)}`);
  }

  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    filters.push(`geo.unit_ids && $${params.push(geoIds)}::int[]`);
  }

  const search = typeof request.search === 'string' ? request.search.trim() : '';
  if (search) {
    const searchRef = `$${params.push(`%${search}%`)}`;
    filters.push(`(
      client.name ILIKE ${searchRef}
      OR client.mobile ILIKE ${searchRef}
      OR service_request.public_ref_number ILIKE ${searchRef}
      OR device.serial_number ILIKE ${searchRef}
      OR device.external_device_serial ILIKE ${searchRef}
    )`);
  }

  const deviceModelKey = typeof request.deviceModel === 'string' ? request.deviceModel : '';
  const deviceModelId = positiveInt(
    request.deviceModelId ?? (deviceModelKey.startsWith('catalog:') ? deviceModelKey.slice(8) : null),
  );
  if (deviceModelId != null) {
    filters.push(`device.device_model_id = $${params.push(deviceModelId)}`);
  } else if (deviceModelKey.startsWith('external:')) {
    filters.push(
      `device.device_model_id IS NULL AND COALESCE(device.external_device_name, device.device_model_name, '') = $${params.push(deviceModelKey.slice(9))}`,
    );
  }

  const resolvedFrom = dateOnly(request.faultResolvedFrom);
  const resolvedTo = dateOnly(request.faultResolvedTo);
  if (resolvedFrom) filters.push(`problem.resolved_at >= $${params.push(resolvedFrom)}::date`);
  if (resolvedTo) filters.push(`problem.resolved_at < $${params.push(resolvedTo)}::date + INTERVAL '1 day'`);
  if (resolvedFrom && resolvedTo && resolvedFrom > resolvedTo) {
    throw new ReportingError(400, 'بداية فترة الإصلاح يجب ألا تكون بعد نهايتها');
  }

  const durationBucket = optionalAllowListed(request.faultDurationBucket, DURATION_BUCKETS, 'مدة المعالجة');
  const durationExpression = '(COALESCE(problem.resolved_at, CURRENT_TIMESTAMP)::date - problem.created_at::date)';
  if (durationBucket === 'same_day') filters.push(`${durationExpression} <= 0`);
  if (durationBucket === 'one_to_three') filters.push(`${durationExpression} BETWEEN 1 AND 3`);
  if (durationBucket === 'four_to_seven') filters.push(`${durationExpression} BETWEEN 4 AND 7`);
  if (durationBucket === 'over_seven') filters.push(`${durationExpression} > 7`);

  const partsUsage = optionalAllowListed(request.faultPartsUsage, PARTS_USAGE, 'فلتر القطع المستخدمة');
  if (partsUsage === 'yes') filters.push('linked_parts.summary IS NOT NULL');
  if (partsUsage === 'no') filters.push('linked_parts.summary IS NULL');

  const limitRef = `$${params.push(options.limit)}`;
  const offsetSql = options.offset == null ? '' : ` OFFSET $${params.push(options.offset)}`;

  return {
    params,
    sql: `
      SELECT
        problem.id AS "faultId",
        ${branchExpression} AS "branchId",
        branch.name AS "branchName",
        service_request.public_ref_number AS "serviceRequestRef",
        TO_CHAR(problem.created_at::date, 'YYYY-MM-DD') AS "reportedDate",
        client.name AS "customerName",
        NULLIF(client.mobile, '') AS "primaryContactNumber",
        geo.governorate_name AS "governorateName",
        geo.region_name AS "regionName",
        geo.subarea_name AS "subareaName",
        geo.neighborhood_name AS "neighborhoodName",
        COALESCE(device_model.name_ar, device_model.name_en, device_model.name,
                 device.device_model_name, device.external_device_name, 'جهاز غير محدد') AS "deviceModelName",
        COALESCE(NULLIF(device.serial_number, ''), NULLIF(device.external_device_serial, '')) AS "serialNumber",
        fault_type.value AS "faultType",
        NULLIF(BTRIM(problem.details), '') AS "faultDetails",
        CASE problem.added_during_phase
          WHEN 'intake' THEN 'الاستقبال'
          WHEN 'in_review' THEN 'المراجعة'
          WHEN 'technical_consultation' THEN 'الاستشارة الفنية'
          WHEN 'field_discovery' THEN 'اكتشاف ميداني'
          ELSE problem.added_during_phase
        END AS "discoveryPhase",
        CASE problem.status
          WHEN 'reported' THEN 'مُبلّغ'
          WHEN 'confirmed' THEN 'مؤكد'
          WHEN 'resolved_at_intake' THEN 'محلول عند الاستلام'
          WHEN 'resolved' THEN 'محلول'
          WHEN 'deferred' THEN 'مؤجل'
          WHEN 'unresolvable_field' THEN 'متعذر الحل ميدانيًا'
          WHEN 'cancelled' THEN 'ملغى'
          ELSE problem.status
        END AS "faultStatus",
        NULLIF(BTRIM(problem.no_resolve_reason), '') AS "unresolvedReason",
        TO_CHAR(COALESCE(resolution_result.closed_at, resolution_visit.closed_at,
                         resolution_visit.scheduled_date::timestamp)::date, 'YYYY-MM-DD') AS "treatmentVisitDate",
        NULLIF(BTRIM(visit_technician.name), '') AS "visitTechnicianName",
        TO_CHAR(problem.resolved_at::date, 'YYYY-MM-DD') AS "resolvedDate",
        NULLIF(BTRIM(repair_technician.name), '') AS "repairTechnicianName",
        NULLIF(BTRIM(problem.resolution_notes), '') AS "resolutionNotes",
        linked_parts.summary AS "partsUsedSummary",
        GREATEST(0, ${durationExpression})::int AS "resolutionDurationDays",
        problem.updated_at AS "lastUpdatedAt"
        ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM service_request_problems problem
      JOIN service_requests service_request ON service_request.id = problem.service_request_id
      JOIN installed_devices device ON device.id = problem.installed_device_id
      JOIN clients client ON client.id = COALESCE(service_request.beneficiary_client_id, device.customer_id)
      JOIN branches branch ON branch.id = ${branchExpression}
      LEFT JOIN device_models device_model ON device_model.id = device.device_model_id
      LEFT JOIN system_lists fault_type ON fault_type.id = problem.problem_type_id
        AND fault_type.category = 'diagnosis_problem_types'
      LEFT JOIN employees repair_technician ON repair_technician.id = problem.repaired_by_employee_id
      LEFT JOIN visit_tasks resolution_task ON resolution_task.id = problem.resolution_visit_task_id
      LEFT JOIN field_visits resolution_visit ON resolution_visit.id = resolution_task.field_visit_id
      LEFT JOIN visit_task_results resolution_result ON resolution_result.visit_task_id = resolution_task.id
      LEFT JOIN employees visit_technician ON visit_technician.id = ${VISIT_TECHNICIAN_ID_SQL}
      LEFT JOIN LATERAL (${GEO_LATERAL_SQL}
      ) geo ON TRUE
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(part.part_name_snapshot || ' × ' || part.quantity::text,
                          E'\n' ORDER BY part.part_name_snapshot, part.id) AS summary
        FROM visit_task_emergency_parts_used part
        WHERE part.linked_problem_id = problem.id
      ) linked_parts ON TRUE
      WHERE ${filters.join('\n        AND ')}
      ORDER BY ${buildTabularReportOrderBy(
        'service.device_faults', access, request, 'problem.created_at DESC, problem.id DESC',
      )}
      LIMIT ${limitRef}${offsetSql}`,
  };
}

export async function getDeviceFaultsFilterOptions(access: TabularReportAccess) {
  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'تقرير الأعطال متاح على مستوى كل الفروع أو الفرع فقط');
  }
  const params: unknown[] = [];
  const branchCondition = access.branchIds.length === 0
    ? ''
    : `AND COALESCE(service_request.branch_id, device.branch_id) = ANY($${params.push(access.branchIds)}::int[])`;
  const baseFrom = `
    FROM service_request_problems problem
    JOIN service_requests service_request ON service_request.id = problem.service_request_id
    JOIN installed_devices device ON device.id = problem.installed_device_id`;
  const baseWhere = `WHERE problem.deleted_at IS NULL ${branchCondition}`;

  const [faultTypes, deviceModels, repairTechnicians, visitTechnicians] = await Promise.all([
    pool.query(
      `SELECT DISTINCT fault_type.id::text AS value, fault_type.value AS label
       ${baseFrom}
       JOIN system_lists fault_type ON fault_type.id = problem.problem_type_id
        AND fault_type.category = 'diagnosis_problem_types'
       ${baseWhere}
       ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT
          CASE WHEN device.device_model_id IS NOT NULL THEN 'catalog:' || device.device_model_id::text
               ELSE 'external:' || COALESCE(device.external_device_name, device.device_model_name, '') END AS value,
          COALESCE(model.name_ar, model.name_en, model.name,
                   device.external_device_name, device.device_model_name) AS label
       ${baseFrom}
       LEFT JOIN device_models model ON model.id = device.device_model_id
       ${baseWhere}
       AND COALESCE(model.name_ar, model.name_en, model.name,
                    device.external_device_name, device.device_model_name) IS NOT NULL
       ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT employee.id::text AS value, employee.name AS label
       ${baseFrom}
       JOIN employees employee ON employee.id = problem.repaired_by_employee_id
       ${baseWhere}
       ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT employee.id::text AS value, employee.name AS label
       ${baseFrom}
       JOIN visit_tasks resolution_task ON resolution_task.id = problem.resolution_visit_task_id
       JOIN field_visits resolution_visit ON resolution_visit.id = resolution_task.field_visit_id
       JOIN employees employee ON employee.id = ${VISIT_TECHNICIAN_ID_SQL}
       ${baseWhere}
       ORDER BY label`,
      params,
    ),
  ]);

  return {
    faultTypes: faultTypes.rows,
    deviceModels: deviceModels.rows,
    repairTechnicians: repairTechnicians.rows,
    technicians: visitTechnicians.rows,
  };
}
