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

const RETRIEVAL_PURPOSES = new Set(['maintenance', 'replacement']);
const DEVICE_STATUSES = new Set([
  'registered', 'pending_delivery', 'delivery_suspended', 'delivered', 'installed',
  'active', 'faulty', 'in_workshop', 'ready', 'out_of_service', 'retrieved',
  'contract_cancelled',
]);

function dateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function requiredPeriod(request: TabularReportRequestParams) {
  const fromDate = dateOnly(request.fromDate);
  const toDate = dateOnly(request.toDate);
  if (!fromDate || !toDate) throw new ReportingError(400, 'تاريخ بداية ونهاية السحب مطلوبان');
  if (fromDate > toDate) throw new ReportingError(400, 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية');
  return { fromDate, toDate };
}

function allowListed(value: unknown, values: Set<string>, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!values.has(normalized)) throw new ReportingError(400, `${label} غير صالح`);
  return normalized;
}

const TECHNICIAN_ID_SQL = `COALESCE(
  visit.reassigned_technician_id,
  NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int
)`;

export function buildRetrievedDevicesQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'تقرير الأجهزة المسحوبة متاح على مستوى كل الفروع أو الفرع فقط');
  }

  const { fromDate, toDate } = requiredPeriod(request);
  const params: unknown[] = [];
  const filters = [
    `retrieval.final_decision = 'retrieved_successfully'`,
    `result.closed_at >= $${params.push(fromDate)}::date`,
    `result.closed_at < $${params.push(toDate)}::date + INTERVAL '1 day'`,
  ];
  if (access.branchIds.length > 0) {
    filters.push(`retrieval.service_branch_id = ANY($${params.push(access.branchIds)}::int[])`);
  }

  const purpose = allowListed(request.retrievalPurpose, RETRIEVAL_PURPOSES, 'غرض السحب');
  if (purpose) filters.push(`retrieval.retrieval_purpose = $${params.push(purpose)}`);

  const status = allowListed(request.retrievedDeviceStatus, DEVICE_STATUSES, 'حالة الجهاز الحالية');
  if (status) filters.push(`device.status = $${params.push(status)}`);

  const technicianId = positiveInt(request.retrievalTechnicianEmployeeId);
  if (technicianId != null) filters.push(`${TECHNICIAN_ID_SQL} = $${params.push(technicianId)}`);

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

  const limitRef = `$${params.push(options.limit)}`;
  const offsetSql = options.offset == null ? '' : ` OFFSET $${params.push(options.offset)}`;

  return {
    params,
    sql: `
      SELECT
        retrieval.id AS "retrievalId",
        retrieval.service_branch_id AS "branchId",
        service_branch.name AS "branchName",
        TO_CHAR(result.closed_at::date, 'YYYY-MM-DD') AS "retrievalDate",
        client.name AS "customerName",
        NULLIF(client.mobile, '') AS "primaryContactNumber",
        COALESCE(device_model.name_ar, device_model.name_en, device_model.name,
                 device.device_model_name, device.external_device_name, 'جهاز غير محدد') AS "deviceModelName",
        COALESCE(NULLIF(device.serial_number, ''), NULLIF(device.external_device_serial, '')) AS "serialNumber",
        CASE retrieval.retrieval_purpose
          WHEN 'maintenance' THEN 'صيانة وإرجاع'
          WHEN 'replacement' THEN 'استبدال الجهاز'
          ELSE retrieval.retrieval_purpose
        END AS "retrievalPurpose",
        origin_branch.name AS "originBranchName",
        NULLIF(BTRIM(open_task.pre_retrieval_address_text), '') AS "customerAddress",
        geo.subarea_name AS "subareaName",
        geo.neighborhood_name AS "neighborhoodName",
        NULLIF(BTRIM(technician.name), '') AS "retrievalTechnicianName",
        CASE WHEN open_task.creation_reason = 'emergency_direct_workshop_retrieval'
          THEN 'سحب مباشر بعد صيانة طارئة'
          ELSE 'مهمة سحب جهاز'
        END AS "retrievalSource",
        CASE device.status
          WHEN 'registered' THEN 'مسجل'
          WHEN 'pending_delivery' THEN 'بانتظار التسليم'
          WHEN 'delivery_suspended' THEN 'معلق التسليم'
          WHEN 'in_workshop' THEN 'في الورشة'
          WHEN 'ready' THEN 'جاهز'
          WHEN 'retrieved' THEN 'مُسترجع'
          WHEN 'delivered' THEN 'مُسلّم'
          WHEN 'installed' THEN 'مركّب'
          WHEN 'active' THEN 'فعّال'
          WHEN 'faulty' THEN 'معطل'
          WHEN 'out_of_service' THEN 'خارج الخدمة'
          WHEN 'contract_cancelled' THEN 'ملغى بسبب إلغاء العقد'
          ELSE device.status
        END AS "currentDeviceStatus",
        CASE WHEN disconnection.water_disconnected IS TRUE THEN 'نعم' WHEN disconnection.id IS NOT NULL THEN 'لا' END AS "waterDisconnected",
        CASE WHEN disconnection.electricity_disconnected IS TRUE THEN 'نعم' WHEN disconnection.id IS NOT NULL THEN 'لا' END AS "electricityDisconnected",
        CASE WHEN disconnection.accessories_removed IS TRUE THEN 'نعم' WHEN disconnection.id IS NOT NULL THEN 'لا' END AS "accessoriesRemoved",
        COALESCE(NULLIF(BTRIM(disconnection.technical_notes), ''),
                 NULLIF(BTRIM(disconnection.closing_notes), '')) AS "disconnectionNotes",
        COALESCE(NULLIF(BTRIM(retrieval.technical_notes), ''),
                 NULLIF(BTRIM(result.closing_notes), '')) AS "retrievalNotes",
        CASE WHEN retrieval.customer_acknowledged IS TRUE THEN 'نعم'
             WHEN retrieval.customer_acknowledged IS FALSE THEN 'لا' END AS "customerAcknowledged",
        open_task.id AS "retrievalTaskId",
        result.updated_at AS "lastUpdatedAt"
        ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM visit_task_device_retrieval_results retrieval
      JOIN visit_task_results result ON result.id = retrieval.visit_task_result_id
      JOIN visit_tasks visit_task ON visit_task.id = result.visit_task_id
      JOIN open_tasks open_task ON open_task.id = visit_task.source_open_task_id
        AND open_task.task_type = 'device_retrieval'
      JOIN installed_devices device ON device.id = open_task.device_id
      JOIN clients client ON client.id = COALESCE(open_task.client_id, device.customer_id)
      JOIN branches service_branch ON service_branch.id = retrieval.service_branch_id
      LEFT JOIN branches origin_branch ON origin_branch.id = open_task.pre_retrieval_branch_id
      LEFT JOIN device_models device_model ON device_model.id = device.device_model_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE ancestors AS (
          SELECT unit.id, unit.name, unit.level, unit.parent_id
            FROM geo_units unit
           WHERE unit.id = open_task.pre_retrieval_geo_unit_id
          UNION ALL
          SELECT parent.id, parent.name, parent.level, parent.parent_id
            FROM geo_units parent
            JOIN ancestors child ON child.parent_id = parent.id
        )
        SELECT MAX(name) FILTER (WHERE level = 3) AS subarea_name,
               MAX(name) FILTER (WHERE level = 4) AS neighborhood_name
          FROM ancestors
      ) geo ON TRUE
      JOIN field_visits visit ON visit.id = visit_task.field_visit_id
      LEFT JOIN employees technician ON technician.id = ${TECHNICIAN_ID_SQL}
      LEFT JOIN LATERAL (
        SELECT disconnection_result.id,
               detail.water_disconnected, detail.electricity_disconnected,
               detail.accessories_removed, detail.technical_notes,
               disconnection_result.closing_notes
          FROM open_tasks disconnection_task
          JOIN visit_tasks disconnection_visit_task
            ON disconnection_visit_task.source_open_task_id = disconnection_task.id
          JOIN visit_task_results disconnection_result
            ON disconnection_result.visit_task_id = disconnection_visit_task.id
          JOIN visit_task_device_disconnection_results detail
            ON detail.visit_task_result_id = disconnection_result.id
         WHERE disconnection_task.device_id = open_task.device_id
           AND disconnection_task.task_type = 'device_disconnection'
           AND disconnection_result.final_decision IN ('disconnected_successfully', 'requires_retrieval')
           AND disconnection_result.closed_at <= result.closed_at
         ORDER BY disconnection_result.closed_at DESC, disconnection_result.id DESC
         LIMIT 1
      ) disconnection ON TRUE
      WHERE ${filters.join('\n        AND ')}
      ORDER BY ${buildTabularReportOrderBy(
        'service.retrieved_devices', access, request, 'result.closed_at DESC, retrieval.id DESC',
      )}
      LIMIT ${limitRef}${offsetSql}`,
  };
}

export async function getRetrievedDevicesFilterOptions(access: TabularReportAccess) {
  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'تقرير الأجهزة المسحوبة متاح على مستوى كل الفروع أو الفرع فقط');
  }
  const params: unknown[] = [];
  const branchCondition = access.branchIds.length === 0
    ? ''
    : `AND retrieval.service_branch_id = ANY($${params.push(access.branchIds)}::int[])`;
  const base = `
    FROM visit_task_device_retrieval_results retrieval
    JOIN visit_task_results result ON result.id = retrieval.visit_task_result_id
    JOIN visit_tasks visit_task ON visit_task.id = result.visit_task_id
    JOIN open_tasks open_task ON open_task.id = visit_task.source_open_task_id
      AND open_task.task_type = 'device_retrieval'
    JOIN installed_devices device ON device.id = open_task.device_id
    JOIN field_visits visit ON visit.id = visit_task.field_visit_id
    WHERE retrieval.final_decision = 'retrieved_successfully' ${branchCondition}`;

  const [deviceModels, technicians, statuses] = await Promise.all([
    pool.query(
      `SELECT DISTINCT
         CASE WHEN device.device_model_id IS NOT NULL THEN 'catalog:' || device.device_model_id::text
              ELSE 'external:' || COALESCE(device.external_device_name, device.device_model_name, '') END AS value,
         COALESCE(model.name_ar, model.name_en, model.name,
                  device.external_device_name, device.device_model_name) AS label
       ${base.replace('WHERE retrieval', 'LEFT JOIN device_models model ON model.id = device.device_model_id WHERE retrieval')}
       AND COALESCE(model.name_ar, model.name_en, model.name,
                    device.external_device_name, device.device_model_name) IS NOT NULL
       ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT employee.id::text AS value, employee.name AS label
       ${base.replace('WHERE retrieval', `JOIN employees employee ON employee.id = ${TECHNICIAN_ID_SQL} WHERE retrieval`)}
       ORDER BY label`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT device.status AS value,
         CASE device.status
           WHEN 'registered' THEN 'مسجل' WHEN 'pending_delivery' THEN 'بانتظار التسليم'
           WHEN 'delivery_suspended' THEN 'معلق التسليم'
           WHEN 'in_workshop' THEN 'في الورشة' WHEN 'ready' THEN 'جاهز'
           WHEN 'retrieved' THEN 'مُسترجع' WHEN 'delivered' THEN 'مُسلّم'
           WHEN 'installed' THEN 'مركّب' WHEN 'active' THEN 'فعّال'
           WHEN 'faulty' THEN 'معطل' WHEN 'out_of_service' THEN 'خارج الخدمة'
           WHEN 'contract_cancelled' THEN 'ملغى بسبب إلغاء العقد' ELSE device.status END AS label
       ${base}
       ORDER BY label`,
      params,
    ),
  ]);

  return {
    deviceModels: deviceModels.rows,
    retrievalTechnicians: technicians.rows,
    retrievedDeviceStatuses: statuses.rows,
  };
}
