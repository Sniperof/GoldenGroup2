import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { ReportingError } from './reportingError.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions {
  offset?: number;
  limit: number;
  includeTotalRows?: boolean;
}

/**
 * Whether the row carries an activation record, NOT whether its coverage is real.
 * The business confirmed `installed_devices.is_golden_warranty` is trustworthy, so
 * the 208 rows with no offer task are genuine coverage that predates the DEC-CT-17
 * flow — what they lack is the record of how they were sold, not the sale.
 */
const ACTIVATION_RECORDS = new Set(['recorded', 'unrecorded']);
const CONTRACT_SCOPES = new Set(['internal', 'external']);
const WARRANTY_STATUSES = new Set(['active', 'expired', 'cancelled', 'pending']);
/** `none` is a real answer here: no card task was ever created for the warranty. */
const CARD_RESULTS = new Set(['delivered', 'rescheduled', 'cancelled', 'none']);
const PARTS_PRESENCE = new Set(['yes', 'no']);

const WARRANTY_STATUS_LABELS: Record<string, string> = {
  active: 'سارية',
  expired: 'منتهية',
  cancelled: 'ملغاة',
  pending: 'بانتظار التفعيل',
};

/**
 * «سارية» means the coverage has not ended, NOT that a column says `active`.
 * Measured on the data: 203 golden warranties carry `status = 'active'` while only
 * 192 of them still have a future `end_date` — nothing expires the stored column
 * when the date passes. Filtering on the raw column would therefore have called
 * eleven ended warranties «سارية».
 *
 * The expression is the one `serviceDevicesReport` already shows as «حالة الكفالة
 * الذهبية», so both reports answer this question identically (§8.3), and it reads
 * the report's own visible «تاريخ انتهاء الكفالة» column (§9.7.1).
 */
const WARRANTY_STATE_SQL = `CASE
  WHEN warranty.status = 'cancelled' THEN 'cancelled'
  WHEN warranty.status = 'pending' THEN 'pending'
  WHEN warranty.end_date IS NULL OR warranty.end_date >= CURRENT_DATE THEN 'active'
  ELSE 'expired'
END`;

const DEVICE_STATUS_LABELS: Record<string, string> = {
  registered: 'مسجل',
  pending_delivery: 'بانتظار التسليم',
  delivery_suspended: 'معلق التسليم',
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

const DEVICE_STATUS_SQL = `CASE device.status
  ${Object.entries(DEVICE_STATUS_LABELS).map(([value, label]) => `WHEN '${value}' THEN '${label}'`).join('\n  ')}
  ELSE device.status
END`;

/** The subject is the warranty, and the branch it belongs to is its device's. */
const BRANCH_SCOPE_COLUMN = 'device.branch_id';

/**
 * The technician and supervisor of the visit the offer task was executed in, after
 * any reassignment — the same rule the technician-work report uses, and for the same
 * reason: one offer task carried an empty `open_tasks.team_snapshot` while its visit
 * carried the full team, so the visit is the authority.
 */
const OFFER_TEAM_LATERAL_SQL = `
    SELECT COALESCE(visit.reassigned_supervisor_id,
                    NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int) AS supervisor_id,
           COALESCE(visit.reassigned_technician_id,
                    NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int) AS technician_id
      FROM visit_tasks offer_visit_task
      JOIN field_visits visit ON visit.id = offer_visit_task.field_visit_id
     WHERE warranty.offer_task_id IS NOT NULL
       AND offer_visit_task.source_open_task_id = warranty.offer_task_id
       AND offer_visit_task.task_type = 'golden_warranty_offer'
     ORDER BY offer_visit_task.id DESC
     LIMIT 1`;

/**
 * The reading that describes the device at the moment the warranty was sold. A row
 * with an offer task is pinned to that task's baseline reading (01i §2); a row
 * without one has no «before the warranty task» to pin to, so it falls back to the
 * device's latest reading, which is what «الحالة الفنية الحالية» means in 01i §5.
 */
const TECHNICAL_STATE_LATERAL_SQL = `
    SELECT CONCAT_WS(' · ',
             CASE WHEN state.membrane_input_tds IS NOT NULL OR state.membrane_output_tds IS NOT NULL
                  THEN 'TDS ' || COALESCE(state.membrane_input_tds::text, '—')
                       || '→' || COALESCE(state.membrane_output_tds::text, '—') END,
             NULLIF(BTRIM(state.membrane_flow), ''),
             NULLIF(BTRIM(state.uv_lamp), '')) AS summary
      FROM device_technical_states state
     WHERE state.installed_device_id = device.id
       AND (warranty.offer_task_id IS NULL OR state.open_task_id = warranty.offer_task_id)
     ORDER BY state.created_at DESC, state.id DESC
     LIMIT 1`;

/**
 * DEC-GW-8: the call that BOOKED the offer visit, not the newest call to the
 * customer. Reading «the latest call after the task closed» pulled in calls about
 * unrelated work — one of them fourteen days later — so the date and the note both
 * come from the call linked to the offer task, and from the same row.
 */
const BOOKING_CALL_LATERAL_SQL = `
    SELECT call_log.call_date, call_log.notes
      FROM call_task_links link
      JOIN customer_call_logs call_log ON call_log.id = link.call_id
     WHERE warranty.offer_task_id IS NOT NULL
       AND link.task_id = warranty.offer_task_id
     ORDER BY link.is_primary DESC, call_log.call_date DESC NULLS LAST, link.created_at DESC
     LIMIT 1`;

const CARD_DELIVERY_LATERAL_SQL = `
    SELECT card_task.due_date,
           card_result.final_decision,
           card_result.closing_notes
      FROM open_tasks card_task
      LEFT JOIN visit_tasks card_visit_task
        ON card_visit_task.source_open_task_id = card_task.id
       AND card_visit_task.task_type = 'golden_warranty_card_delivery'
      LEFT JOIN visit_task_results card_result ON card_result.visit_task_id = card_visit_task.id
     WHERE card_task.id = warranty.card_delivery_task_id
     ORDER BY card_visit_task.id DESC NULLS LAST
     LIMIT 1`;

/**
 * DEC-GW-7: `device_installed_parts` is the single source — its grain is the device
 * and it alone separates «replaced» from «installed». Its own `event_date` is empty
 * on every replacement row in the data, so the event day falls back to the close of
 * the task that recorded it.
 *
 * The window is CLOSED when `start_date` is missing (DEC-GW-6): an open-ended window
 * would count parts replaced years before the coverage began.
 */
const REPLACED_PARTS_LATERAL_SQL = `
    SELECT STRING_AGG(part.part_name_snapshot || ' × ' || part.quantity::text, E'\\n'
                      ORDER BY part.part_name_snapshot) AS summary
      FROM (
        SELECT used.part_name_snapshot, SUM(used.quantity)::int AS quantity
          FROM device_installed_parts used
          LEFT JOIN LATERAL (
            SELECT MAX(source_result.closed_at)::date AS closed_day
              FROM visit_tasks source_task
              JOIN visit_task_results source_result ON source_result.visit_task_id = source_task.id
             WHERE source_task.source_open_task_id = used.open_task_id
          ) source_task ON TRUE
         WHERE warranty.start_date IS NOT NULL
           AND used.device_id = device.id
           AND used.event_type = 'replaced'
           AND COALESCE(used.event_date, source_task.closed_day)
               BETWEEN warranty.start_date AND warranty.end_date
         GROUP BY used.part_name_snapshot
      ) part`;

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
    SELECT MAX(name) FILTER (WHERE level = 3) AS subarea_name,
           MAX(name) FILTER (WHERE level = 4) AS neighborhood_name
      FROM ancestors`;

/** Takes the whole rejection message, so each filter reads as correct Arabic. */
function allowListed(value: unknown, values: Set<string>, message: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value);
  if (!values.has(normalized)) throw new ReportingError(400, message);
  return normalized;
}

function dateOnly(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

function addDateRange(
  filters: string[],
  params: unknown[],
  column: string,
  fromValue: unknown,
  toValue: unknown,
  label: string,
) {
  const from = dateOnly(fromValue, `بداية ${label}`);
  const to = dateOnly(toValue, `نهاية ${label}`);
  if (from && to && from > to) throw new ReportingError(400, `بداية ${label} يجب ألا تكون بعد نهايته`);
  if (from) filters.push(`${column} >= $${params.push(from)}::date`);
  if (to) filters.push(`${column} <= $${params.push(to)}::date`);
}

export function buildGoldenWarrantyQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'تقرير الكفالة الذهبية متاح على مستوى كل الفروع أو الفرع فقط');
  }

  const params: unknown[] = [];
  const filters = [`warranty.warranty_type = 'golden'`, 'client.deleted_at IS NULL'];

  if (access.branchIds.length > 0) {
    filters.push(`${BRANCH_SCOPE_COLUMN} = ANY($${params.push(access.branchIds)}::int[])`);
  }

  const activationRecord = allowListed(request.activationRecord, ACTIVATION_RECORDS, 'سجل التفعيل غير صالح');
  if (activationRecord === 'recorded') filters.push('warranty.offer_task_id IS NOT NULL');
  else if (activationRecord === 'unrecorded') filters.push('warranty.offer_task_id IS NULL');

  const warrantyStatus = allowListed(request.warrantyStatus, WARRANTY_STATUSES, 'حالة الكفالة غير صالحة');
  if (warrantyStatus) filters.push(`(${WARRANTY_STATE_SQL}) = $${params.push(warrantyStatus)}`);

  const contractScope = allowListed(request.contractScope, CONTRACT_SCOPES, 'حالة العقد غير صالحة');
  if (contractScope === 'external') filters.push(`device.device_source = 'external'`);
  else if (contractScope === 'internal') filters.push(`device.device_source <> 'external'`);

  const deviceStatus = typeof request.deviceStatus === 'string' && request.deviceStatus !== ''
    ? String(request.deviceStatus) : null;
  if (deviceStatus != null) {
    if (!Object.hasOwn(DEVICE_STATUS_LABELS, deviceStatus)) {
      throw new ReportingError(400, 'حالة صيانة الجهاز غير صالحة');
    }
    filters.push(`device.status = $${params.push(deviceStatus)}`);
  }

  const deviceModelKey = typeof request.deviceModel === 'string' ? request.deviceModel : '';
  const deviceModelId = positiveInt(
    request.deviceModelId ?? (deviceModelKey.startsWith('catalog:') ? deviceModelKey.slice(8) : null),
  );
  if (deviceModelId != null) {
    filters.push(`device.device_model_id = $${params.push(deviceModelId)}`);
  } else if (deviceModelKey.startsWith('external:')) {
    filters.push(
      `device.device_model_id IS NULL
         AND COALESCE(device.external_device_name, device.device_model_name, '') = $${params.push(deviceModelKey.slice(9))}`,
    );
  }

  const supervisorId = positiveInt(request.supervisorEmployeeId);
  if (supervisorId != null) filters.push(`offer_team.supervisor_id = $${params.push(supervisorId)}`);

  const technicianId = positiveInt(request.technicianEmployeeId);
  if (technicianId != null) filters.push(`offer_team.technician_id = $${params.push(technicianId)}`);

  // Reads the very expression that feeds the «النتيجة» column, so the filter and the
  // column can never disagree (§9.7.5).
  const cardResult = allowListed(request.cardDeliveryResult, CARD_RESULTS, 'نتيجة تسليم الكرت غير صالحة');
  if (cardResult === 'none') filters.push('card.final_decision IS NULL');
  else if (cardResult) filters.push(`card.final_decision = $${params.push(cardResult)}`);

  const partsPresence = allowListed(request.warrantyPartsPresence, PARTS_PRESENCE, 'قيمة فلتر القطع المبدلة غير صالحة');
  if (partsPresence === 'yes') filters.push('parts.summary IS NOT NULL');
  else if (partsPresence === 'no') filters.push('parts.summary IS NULL');

  addDateRange(filters, params, 'warranty.start_date', request.warrantyStartFrom, request.warrantyStartTo, 'تاريخ بداية الكفالة');
  addDateRange(filters, params, 'warranty.end_date', request.warrantyEndFrom, request.warrantyEndTo, 'تاريخ انتهاء الكفالة');

  const limitRef = `$${params.push(options.limit)}`;
  const offsetSql = options.offset == null ? '' : ` OFFSET $${params.push(options.offset)}`;

  const sql = `
    SELECT
      COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
      client.name AS "customerName",
      CASE WHEN device.device_source = 'external' THEN 'خارجي' ELSE 'داخلي' END AS "contractScope",
      ${DEVICE_STATUS_SQL} AS "deviceOperationalStatus",
      NULLIF(BTRIM(client.mobile), '') AS "primaryContactNumber",
      COALESCE(geo.neighborhood_name, geo.subarea_name, 'غير محدد') AS "areaName",
      COALESCE(NULLIF(BTRIM(device.serial_number), ''), NULLIF(BTRIM(device.external_device_serial), '')) AS "serialNumber",
      COALESCE(model.name_ar, model.name_en, model.name,
               device.external_device_name, device.device_model_name, 'غير محدد') AS "deviceModelName",
      TO_CHAR(device.installation_date, 'YYYY-MM-DD') AS "installationDate",
      TO_CHAR(last_periodic.executed_at AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS "lastPeriodicDate",
      technical_state.summary AS "technicalState",
      warranty.months AS "warrantyMonths",
      warranty.total_value AS "warrantyValue",
      TO_CHAR(warranty.start_date, 'YYYY-MM-DD') AS "warrantyStart",
      TO_CHAR(warranty.end_date, 'YYYY-MM-DD') AS "warrantyEnd",
      CASE WHEN warranty.offer_task_id IS NOT NULL
        THEN 'مسجَّل بمهمة عرض'
        ELSE 'غير مسجَّل — تغطية من سجل الجهاز'
      END AS "activationRecord",
      NULLIF(BTRIM(supervisor.name), '') AS "supervisorName",
      NULLIF(BTRIM(technician.name), '') AS "technicianName",
      TO_CHAR(booking_call.call_date AT TIME ZONE 'Asia/Damascus', 'YYYY-MM-DD') AS "contactDate",
      NULLIF(BTRIM(booking_call.notes), '') AS "contactNotes",
      TO_CHAR(card.due_date, 'YYYY-MM-DD') AS "cardAppointmentDate",
      CASE card.final_decision
        WHEN 'delivered' THEN 'سُلّم'
        WHEN 'rescheduled' THEN 'أُعيدت جدولته'
        WHEN 'cancelled' THEN 'أُلغي'
        ELSE card.final_decision
      END AS "cardDeliveryResult",
      NULLIF(BTRIM(card.closing_notes), '') AS "cardDeliveryNotes",
      CASE WHEN warranty.start_date IS NULL
        THEN 'مدة الكفالة غير مسجَّلة'
        ELSE parts.summary
      END AS "replacedPartsSummary"
      ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
    FROM device_warranties warranty
    JOIN installed_devices device ON device.id = warranty.device_id
    JOIN clients client ON client.id = device.customer_id
    LEFT JOIN branches branch ON branch.id = device.branch_id
    LEFT JOIN device_models model ON model.id = device.device_model_id
    LEFT JOIN LATERAL (${GEO_LATERAL_SQL}) geo ON TRUE
    LEFT JOIN LATERAL (
      SELECT MAX(periodic_result.closed_at) AS executed_at
        FROM visit_tasks periodic_task
        JOIN visit_task_results periodic_result ON periodic_result.visit_task_id = periodic_task.id
       WHERE periodic_task.device_id = device.id
         AND periodic_task.task_type = 'periodic_maintenance'
    ) last_periodic ON TRUE
    LEFT JOIN LATERAL (${TECHNICAL_STATE_LATERAL_SQL}) technical_state ON TRUE
    LEFT JOIN LATERAL (${OFFER_TEAM_LATERAL_SQL}) offer_team ON TRUE
    LEFT JOIN employees supervisor ON supervisor.id = offer_team.supervisor_id
    LEFT JOIN employees technician ON technician.id = offer_team.technician_id
    LEFT JOIN LATERAL (${BOOKING_CALL_LATERAL_SQL}) booking_call ON TRUE
    LEFT JOIN LATERAL (${CARD_DELIVERY_LATERAL_SQL}) card ON TRUE
    LEFT JOIN LATERAL (${REPLACED_PARTS_LATERAL_SQL}) parts ON TRUE
    WHERE ${filters.join('\n      AND ')}
    ORDER BY ${buildTabularReportOrderBy(
      'service.golden_warranty', access, request,
      'warranty.end_date ASC NULLS LAST, warranty.id ASC',
    )}
    LIMIT ${limitRef}${offsetSql}`;

  return { sql, params };
}

export async function getGoldenWarrantyReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildGoldenWarrantyQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  return { rows, total: Number(rows[0]?.totalRows ?? 0) };
}

/**
 * Every picker offers only what the report can actually show in the caller's scope
 * (§9.7.1): the device models, the operational statuses, and the two teams are read
 * from the warranty population itself, not from a global lookup.
 */
export async function getGoldenWarrantyFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  if (access.scope === 'ASSIGNED') {
    throw new ReportingError(403, 'تقرير الكفالة الذهبية متاح على مستوى كل الفروع أو الفرع فقط');
  }
  const params: unknown[] = [];
  const branchCondition = access.branchIds.length === 0
    ? ''
    : `AND ${BRANCH_SCOPE_COLUMN} = ANY($${params.push(access.branchIds)}::int[])`;
  const base = `
    FROM device_warranties warranty
    JOIN installed_devices device ON device.id = warranty.device_id
    JOIN clients client ON client.id = device.customer_id
   WHERE warranty.warranty_type = 'golden' AND client.deleted_at IS NULL ${branchCondition}`;

  /**
   * The two team pickers differ only in which snapshot key names the person, so they
   * share one shape: walk the warranty to its offer visit, then to the employee that
   * visit credits. A warranty with no offer task contributes nobody, which is the
   * truth — it has no team.
   */
  const teamOptionsSql = (idExpression: string) => `
    SELECT DISTINCT employee.id::text AS value, employee.name AS label
      FROM device_warranties warranty
      JOIN installed_devices device ON device.id = warranty.device_id
      JOIN clients client ON client.id = device.customer_id
      JOIN visit_tasks offer_visit_task
        ON offer_visit_task.source_open_task_id = warranty.offer_task_id
       AND offer_visit_task.task_type = 'golden_warranty_offer'
      JOIN field_visits visit ON visit.id = offer_visit_task.field_visit_id
      JOIN employees employee ON employee.id = ${idExpression}
     WHERE warranty.warranty_type = 'golden' AND client.deleted_at IS NULL ${branchCondition}
     ORDER BY label`;

  const [models, statuses, supervisors, technicians] = await Promise.all([
    pool.query(
      `SELECT DISTINCT
              CASE WHEN device.device_model_id IS NOT NULL THEN 'catalog:' || device.device_model_id::text
                   ELSE 'external:' || COALESCE(device.external_device_name, device.device_model_name, '') END AS value,
              COALESCE(model.name_ar, model.name_en, model.name,
                       device.external_device_name, device.device_model_name) AS label
         FROM device_warranties warranty
         JOIN installed_devices device ON device.id = warranty.device_id
         JOIN clients client ON client.id = device.customer_id
         LEFT JOIN device_models model ON model.id = device.device_model_id
        WHERE warranty.warranty_type = 'golden' AND client.deleted_at IS NULL ${branchCondition}
          AND COALESCE(model.name_ar, model.name_en, model.name,
                       device.external_device_name, device.device_model_name) IS NOT NULL
        ORDER BY label`,
      params,
    ),
    pool.query(`SELECT DISTINCT device.status AS value ${base} ORDER BY value`, params),
    pool.query(
      teamOptionsSql(`COALESCE(visit.reassigned_supervisor_id, NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int)`),
      params,
    ),
    pool.query(
      teamOptionsSql(`COALESCE(visit.reassigned_technician_id, NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int)`),
      params,
    ),
  ]);

  return {
    deviceModels: models.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    deviceStatuses: statuses.rows.map(row => ({
      value: String(row.value),
      label: DEVICE_STATUS_LABELS[String(row.value)] ?? String(row.value),
    })),
    warrantyStatuses: Object.entries(WARRANTY_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    supervisors: supervisors.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    technicians: technicians.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
