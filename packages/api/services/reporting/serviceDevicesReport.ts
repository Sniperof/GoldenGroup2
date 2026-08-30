import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { ReportingError } from './reportingError.js';

interface QueryOptions {
  offset?: number;
  limit: number;
}

export interface ServiceDeviceReportRow {
  branchId: number;
  branchName: string;
  deviceId: number;
  customerName: string;
  customerRating: string;
  serialNumber: string | null;
  deviceModelName: string;
  operationalStatus: string;
  goldenWarrantyStatus: string;
  governorateName: string | null;
  regionName: string | null;
  subareaName: string | null;
  neighborhoodName: string | null;
  installationAddress: string | null;
  primaryContactNumber: string | null;
  installationDate: string | null;
  lastPeriodicMaintenanceDate: string | null;
  lastCompletedVisitDate: string | null;
  replacedPartsSummary: string | null;
  paidAmount: number;
  whatsappMessage: string | null;
  lastContactAt: string | null;
  contactEmployeeName: string | null;
  contactNotes: string | null;
  lastIncompleteVisitDate: string | null;
}

const DEVICE_STATUS_LABELS: Record<string, string> = {
  registered: 'مسجل',
  pending_delivery: 'بانتظار التسليم',
  delivery_suspended: 'معلّق',
  delivered: 'مُسلّم',
  installed: 'مركّب',
  active: 'فعّال',
  faulty: 'معطل',
  in_workshop: 'في الورشة',
  ready: 'جاهز',
  out_of_service: 'خارج الخدمة',
  retrieved: 'مُسترجع',
  contract_cancelled: 'ملغى بسبب إلغاء العقد',
};

const RATING_LABELS: Record<string, string> = {
  Committed: 'ملتزم',
  NotCommitted: 'غير ملتزم',
  Undefined: 'غير محدد',
};

const WARRANTY_LABELS: Record<string, string> = {
  active: 'سارية',
  expired: 'منتهية',
  cancelled: 'ملغاة',
  pending: 'بانتظار التفعيل',
  none: 'غير مشمول',
};

const WARRANTY_STATUS_SQL = `CASE
  WHEN golden_warranty.status = 'cancelled' THEN 'cancelled'
  WHEN golden_warranty.status = 'pending' THEN 'pending'
  WHEN golden_warranty.id IS NOT NULL
    AND golden_warranty.status = 'active'
    AND (golden_warranty.end_date IS NULL OR golden_warranty.end_date >= CURRENT_DATE) THEN 'active'
  WHEN golden_warranty.id IS NOT NULL OR device.is_golden_warranty IS TRUE THEN 'expired'
  ELSE 'none'
END`;

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function addDateRange(
  filters: string[],
  params: unknown[],
  expression: string,
  fromValue: unknown,
  toValue: unknown,
) {
  const from = parseDate(fromValue);
  const to = parseDate(toValue);
  if (from) {
    params.push(from);
    filters.push(`${expression} >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    filters.push(`${expression} <= $${params.length}::date`);
  }
}

export function buildServiceDevicesQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = ['client.deleted_at IS NULL'];

  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'هذا التقرير متاح على مستوى كل الفروع أو الفرع فقط');
  }
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`device.branch_id = ANY($${params.length}::int[])`);
  }

  const geoIds = String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value)).filter((value): value is number => value != null);
  if (geoIds.length > 0) {
    params.push([...new Set(geoIds)]);
    filters.push(`device.installation_geo_unit_id = ANY($${params.length}::int[])`);
  }

  const search = typeof request.search === 'string' ? request.search.trim() : '';
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(
      client.name ILIKE $${params.length}
      OR client.mobile ILIKE $${params.length}
      OR device.serial_number ILIKE $${params.length}
      OR device.external_device_serial ILIKE $${params.length}
      OR COALESCE(device_model.name_ar, device_model.name_en, device_model.name,
                  device.device_model_name, device.external_device_name, '') ILIKE $${params.length}
    )`);
  }

  const deviceModelKey = typeof request.deviceModel === 'string' ? request.deviceModel : '';
  const deviceModelId = positiveInt(request.deviceModelId ?? (deviceModelKey.startsWith('catalog:') ? deviceModelKey.slice(8) : null));
  if (deviceModelId != null) {
    params.push(deviceModelId);
    filters.push(`device.device_model_id = $${params.length}`);
  } else if (deviceModelKey.startsWith('external:')) {
    params.push(deviceModelKey.slice(9));
    filters.push(`device.device_model_id IS NULL AND COALESCE(device.external_device_name, device.device_model_name, '') = $${params.length}`);
  }
  if (typeof request.deviceStatus === 'string' && request.deviceStatus.trim()) {
    params.push(request.deviceStatus.trim());
    filters.push(`device.status = $${params.length}`);
  }
  if (typeof request.warrantyStatus === 'string' && request.warrantyStatus.trim()) {
    params.push(request.warrantyStatus.trim());
    filters.push(`(${WARRANTY_STATUS_SQL}) = $${params.length}`);
  }
  if (typeof request.customerRating === 'string' && request.customerRating.trim()) {
    params.push(request.customerRating.trim());
    filters.push(`COALESCE(client.rating, 'Undefined') = $${params.length}`);
  }
  const contactEmployeeId = positiveInt(request.contactEmployeeId);
  if (contactEmployeeId != null) {
    params.push(contactEmployeeId);
    filters.push(`last_contact.employee_id = $${params.length}`);
  }
  if (request.lastContactChannel === 'whatsapp') {
    filters.push(`last_contact.communication_channel = 'whatsapp_text'`);
  } else if (request.lastContactChannel === 'other') {
    filters.push(`last_contact.id IS NOT NULL AND last_contact.communication_channel IS DISTINCT FROM 'whatsapp_text'`);
  }
  if (request.replacedParts === 'yes') filters.push(`last_parts.summary IS NOT NULL`);
  if (request.replacedParts === 'no') filters.push(`last_parts.summary IS NULL`);

  const minPaid = parseNonNegativeNumber(request.minPaidAmount);
  if (minPaid != null) {
    params.push(minPaid);
    filters.push(`COALESCE(last_visit_payment.paid_amount, 0) >= $${params.length}::numeric`);
  }
  const maxPaid = parseNonNegativeNumber(request.maxPaidAmount);
  if (maxPaid != null) {
    params.push(maxPaid);
    filters.push(`COALESCE(last_visit_payment.paid_amount, 0) <= $${params.length}::numeric`);
  }

  addDateRange(filters, params, 'device.installation_date', request.installationFrom, request.installationTo);
  addDateRange(filters, params, 'last_periodic.executed_at::date', request.periodicMaintenanceFrom, request.periodicMaintenanceTo);
  addDateRange(filters, params, 'last_completed_visit.executed_at::date', request.completedVisitFrom, request.completedVisitTo);
  addDateRange(filters, params, 'last_contact.call_date::date', request.lastContactFrom, request.lastContactTo);
  addDateRange(filters, params, 'last_incomplete_visit.visit_date', request.incompleteVisitFrom, request.incompleteVisitTo);

  params.push(options.limit);
  const limitPlaceholder = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT
      device.id AS "deviceId",
      device.branch_id AS "branchId",
      branch.name AS "branchName",
      client.name AS "customerName",
      COALESCE(client.rating, 'Undefined') AS "customerRating",
      COALESCE(NULLIF(device.serial_number, ''), NULLIF(device.external_device_serial, '')) AS "serialNumber",
      COALESCE(device_model.name_ar, device_model.name_en, device_model.name,
               device.device_model_name, device.external_device_name, 'جهاز غير محدد') AS "deviceModelName",
      device.status AS "operationalStatus",
      (${WARRANTY_STATUS_SQL}) AS "goldenWarrantyStatus",
      geo.governorate_name AS "governorateName",
      geo.region_name AS "regionName",
      geo.subarea_name AS "subareaName",
      geo.neighborhood_name AS "neighborhoodName",
      device.installation_address_text AS "installationAddress",
      NULLIF(client.mobile, '') AS "primaryContactNumber",
      TO_CHAR(device.installation_date, 'YYYY-MM-DD') AS "installationDate",
      TO_CHAR(last_periodic.executed_at::date, 'YYYY-MM-DD') AS "lastPeriodicMaintenanceDate",
      TO_CHAR(last_completed_visit.executed_at::date, 'YYYY-MM-DD') AS "lastCompletedVisitDate",
      last_parts.summary AS "replacedPartsSummary",
      COALESCE(last_visit_payment.paid_amount, 0)::numeric AS "paidAmount",
      CASE WHEN last_contact.communication_channel = 'whatsapp_text' THEN NULLIF(last_contact.notes, '') END AS "whatsappMessage",
      last_contact.call_date AS "lastContactAt",
      last_contact.employee_name AS "contactEmployeeName",
      NULLIF(last_contact.notes, '') AS "contactNotes",
      TO_CHAR(last_incomplete_visit.visit_date, 'YYYY-MM-DD') AS "lastIncompleteVisitDate",
      COUNT(*) OVER()::int AS "totalRows"
    FROM installed_devices device
    JOIN clients client ON client.id = device.customer_id
    JOIN branches branch ON branch.id = device.branch_id
    LEFT JOIN device_models device_model ON device_model.id = device.device_model_id
    LEFT JOIN LATERAL (
      WITH RECURSIVE ancestors AS (
        SELECT unit.id, unit.name, unit.level, unit.parent_id
        FROM geo_units unit WHERE unit.id = device.installation_geo_unit_id
        UNION ALL
        SELECT parent.id, parent.name, parent.level, parent.parent_id
        FROM geo_units parent JOIN ancestors child ON child.parent_id = parent.id
      )
      SELECT
        MAX(name) FILTER (WHERE level = 1) AS governorate_name,
        MAX(name) FILTER (WHERE level = 2) AS region_name,
        MAX(name) FILTER (WHERE level = 3) AS subarea_name,
        MAX(name) FILTER (WHERE level = 4) AS neighborhood_name
      FROM ancestors
    ) geo ON TRUE
    LEFT JOIN LATERAL (
      SELECT warranty.id, warranty.status, warranty.end_date
      FROM device_warranties warranty
      WHERE warranty.device_id = device.id AND warranty.warranty_type = 'golden'
      ORDER BY warranty.created_at DESC, warranty.id DESC LIMIT 1
    ) golden_warranty ON TRUE
    LEFT JOIN LATERAL (
      SELECT visit.id,
             MAX(COALESCE(result.closed_at, visit_geo.actual_end_time, visit.closed_at, task.updated_at)) AS executed_at
      FROM field_visits visit
      JOIN visit_tasks task ON task.field_visit_id = visit.id
      LEFT JOIN visit_task_results result ON result.visit_task_id = task.id
      LEFT JOIN LATERAL (
        SELECT MAX(log.actual_end_time) AS actual_end_time FROM visit_geo_logs log WHERE log.visit_id = visit.id
      ) visit_geo ON TRUE
      WHERE task.device_id = device.id AND task.status IN ('completed', 'closed')
      GROUP BY visit.id
      ORDER BY executed_at DESC NULLS LAST, visit.id DESC LIMIT 1
    ) last_completed_visit ON TRUE
    LEFT JOIN LATERAL (
      SELECT MAX(COALESCE(result.closed_at, visit_geo.actual_end_time, visit.closed_at, task.updated_at)) AS executed_at
      FROM field_visits visit
      JOIN visit_tasks task ON task.field_visit_id = visit.id
      LEFT JOIN visit_task_results result ON result.visit_task_id = task.id
      LEFT JOIN LATERAL (
        SELECT MAX(log.actual_end_time) AS actual_end_time FROM visit_geo_logs log WHERE log.visit_id = visit.id
      ) visit_geo ON TRUE
      WHERE task.device_id = device.id
        AND task.task_type = 'periodic_maintenance'
        AND task.status IN ('completed', 'closed')
      GROUP BY visit.id
      ORDER BY executed_at DESC NULLS LAST, visit.id DESC LIMIT 1
    ) last_periodic ON TRUE
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(part.part_name_snapshot || ' × ' || part.quantity::text, E'\n' ORDER BY part.part_name_snapshot) AS summary
      FROM (
        SELECT used.part_name_snapshot, SUM(used.quantity)::int AS quantity
        FROM visit_tasks task
        JOIN visit_task_results result ON result.visit_task_id = task.id
        JOIN visit_task_emergency_parts_used used ON used.visit_task_result_id = result.id
        WHERE task.field_visit_id = last_completed_visit.id AND task.device_id = device.id
        GROUP BY used.part_name_snapshot
      ) part
    ) last_parts ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(movement.amount_syp)::numeric AS paid_amount
      FROM (
        SELECT DISTINCT task.source_open_task_id
        FROM visit_tasks task
        WHERE task.field_visit_id = last_completed_visit.id
          AND task.device_id = device.id
          AND task.source_open_task_id IS NOT NULL
      ) task_source
      JOIN financial_movements movement ON movement.source_id = task_source.source_open_task_id
        AND movement.kind = 'payment'
        AND movement.source_type IN ('emergency_maintenance', 'periodic_maintenance', 'installation', 'golden_warranty')
    ) last_visit_payment ON TRUE
    LEFT JOIN LATERAL (
      SELECT call.id, call.call_date, call.communication_channel, call.notes,
             user_account.employee_id,
             COALESCE(employee.name, user_account.name) AS employee_name
      FROM customer_call_logs call
      LEFT JOIN hr_users user_account ON user_account.id = call.caller_id
      LEFT JOIN employees employee ON employee.id = user_account.employee_id
      WHERE call.customer_id = client.id
      ORDER BY call.call_date DESC, call.created_at DESC, call.id DESC LIMIT 1
    ) last_contact ON TRUE
    LEFT JOIN LATERAL (
      SELECT visit.scheduled_date AS visit_date
      FROM field_visits visit
      WHERE visit.status = 'not_completed'
        AND EXISTS (
          SELECT 1 FROM visit_tasks task
          WHERE task.field_visit_id = visit.id AND task.device_id = device.id
        )
      ORDER BY visit.scheduled_date DESC NULLS LAST, visit.updated_at DESC, visit.id DESC LIMIT 1
    ) last_incomplete_visit ON TRUE
    WHERE ${filters.join('\n      AND ')}
    ORDER BY client.name, device.id
    LIMIT ${limitPlaceholder}${offsetSql}`;

  return { sql, params };
}

export async function getServiceDevicesReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildServiceDevicesQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  return {
    total: Number(rows[0]?.totalRows ?? 0),
    rows: rows.map(row => ({
      branchId: Number(row.branchId),
      branchName: String(row.branchName),
      deviceId: Number(row.deviceId),
      customerName: String(row.customerName),
      customerRating: RATING_LABELS[String(row.customerRating)] ?? String(row.customerRating),
      serialNumber: row.serialNumber == null ? null : String(row.serialNumber),
      deviceModelName: String(row.deviceModelName),
      operationalStatus: DEVICE_STATUS_LABELS[String(row.operationalStatus)] ?? String(row.operationalStatus),
      goldenWarrantyStatus: WARRANTY_LABELS[String(row.goldenWarrantyStatus)] ?? String(row.goldenWarrantyStatus),
      governorateName: row.governorateName == null ? null : String(row.governorateName),
      regionName: row.regionName == null ? null : String(row.regionName),
      subareaName: row.subareaName == null ? null : String(row.subareaName),
      neighborhoodName: row.neighborhoodName == null ? null : String(row.neighborhoodName),
      installationAddress: row.installationAddress == null ? null : String(row.installationAddress),
      primaryContactNumber: row.primaryContactNumber == null ? null : String(row.primaryContactNumber),
      installationDate: row.installationDate == null ? null : String(row.installationDate),
      lastPeriodicMaintenanceDate: row.lastPeriodicMaintenanceDate == null ? null : String(row.lastPeriodicMaintenanceDate),
      lastCompletedVisitDate: row.lastCompletedVisitDate == null ? null : String(row.lastCompletedVisitDate),
      replacedPartsSummary: row.replacedPartsSummary == null ? null : String(row.replacedPartsSummary),
      paidAmount: Number(row.paidAmount ?? 0),
      whatsappMessage: row.whatsappMessage == null ? null : String(row.whatsappMessage),
      lastContactAt: row.lastContactAt == null ? null : new Date(row.lastContactAt).toISOString(),
      contactEmployeeName: row.contactEmployeeName == null ? null : String(row.contactEmployeeName),
      contactNotes: row.contactNotes == null ? null : String(row.contactNotes),
      lastIncompleteVisitDate: row.lastIncompleteVisitDate == null ? null : String(row.lastIncompleteVisitDate),
    } satisfies ServiceDeviceReportRow)),
  };
}

export async function getServiceDevicesFilterOptions(access: TabularReportAccess) {
  if (access.scope === 'ASSIGNED') throw new ReportingError(403, 'هذا التقرير متاح على مستوى كل الفروع أو الفرع فقط');
  const params: unknown[] = [];
  const scopeCondition = access.branchIds.length > 0
    ? (params.push(access.branchIds), `AND device.branch_id = ANY($1::int[])`)
    : '';
  const [models, statuses, contactEmployees] = await Promise.all([
    pool.query(
      `SELECT DISTINCT
              CASE WHEN device.device_model_id IS NOT NULL THEN 'catalog:' || device.device_model_id::text
                   ELSE 'external:' || COALESCE(device.external_device_name, device.device_model_name, '') END AS value,
              COALESCE(model.name_ar, model.name_en, model.name, device.external_device_name, device.device_model_name) AS label
       FROM installed_devices device
       LEFT JOIN device_models model ON model.id = device.device_model_id
       WHERE 1=1 ${scopeCondition}
       AND COALESCE(model.name_ar, model.name_en, model.name, device.external_device_name, device.device_model_name) IS NOT NULL
       ORDER BY label`,
      params,
    ),
    pool.query(`SELECT DISTINCT device.status AS value FROM installed_devices device WHERE 1=1 ${scopeCondition} ORDER BY value`, params),
    pool.query(
      `SELECT DISTINCT employee.id AS value, employee.name AS label
       FROM installed_devices device
       JOIN customer_call_logs call ON call.customer_id = device.customer_id
       JOIN hr_users account ON account.id = call.caller_id
       JOIN employees employee ON employee.id = account.employee_id
       WHERE 1=1 ${scopeCondition}
       ORDER BY label`,
      params,
    ),
  ]);
  return {
    supervisors: [], technicians: [], telemarketers: [], visitStatuses: [],
    deviceModels: models.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    deviceStatuses: statuses.rows.map(row => ({ value: String(row.value), label: DEVICE_STATUS_LABELS[String(row.value)] ?? String(row.value) })),
    warrantyStatuses: Object.entries(WARRANTY_LABELS).map(([value, label]) => ({ value, label })),
    customerRatings: Object.entries(RATING_LABELS).map(([value, label]) => ({ value, label })),
    contactEmployees: contactEmployees.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
