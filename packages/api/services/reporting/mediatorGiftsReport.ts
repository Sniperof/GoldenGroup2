import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

const MEDIATOR_TYPES = new Set(['Client', 'Employee', 'Personal', 'unknown']);
const GIFT_STATUSES = new Set(['none', 'promised', 'approved_for_delivery', 'delivery_task_created', 'delivered', 'delivered_manually', 'cancelled', 'refused']);
const GIFT_CONDITION_STATUSES = new Set(['none', 'pending', 'met', 'not_met']);
const GIFT_DELIVERY_RESULTS = new Set(['none', 'delivered_successfully', 'refused_gift', 'rescheduled']);
const VISIT_TECHNICIAN_ID_SQL = `COALESCE(visit.reassigned_technician_id, NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int)`;
const VISIT_SUPERVISOR_ID_SQL = `COALESCE(visit.reassigned_supervisor_id, NULLIF(visit.team_snapshot->>'supervisorEmployeeId', '')::int)`;

function textFilter(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function enumFilter(value: unknown, allowed: Set<string>, label: string): string | null {
  const normalized = textFilter(value);
  if (normalized == null) return null;
  if (!allowed.has(normalized)) throw new ReportingError(400, `${label} غير صالح`);
  return normalized;
}

function dateFilter(value: unknown, label: string): string | null {
  const normalized = textFilter(value);
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

function appendDateRange(
  filters: string[], params: unknown[], from: unknown, to: unknown,
  expression: string, label: string,
) {
  const normalizedFrom = dateFilter(from, `بداية ${label}`);
  const normalizedTo = dateFilter(to, `نهاية ${label}`);
  if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
    throw new ReportingError(400, `بداية ${label} يجب ألا تكون بعد نهايته`);
  }
  if (normalizedFrom) { params.push(normalizedFrom); filters.push(`${expression} >= $${params.length}::date`); }
  if (normalizedTo) { params.push(normalizedTo); filters.push(`${expression} <= $${params.length}::date`); }
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value)).filter((value): value is number => value != null)));
}

/**
 * One gift may come from the candidate, their name list, or the sale that made
 * the converted client OP. The beneficiary guard keeps the customer's own gift
 * out of the mediator columns.
 */
const MATCHED_GIFTS_SQL = `
  SELECT DISTINCT record.*
    FROM gift_records record
    LEFT JOIN gift_record_sources source ON source.gift_record_id = record.id
   WHERE record.beneficiary_type IN ('customer_referrer','employee_referrer','personal_referrer')
     AND (
       (source.source_type='candidate' AND source.candidate_id=candidate.id)
       OR (candidate.referral_sheet_id IS NOT NULL AND source.source_type='name_list' AND source.referral_sheet_id=candidate.referral_sheet_id)
       OR (sale.contract_id IS NOT NULL AND source.source_type='contract' AND source.contract_id=sale.contract_id)
       OR (sale.contract_id IS NOT NULL AND record.contract_id=sale.contract_id)
       OR record.customer_id=converted_client.id
     )`;

export function buildMediatorGiftsQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = [
    `candidate.qualification_kind='converted'`,
    `candidate.converted_to_lead_id IS NOT NULL`,
    `converted_client.candidate_status='OP'`,
    `converted_client.deleted_at IS NULL`,
    `NULLIF(BTRIM(COALESCE(sheet.referral_name_snapshot,candidate.referral_name_snapshot,mediator_client.name,mediator_employee.name,'')), '') IS NOT NULL`,
  ];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`candidate.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (SELECT 1 FROM candidate_assignments scoped_assignment
      WHERE scoped_assignment.candidate_id=candidate.id AND scoped_assignment.hr_user_id=$${params.length})`);
  }

  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    filters.push(`(location0.id=ANY($${params.length}::int[]) OR location1.id=ANY($${params.length}::int[])
      OR location2.id=ANY($${params.length}::int[]) OR location3.id=ANY($${params.length}::int[]))`);
  }

  const sourceType = enumFilter(request.candidateSourceType, new Set(['direct', 'name_list']), 'مسار الترشيح');
  if (sourceType === 'direct') filters.push('candidate.referral_sheet_id IS NULL');
  if (sourceType === 'name_list') filters.push('candidate.referral_sheet_id IS NOT NULL');

  const mediatorType = enumFilter(request.mediatorType, MEDIATOR_TYPES, 'نوع الوسيط');
  if (mediatorType === 'unknown') filters.push(`COALESCE(sheet.referral_type,candidate.referral_type) IS NULL`);
  else if (mediatorType) { params.push(mediatorType); filters.push(`COALESCE(sheet.referral_type,candidate.referral_type)=$${params.length}`); }

  if (request.referralSheetNumber != null && request.referralSheetNumber !== '') {
    const sheetId = positiveInt(request.referralSheetNumber);
    if (sheetId == null) throw new ReportingError(400, 'رقم لائحة الأسماء غير صالح');
    params.push(sheetId); filters.push(`candidate.referral_sheet_id=$${params.length}`);
  }

  const deviceModelId = positiveInt(request.deviceModelId);
  if (request.deviceModelId != null && request.deviceModelId !== '' && deviceModelId == null) {
    throw new ReportingError(400, 'نوع الجهاز غير صالح');
  }
  if (deviceModelId != null) { params.push(deviceModelId); filters.push(`sale.device_model_id=$${params.length}`); }

  const supervisorId = positiveInt(request.supervisorEmployeeId);
  if (request.supervisorEmployeeId != null && request.supervisorEmployeeId !== '' && supervisorId == null) {
    throw new ReportingError(400, 'مشرفة التركيب غير صالحة');
  }
  if (supervisorId != null) { params.push(supervisorId); filters.push(`installation.supervisor_id=$${params.length}`); }

  const technicianId = positiveInt(request.technicianEmployeeId);
  if (request.technicianEmployeeId != null && request.technicianEmployeeId !== '' && technicianId == null) {
    throw new ReportingError(400, 'فني التركيب غير صالح');
  }
  if (technicianId != null) { params.push(technicianId); filters.push(`installation.technician_id=$${params.length}`); }

  appendDateRange(filters, params, request.opFrom, request.opTo,
    `(sale.closing_date AT TIME ZONE 'Asia/Damascus')::date`, 'تاريخ التحول إلى OP');
  appendDateRange(filters, params, request.contractFrom, request.contractTo,
    `sale.contract_date`, 'تاريخ العقد');
  appendDateRange(filters, params, request.installationFrom, request.installationTo,
    `sale.installation_date`, 'تاريخ التركيب');
  appendDateRange(filters, params, request.giftDeliveryFrom, request.giftDeliveryTo,
    `gift.delivered_at`, 'تاريخ تسليم الهدية');

  const giftStatus = enumFilter(request.giftPromiseStatus, GIFT_STATUSES, 'حالة الهدية');
  if (giftStatus === 'none') filters.push('gift.record_count=0');
  else if (giftStatus) { params.push(giftStatus); filters.push(`$${params.length}=ANY(gift.status_keys)`); }

  const conditionStatus = enumFilter(request.giftConditionStatus, GIFT_CONDITION_STATUSES, 'حالة الاستحقاق');
  if (conditionStatus === 'none') filters.push('gift.record_count=0');
  else if (conditionStatus) { params.push(conditionStatus); filters.push(`$${params.length}=ANY(gift.condition_keys)`); }

  const deliveryResult = enumFilter(request.giftDeliveryResult, GIFT_DELIVERY_RESULTS, 'نتيجة تسليم الهدية');
  if (deliveryResult === 'none') filters.push(`COALESCE(cardinality(gift.delivery_result_keys),0)=0`);
  else if (deliveryResult) { params.push(deliveryResult); filters.push(`$${params.length}=ANY(gift.delivery_result_keys)`); }

  const giftDefinitionId = positiveInt(request.giftDefinitionId);
  if (request.giftDefinitionId != null && request.giftDefinitionId !== '' && giftDefinitionId == null) {
    throw new ReportingError(400, 'نوع الهدية غير صالح');
  }
  if (giftDefinitionId != null) { params.push(giftDefinitionId); filters.push(`$${params.length}=ANY(gift.definition_ids)`); }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) { params.push(options.offset); offsetSql = ` OFFSET $${params.length}`; }

  const sql = `
    SELECT candidate.branch_id AS "branchId",
           COALESCE(branch.name,'غير محدد') AS "branchName",
           candidate.id AS "candidateId",
           CASE WHEN candidate.referral_sheet_id IS NULL THEN 'ترشيح مباشر' ELSE 'لائحة أسماء' END AS "referralPath",
           candidate.referral_sheet_id AS "referralSheetNumber",
           (candidate.created_at AT TIME ZONE 'Asia/Damascus')::date AS "candidateAddedDate",
           COALESCE(NULLIF(BTRIM(sheet.referral_name_snapshot),''),NULLIF(BTRIM(candidate.referral_name_snapshot),''),
                    NULLIF(BTRIM(mediator_client.name),''),NULLIF(BTRIM(mediator_employee.name),'')) AS "mediatorName",
           CASE COALESCE(sheet.referral_type,candidate.referral_type)
             WHEN 'Client' THEN 'زبون' WHEN 'Employee' THEN 'موظف' WHEN 'Personal' THEN 'شخصي' ELSE 'غير محدد' END AS "mediatorType",
           CASE COALESCE(sheet.referral_type,candidate.referral_type)
             WHEN 'Client' THEN mediator_client.mobile WHEN 'Employee' THEN mediator_employee.mobile END AS "mediatorPhone",
           COALESCE(NULLIF(BTRIM(sheet.referral_address_text),''),NULLIF(BTRIM(converted_client.referral_address_text),''),
                    CASE WHEN COALESCE(sheet.referral_type,candidate.referral_type)='Client' THEN NULLIF(BTRIM(mediator_client.detailed_address),'') END) AS "mediatorAddress",
           converted_client.id AS "customerId",
           COALESCE(NULLIF(BTRIM(converted_client.name),''),NULLIF(BTRIM(CONCAT_WS(' ',candidate.first_name,candidate.last_name)),''),'غير محدد') AS "customerName",
           NULLIF(BTRIM(converted_client.mobile),'') AS "customerPhone",
           COALESCE(CASE WHEN location0.level=3 THEN location0.name WHEN location1.level=3 THEN location1.name WHEN location2.level=3 THEN location2.name WHEN location3.level=3 THEN location3.name END,'غير محدد') AS "subareaName",
           COALESCE(CASE WHEN location0.level=4 THEN location0.name WHEN location1.level=4 THEN location1.name WHEN location2.level=4 THEN location2.name WHEN location3.level=4 THEN location3.name END,'غير محدد') AS "neighborhoodName",
           COALESCE(NULLIF(BTRIM(sale.installation_address),''),NULLIF(BTRIM(converted_client.detailed_address),'')) AS "customerAddress",
           sale.contract_id AS "contractId", sale.contract_number AS "contractNumber",
           sale.contract_date AS "contractDate",
           (sale.closing_date AT TIME ZONE 'Asia/Damascus')::date AS "opDate",
           sale.sale_notes AS "saleNotes", COALESCE(sale.device_model_name,'غير محدد') AS "deviceModelName",
           sale.installation_date AS "installationDate",
           installation.supervisor_name AS "installationSupervisorName",
           installation.technician_name AS "installationTechnicianName",
           gift.record_numbers AS "giftRecordNumbers",
           COALESCE(gift.gift_summary,'لم يُنشأ سجل هدية') AS "giftSummary",
           COALESCE(gift.condition_summary,'لا يوجد سجل هدية') AS "giftConditionStatus",
           COALESCE(gift.status_summary,'لم يُنشأ سجل هدية') AS "giftStatus",
           gift.delivery_appointments AS "giftDeliveryAppointments",
           gift.delivery_technicians AS "giftDeliveryTechnicians",
           gift.delivery_results AS "giftDeliveryResults",
           gift.delivery_notes AS "giftDeliveryNotes",
           gift.delivered_at AS "giftDeliveredAt"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM candidates candidate
      JOIN clients converted_client ON converted_client.id=candidate.converted_to_lead_id
      JOIN branches branch ON branch.id=candidate.branch_id
      LEFT JOIN referral_sheets sheet ON sheet.id=candidate.referral_sheet_id
      LEFT JOIN clients mediator_client
        ON COALESCE(sheet.referral_type,candidate.referral_type)='Client'
       AND mediator_client.id=COALESCE(sheet.referral_entity_id,candidate.referral_entity_id)
       AND mediator_client.deleted_at IS NULL
      LEFT JOIN employees mediator_employee
        ON COALESCE(sheet.referral_type,candidate.referral_type)='Employee'
       AND mediator_employee.id=COALESCE(sheet.referral_entity_id,candidate.referral_entity_id)
      LEFT JOIN LATERAL (
        SELECT contract.id AS contract_id, contract.contract_number,
               CASE WHEN contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN contract.contract_date::date END AS contract_date,
               contract.closing_date, NULLIF(BTRIM(contract.invoice_notes),'') AS sale_notes,
               COALESCE(device.device_model_id,contract.device_model_id) AS device_model_id,
               COALESCE(NULLIF(BTRIM(device.device_model_name),''),NULLIF(BTRIM(device.external_device_name),''),NULLIF(BTRIM(contract.device_model_name),'')) AS device_model_name,
               device.installation_date, device.installation_geo_unit_id,
               NULLIF(BTRIM(device.installation_address_text),'') AS installation_address
          FROM contracts contract
          LEFT JOIN installed_devices device ON device.contract_id=contract.id
         WHERE contract.customer_id=converted_client.id
           AND contract.status IN ('active','completed','cancelled')
         ORDER BY contract.closing_date ASC NULLS LAST, contract.created_at ASC, contract.id ASC
         LIMIT 1
      ) sale ON TRUE
      LEFT JOIN LATERAL (
        SELECT ${VISIT_SUPERVISOR_ID_SQL} AS supervisor_id, supervisor.name AS supervisor_name,
               ${VISIT_TECHNICIAN_ID_SQL} AS technician_id, technician.name AS technician_name
          FROM open_tasks installation_task
          JOIN visit_tasks installation_visit_task ON installation_visit_task.source_open_task_id=installation_task.id
          JOIN field_visits visit ON visit.id=installation_visit_task.field_visit_id
          LEFT JOIN visit_task_results result ON result.visit_task_id=installation_visit_task.id
          LEFT JOIN employees supervisor ON supervisor.id=${VISIT_SUPERVISOR_ID_SQL}
          LEFT JOIN employees technician ON technician.id=${VISIT_TECHNICIAN_ID_SQL}
         WHERE installation_task.contract_id=sale.contract_id AND installation_task.task_type='device_installation'
         ORDER BY result.closed_at DESC NULLS LAST, installation_visit_task.id DESC
         LIMIT 1
      ) installation ON TRUE
      LEFT JOIN geo_units location0 ON location0.id=COALESCE(sale.installation_geo_unit_id,converted_client.neighborhood,converted_client.district,converted_client.governorate)
      LEFT JOIN geo_units location1 ON location1.id=location0.parent_id
      LEFT JOIN geo_units location2 ON location2.id=location1.parent_id
      LEFT JOIN geo_units location3 ON location3.id=location2.parent_id
      LEFT JOIN LATERAL (
        WITH matched_gifts AS (${MATCHED_GIFTS_SQL}), enriched AS (
          SELECT record.*,
                 definition.name AS gift_name,
                 task.due_date AS delivery_appointment,
                 COALESCE(result.final_decision,'') AS delivery_result,
                 COALESCE(result.technician_name,task.technician_name) AS delivery_technician,
                 COALESCE(NULLIF(BTRIM(result.notes),''),NULLIF(BTRIM(record.manual_delivery_notes),''),NULLIF(BTRIM(task.notes),'')) AS delivery_note,
                 COALESCE(record.manual_delivered_at,
                   CASE WHEN result.final_decision='delivered_successfully' THEN result.closed_at END) AS actual_delivery_at
            FROM matched_gifts record
            JOIN gift_definitions definition ON definition.id=record.gift_definition_id
            LEFT JOIN LATERAL (
              SELECT open_task.due_date,open_task.notes,technician.name AS technician_name
                FROM gift_delivery_task_records link
                JOIN open_tasks open_task ON open_task.id=link.open_task_id
                LEFT JOIN visit_tasks visit_task ON visit_task.source_open_task_id=open_task.id
                LEFT JOIN field_visits visit ON visit.id=visit_task.field_visit_id
                LEFT JOIN employees technician ON technician.id=${VISIT_TECHNICIAN_ID_SQL}
               WHERE link.gift_record_id=record.id
               ORDER BY link.is_active DESC,link.linked_at DESC,visit_task.id DESC NULLS LAST LIMIT 1
            ) task ON TRUE
            LEFT JOIN LATERAL (
              SELECT delivery.final_decision,delivery.rescheduled_date,delivery.notes,result.closed_at,
                     technician.name AS technician_name
                FROM visit_task_gift_delivery_results delivery
                JOIN visit_task_results result ON result.id=delivery.visit_task_result_id
                JOIN visit_tasks visit_task ON visit_task.id=result.visit_task_id
                JOIN field_visits visit ON visit.id=visit_task.field_visit_id
                LEFT JOIN employees technician ON technician.id=${VISIT_TECHNICIAN_ID_SQL}
               WHERE delivery.gift_record_id=record.id
               ORDER BY result.closed_at DESC NULLS LAST,delivery.id DESC LIMIT 1
            ) result ON TRUE
        )
        SELECT COUNT(*)::int AS record_count,
               ARRAY_AGG(DISTINCT gift_definition_id) AS definition_ids,
               ARRAY_AGG(DISTINCT status) AS status_keys,
               ARRAY_AGG(DISTINCT condition_status) AS condition_keys,
               ARRAY_AGG(DISTINCT NULLIF(delivery_result,'')) FILTER (WHERE NULLIF(delivery_result,'') IS NOT NULL) AS delivery_result_keys,
               STRING_AGG(DISTINCT id::text,'، ') AS record_numbers,
               STRING_AGG(DISTINCT gift_name || ' × ' || COALESCE(approved_quantity,promised_quantity)::text,'، ') AS gift_summary,
               STRING_AGG(DISTINCT CASE condition_status WHEN 'pending' THEN 'قيد التحقق' WHEN 'met' THEN 'متحقق' WHEN 'not_met' THEN 'غير متحقق' ELSE condition_status END,'، ') AS condition_summary,
               STRING_AGG(DISTINCT CASE status WHEN 'promised' THEN 'موعود' WHEN 'approved_for_delivery' THEN 'معتمد للتسليم' WHEN 'delivery_task_created' THEN 'تم إنشاء مهمة التسليم' WHEN 'delivered' THEN 'تم التسليم' WHEN 'delivered_manually' THEN 'تم التسليم يدوياً' WHEN 'cancelled' THEN 'ملغى' WHEN 'refused' THEN 'مرفوض' ELSE status END,'، ') AS status_summary,
               STRING_AGG(DISTINCT TO_CHAR(delivery_appointment,'YYYY-MM-DD'),'، ') FILTER (WHERE delivery_appointment IS NOT NULL) AS delivery_appointments,
               STRING_AGG(DISTINCT delivery_technician,'، ') FILTER (WHERE delivery_technician IS NOT NULL) AS delivery_technicians,
               STRING_AGG(DISTINCT CASE delivery_result WHEN 'delivered_successfully' THEN 'تم التسليم بنجاح' WHEN 'refused_gift' THEN 'رُفضت الهدية' WHEN 'rescheduled' THEN 'أعيد تحديد الموعد' ELSE delivery_result END,'، ') FILTER (WHERE NULLIF(delivery_result,'') IS NOT NULL) AS delivery_results,
               STRING_AGG(DISTINCT delivery_note,'، ') FILTER (WHERE delivery_note IS NOT NULL) AS delivery_notes,
               MAX(actual_delivery_at)::date AS delivered_at
          FROM enriched
      ) gift ON TRUE
     WHERE ${filters.join(' AND ')}
     ORDER BY ${buildTabularReportOrderBy('work_files.mediator_gifts',access,request,'candidate.id DESC')}
     LIMIT ${limitRef}${offsetSql}`;
  return { sql, params };
}

export async function getMediatorGiftsFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const params: unknown[] = [];
  const scope = [`candidate.qualification_kind='converted'`, `client.candidate_status='OP'`, `client.deleted_at IS NULL`];
  if (access.branchIds.length > 0) { params.push(access.branchIds); scope.push(`candidate.branch_id=ANY($${params.length}::int[])`); }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    scope.push(`EXISTS (SELECT 1 FROM candidate_assignments assignment WHERE assignment.candidate_id=candidate.id AND assignment.hr_user_id=$${params.length})`);
  }
  const { rows } = await pool.query(`
    WITH eligible AS (
      SELECT candidate.id,candidate.referral_sheet_id,client.id AS client_id
        FROM candidates candidate JOIN clients client ON client.id=candidate.converted_to_lead_id
       WHERE ${scope.join(' AND ')}
    ), sales AS (
      SELECT eligible.*,sale.contract_id,sale.device_model_id
        FROM eligible
        LEFT JOIN LATERAL (
          SELECT contract.id AS contract_id,COALESCE(device.device_model_id,contract.device_model_id) AS device_model_id
            FROM contracts contract LEFT JOIN installed_devices device ON device.contract_id=contract.id
           WHERE contract.customer_id=eligible.client_id AND contract.status IN ('active','completed','cancelled')
           ORDER BY contract.closing_date ASC NULLS LAST,contract.created_at ASC,contract.id ASC LIMIT 1
        ) sale ON TRUE
    ), installations AS (
      SELECT sales.*,
             ${VISIT_SUPERVISOR_ID_SQL} AS supervisor_id,
             ${VISIT_TECHNICIAN_ID_SQL} AS technician_id
        FROM sales
        LEFT JOIN open_tasks installation_task
          ON installation_task.contract_id=sales.contract_id AND installation_task.task_type='device_installation'
        LEFT JOIN visit_tasks installation_visit_task ON installation_visit_task.source_open_task_id=installation_task.id
        LEFT JOIN field_visits visit ON visit.id=installation_visit_task.field_visit_id
    )
    SELECT
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT DISTINCT JSONB_BUILD_OBJECT('value',model.id::text,'label',model.name) item
          FROM sales JOIN device_models model ON model.id=sales.device_model_id
      ) q),'[]'::jsonb) AS "deviceModels",
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT DISTINCT JSONB_BUILD_OBJECT('value',employee.id::text,'label',employee.name) item
          FROM installations JOIN employees employee ON employee.id=installations.supervisor_id
         WHERE NULLIF(BTRIM(employee.name),'') IS NOT NULL
      ) q),'[]'::jsonb) AS supervisors,
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT DISTINCT JSONB_BUILD_OBJECT('value',employee.id::text,'label',employee.name) item
          FROM installations JOIN employees employee ON employee.id=installations.technician_id
         WHERE NULLIF(BTRIM(employee.name),'') IS NOT NULL
      ) q),'[]'::jsonb) AS technicians,
      COALESCE((SELECT JSONB_AGG(item ORDER BY item->>'label') FROM (
        SELECT JSONB_BUILD_OBJECT('value',status,'label',CASE status
          WHEN 'promised' THEN 'موعود' WHEN 'approved_for_delivery' THEN 'معتمد للتسليم'
          WHEN 'delivery_task_created' THEN 'تم إنشاء مهمة التسليم' WHEN 'delivered' THEN 'تم التسليم'
          WHEN 'delivered_manually' THEN 'تم التسليم يدوياً' WHEN 'cancelled' THEN 'ملغى'
          WHEN 'refused' THEN 'مرفوض' ELSE status END) item
          FROM (SELECT DISTINCT status FROM gift_records) statuses
      ) q),'[]'::jsonb) AS "giftPromiseStatuses",
      COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('value',definition.id::text,'label',definition.name) ORDER BY definition.name)
        FROM gift_definitions definition),'[]'::jsonb) AS "giftDefinitions"
  `, params);
  return rows[0] ?? {};
}
