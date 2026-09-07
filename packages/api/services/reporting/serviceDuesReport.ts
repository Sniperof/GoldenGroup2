import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

const BRANCH_SQL = `COALESCE(contract.service_branch_id, contract.branch_id)`;
const CUTOFF_SQL = `$CUTOFF::date + INTERVAL '1 day'`;
const CONTRACT_MONEY_SOURCES_SQL = `movement.source_type IN ('contract', 'contract_installment', 'contract_payment')`;
const PAYMENT_TYPES = new Set(['cash', 'installment']);
const COLLECTION_RESULTS = new Set(['paid_full', 'paid_partial', 'rescheduled', 'refused_to_pay', 'none']);

const PAYMENT_TYPE_LABEL_SQL = `CASE contract.payment_type
  WHEN 'cash' THEN 'نقدي'
  WHEN 'installment' THEN 'تقسيط'
  ELSE COALESCE(NULLIF(BTRIM(contract.payment_type), ''), 'غير محدد') END`;

const PAYMENT_METHOD_LABEL_SQL = `CASE entry.method
  WHEN 'cash' THEN 'نقدي'
  WHEN 'sham_cash' THEN 'شام كاش'
  WHEN 'syriatel_cash' THEN 'سيرياتيل كاش'
  WHEN 'mtn_cash' THEN 'إم تي إن كاش'
  WHEN 'alharam' THEN 'الهرم'
  WHEN 'bank_transfer' THEN 'حوالة بنكية'
  WHEN 'barter' THEN 'مقايضة'
  WHEN 'usd_cash' THEN 'نقدي دولار'
  ELSE NULLIF(BTRIM(entry.method), '') END`;

const COLLECTION_RESULT_LABEL_SQL = `CASE latest_result.final_decision
  WHEN 'paid_full' THEN 'تم التسديد بالكامل'
  WHEN 'paid_partial' THEN 'تم التسديد جزئيًا'
  WHEN 'rescheduled' THEN 'أعيدت جدولة التحصيل'
  WHEN 'refused_to_pay' THEN 'رفض الزبون الدفع'
  ELSE 'لا توجد نتيجة' END`;

function textFilter(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateFilter(value: unknown, label: string): string | null {
  const normalized = textFilter(value);
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(String(request.geoIds ?? request.geoUnitId ?? '')
    .split(',').map(value => positiveInt(value))
    .filter((value): value is number => value != null)));
}

function cutoffExpression(parameterIndex: number): string {
  return CUTOFF_SQL.replace('$CUTOFF', `$${parameterIndex}`);
}

export function buildServiceDuesQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = [
    `installment.confirmed IS TRUE`,
    `contract.sale_subtype = 'definitive'`,
    `contract.status IN ('active', 'completed', 'cancelled')`,
  ];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`${BRANCH_SQL} = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`installment.collection_owner_id = $${params.length}`);
  }

  const fromDate = dateFilter(request.fromDate, 'بداية مدى تاريخ الاستحقاق');
  const toDate = dateFilter(request.toDate, 'نهاية مدى تاريخ الاستحقاق');
  const financialAsOfDate = dateFilter(request.financialAsOfDate, 'تاريخ الحالة المالية');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدى تاريخ الاستحقاق مطلوب لتوليد التقرير');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية مدى تاريخ الاستحقاق يجب ألا تكون بعد نهايته');
  if (!financialAsOfDate) throw new ReportingError(400, 'تاريخ الحالة المالية مطلوب لتوليد التقرير');

  params.push(fromDate);
  filters.push(`installment.due_date >= $${params.length}::date`);
  params.push(toDate);
  filters.push(`installment.due_date <= $${params.length}::date`);
  params.push(financialAsOfDate);
  const cutoffIndex = params.length;
  const cutoffEnd = cutoffExpression(cutoffIndex);
  filters.push(`installment.created_at < ${cutoffEnd}`);
  filters.push(`(contract.status <> 'cancelled' OR contract.cancelled_at >= ${cutoffEnd})`);
  filters.push(`historical_installment.remaining_balance > 0`);

  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    filters.push(`geo.unit_ids && $${params.length}::int[]`);
  }

  if (request.collectionOwnerId != null && request.collectionOwnerId !== '') {
    const collectionOwnerId = positiveInt(request.collectionOwnerId);
    if (collectionOwnerId == null) throw new ReportingError(400, 'مسؤول التحصيل غير صالح');
    params.push(collectionOwnerId);
    filters.push(`installment.collection_owner_id = $${params.length}`);
  }
  if (request.sellerEmployeeId != null && request.sellerEmployeeId !== '') {
    const sellerEmployeeId = positiveInt(request.sellerEmployeeId);
    if (sellerEmployeeId == null) throw new ReportingError(400, 'البائع غير صالح');
    params.push(sellerEmployeeId);
    filters.push(`contract.sale_owner_id = $${params.length}`);
  }
  if (request.saleCloserUserId != null && request.saleCloserUserId !== '') {
    const closerId = positiveInt(request.saleCloserUserId);
    if (closerId == null) throw new ReportingError(400, 'موظف إغلاق البيع غير صالح');
    params.push(closerId);
    filters.push(`contract.closing_employee_id = $${params.length}`);
  }
  const paymentType = textFilter(request.paymentType);
  if (paymentType != null) {
    if (!PAYMENT_TYPES.has(paymentType)) throw new ReportingError(400, 'نوع السداد غير صالح');
    params.push(paymentType);
    filters.push(`contract.payment_type = $${params.length}`);
  }
  const latestCollectionResult = textFilter(request.latestCollectionResult);
  if (latestCollectionResult != null) {
    if (!COLLECTION_RESULTS.has(latestCollectionResult)) throw new ReportingError(400, 'نتيجة التحصيل غير صالحة');
    if (latestCollectionResult === 'none') filters.push(`latest_result.final_decision IS NULL`);
    else {
      params.push(latestCollectionResult);
      filters.push(`latest_result.final_decision = $${params.length}`);
    }
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
      SELECT ${BRANCH_SQL} AS "branchId",
             COALESCE(branch.name, 'غير محدد') AS "branchName",
             COALESCE(geo.governorate_name, 'غير محدد') AS "governorateName",
             COALESCE(geo.region_name, 'غير محدد') AS "regionName",
             COALESCE(geo.subarea_name, 'غير محدد') AS "subareaName",
             COALESCE(geo.neighborhood_name, 'غير محدد') AS "neighborhoodName",
             COALESCE(NULLIF(BTRIM(client.name), ''), NULLIF(BTRIM(contract.customer_name), ''), 'غير محدد') AS "customerName",
             COALESCE(NULLIF(BTRIM(latest_task.receivable_source_label), ''), 'عقد رقم ' || COALESCE(contract.contract_number, contract.id::text)) AS "receivableSource",
             TO_CHAR(source_event.event_date, 'YYYY-MM-DD') AS "sourceEventDate",
             TO_CHAR(installment.due_date, 'YYYY-MM-DD') AS "dueDate",
             COALESCE(contract.final_price, 0)::numeric AS "contractFinalValue",
             ${PAYMENT_TYPE_LABEL_SQL} AS "agreedPaymentType",
             installment.amount_syp::numeric AS "installmentDueAmount",
             COALESCE(contract_money_before_due.collected_total, 0)::numeric AS "contractCollectedTotal",
             GREATEST(COALESCE(contract.final_price, 0) + COALESCE(contract_money_before_due.refund_total, 0)
               - COALESCE(contract_money_before_due.collected_total, 0) - COALESCE(contract_money_before_due.discount_total, 0), 0)::numeric AS "contractRemainingBalance",
             TO_CHAR((last_payment.received_at AT TIME ZONE 'Asia/Damascus')::date, 'YYYY-MM-DD') AS "lastPaymentDate",
             last_payment.amount_syp::numeric AS "lastPaymentAmount",
             last_payment.payment_method AS "lastPaymentMethod",
             COALESCE(NULLIF(BTRIM(collection_owner.name), ''), 'غير مسند') AS "collectionOwnerName",
             COALESCE(NULLIF(BTRIM(seller.name), ''), 'غير محدد') AS "sellerName",
             COALESCE(NULLIF(BTRIM(closer.name), ''), 'غير محدد') AS "saleCloserName",
             TO_CHAR((last_contact.call_date AT TIME ZONE 'Asia/Damascus')::date, 'YYYY-MM-DD') AS "lastContactDate",
             last_contact.employee_name AS "lastContactEmployeeName",
             last_contact.notes AS "contactNotes",
             TO_CHAR(next_appointment.scheduled_date, 'YYYY-MM-DD') AS "nextCollectionAppointment",
             ${COLLECTION_RESULT_LABEL_SQL} AS "latestCollectionResult",
             latest_result.paid_amount_syp::numeric AS "latestCollectedAmount",
             latest_result.technician_name AS "latestVisitTechnicianName",
             latest_result.result_notes AS "latestResultNotes",
             NULLIF(BTRIM(latest_task.notes), '') AS "collectionTaskNotes"
             ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
        FROM contract_installments installment
        JOIN contracts contract ON contract.id = installment.contract_id
        LEFT JOIN clients client ON client.id = contract.customer_id
        LEFT JOIN branches branch ON branch.id = ${BRANCH_SQL}
        LEFT JOIN hr_users collection_owner ON collection_owner.id = installment.collection_owner_id
        LEFT JOIN employees seller ON seller.id = contract.sale_owner_id
        LEFT JOIN hr_users closer ON closer.id = contract.closing_employee_id
        LEFT JOIN LATERAL (
          SELECT GREATEST(installment.amount_syp - COALESCE(SUM(
                   CASE WHEN entry.entry_type = 'refund' THEN -entry.amount_syp ELSE entry.amount_syp END
                 ) FILTER (WHERE entry.received_at < ${cutoffEnd}), 0), 0) AS remaining_balance
            FROM contract_payment_entries entry
           WHERE entry.installment_id = installment.id
        ) historical_installment ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(movement.amount_syp) FILTER (WHERE movement.kind = 'payment'), 0) AS collected_total,
                 COALESCE(SUM(movement.amount_syp) FILTER (WHERE movement.kind = 'refund'), 0) AS refund_total,
                 COALESCE(SUM(movement.amount_syp) FILTER (WHERE movement.kind = 'discount'), 0) AS discount_total
            FROM financial_movements movement
           WHERE movement.contract_id = contract.id
             AND ${CONTRACT_MONEY_SOURCES_SQL}
             AND movement.occurred_at < (installment.due_date::timestamp AT TIME ZONE 'Asia/Damascus')
        ) contract_money_before_due ON TRUE
        LEFT JOIN LATERAL (
          SELECT entry.received_at, entry.amount_syp, ${PAYMENT_METHOD_LABEL_SQL} AS payment_method
            FROM contract_payment_entries entry
           WHERE entry.contract_id = contract.id
             AND entry.entry_type = 'collection'
             AND entry.received_at < (installment.due_date::timestamp AT TIME ZONE 'Asia/Damascus')
           ORDER BY entry.received_at DESC, entry.id DESC
           LIMIT 1
        ) last_payment ON TRUE
        LEFT JOIN LATERAL (
          SELECT task.id, task.status, task.due_date, task.notes,
                 task.receivable_source_type, task.receivable_source_id, task.receivable_source_label
            FROM open_tasks task
           WHERE task.task_type = 'installment_collection'
             AND task.installment_id = installment.id
             AND task.created_at < ${cutoffEnd}
           ORDER BY task.created_at DESC, task.id DESC
           LIMIT 1
        ) latest_task ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE latest_task.receivable_source_type
            WHEN 'maintenance_task' THEN maintenance_result.completed_date
            WHEN 'golden_warranty' THEN warranty_event.event_date
            ELSE device.installation_date
          END AS event_date
          FROM (SELECT 1) seed
          LEFT JOIN LATERAL (
            SELECT installed.installation_date
              FROM installed_devices installed
             WHERE installed.contract_id = contract.id
             ORDER BY installed.installation_date DESC NULLS LAST, installed.id DESC
             LIMIT 1
          ) device ON TRUE
          LEFT JOIN LATERAL (
            SELECT (result.closed_at AT TIME ZONE 'Asia/Damascus')::date AS completed_date
              FROM visit_tasks visit_task
              JOIN visit_task_results result ON result.visit_task_id = visit_task.id
             WHERE visit_task.source_open_task_id = latest_task.receivable_source_id
               AND result.closed_at < ${cutoffEnd}
             ORDER BY result.closed_at DESC, visit_task.id DESC
             LIMIT 1
          ) maintenance_result ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(warranty.start_date, warranty.activated_at::date) AS event_date
              FROM device_warranties warranty
             WHERE warranty.id = latest_task.receivable_source_id
             LIMIT 1
          ) warranty_event ON TRUE
        ) source_event ON TRUE
        LEFT JOIN LATERAL (
          WITH RECURSIVE ancestors AS (
            SELECT unit.id, unit.name, unit.level, unit.parent_id
              FROM geo_units unit
             WHERE unit.id = COALESCE(client.neighborhood, client.district, client.governorate)
            UNION ALL
            SELECT parent.id, parent.name, parent.level, parent.parent_id
              FROM geo_units parent JOIN ancestors child ON child.parent_id = parent.id
          )
          SELECT MAX(name) FILTER (WHERE level = 1) AS governorate_name,
                 MAX(name) FILTER (WHERE level = 2) AS region_name,
                 MAX(name) FILTER (WHERE level = 3) AS subarea_name,
                 MAX(name) FILTER (WHERE level = 4) AS neighborhood_name,
                 COALESCE(ARRAY_AGG(id), ARRAY[]::int[]) AS unit_ids
            FROM ancestors
        ) geo ON TRUE
        LEFT JOIN LATERAL (
          SELECT result.final_decision,
                 side.paid_amount_syp,
                 COALESCE(NULLIF(BTRIM(side.notes), ''), NULLIF(BTRIM(result.closing_notes), '')) AS result_notes,
                 NULLIF(BTRIM(technician.name), '') AS technician_name
            FROM open_tasks task
            JOIN visit_tasks visit_task ON visit_task.source_open_task_id = task.id
            JOIN field_visits visit ON visit.id = visit_task.field_visit_id
            JOIN visit_task_results result ON result.visit_task_id = visit_task.id
            LEFT JOIN visit_task_installment_collection_results side ON side.visit_task_result_id = result.id
            LEFT JOIN employees technician ON technician.id = COALESCE(
              visit.reassigned_technician_id,
              NULLIF(visit.team_snapshot->>'technicianEmployeeId', '')::int
            )
           WHERE task.task_type = 'installment_collection'
             AND task.installment_id = installment.id
             AND result.closed_at < ${cutoffEnd}
           ORDER BY result.closed_at DESC, visit_task.id DESC
           LIMIT 1
        ) latest_result ON TRUE
        LEFT JOIN LATERAL (
          SELECT call.call_date,
                 NULLIF(BTRIM(employee.name), '') AS employee_name,
                 NULLIF(BTRIM(call.notes), '') AS notes
            FROM open_tasks task
            JOIN call_task_links link ON link.task_id = task.id
            JOIN customer_call_logs call ON call.id = link.call_id
            LEFT JOIN hr_users employee ON employee.id = call.caller_id
           WHERE task.task_type = 'installment_collection'
             AND task.installment_id = installment.id
             AND call.call_date < ${cutoffEnd}
           ORDER BY call.call_date DESC, call.id DESC
           LIMIT 1
        ) last_contact ON TRUE
        LEFT JOIN LATERAL (
          SELECT visit.scheduled_date
            FROM open_tasks task
            JOIN visit_tasks visit_task ON visit_task.source_open_task_id = task.id
            JOIN field_visits visit ON visit.id = visit_task.field_visit_id
           WHERE task.task_type = 'installment_collection'
             AND task.installment_id = installment.id
             AND visit.created_at < ${cutoffEnd}
             AND visit.scheduled_date >= $${cutoffIndex}::date
             AND visit.status <> 'cancelled'
           ORDER BY visit.scheduled_date ASC, visit.scheduled_time ASC NULLS LAST, visit.id ASC
           LIMIT 1
        ) next_appointment ON TRUE
       WHERE ${filters.join('\n         AND ')}
       ORDER BY ${buildTabularReportOrderBy('service.dues', access, request, 'installment.due_date ASC, installment.id ASC')}
       LIMIT ${limitRef}${offsetSql}`,
  };
}

export async function getServiceDuesFilterOptions(
  access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const params: unknown[] = [];
  const filters = [
    `installment.confirmed IS TRUE`,
    `installment.remaining_balance > 0`,
    `contract.status IN ('active', 'completed')`,
    `contract.sale_subtype = 'definitive'`,
  ];
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`${BRANCH_SQL} = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`installment.collection_owner_id = $${params.length}`);
  }

  const { rows } = await pool.query(`
    WITH scoped AS (
      SELECT DISTINCT installment.collection_owner_id, contract.sale_owner_id, contract.closing_employee_id
        FROM contract_installments installment
        JOIN contracts contract ON contract.id = installment.contract_id
       WHERE ${filters.join('\n         AND ')}
    )
    SELECT
      COALESCE((
        SELECT JSON_AGG(JSON_BUILD_OBJECT('value', employee.id::text, 'label', employee.name) ORDER BY employee.name, employee.id)
          FROM hr_users employee
         WHERE employee.id IN (SELECT collection_owner_id FROM scoped WHERE collection_owner_id IS NOT NULL)
      ), '[]'::json) AS "collectionOwners",
      COALESCE((
        SELECT JSON_AGG(JSON_BUILD_OBJECT('value', employee.id::text, 'label', employee.name) ORDER BY employee.name, employee.id)
          FROM employees employee
         WHERE employee.id IN (SELECT sale_owner_id FROM scoped WHERE sale_owner_id IS NOT NULL)
      ), '[]'::json) AS "contractSellers",
      COALESCE((
        SELECT JSON_AGG(JSON_BUILD_OBJECT('value', user_row.id::text, 'label', user_row.name) ORDER BY user_row.name, user_row.id)
          FROM hr_users user_row
         WHERE user_row.id IN (SELECT closing_employee_id FROM scoped WHERE closing_employee_id IS NOT NULL)
      ), '[]'::json) AS "saleClosers"
  `, params);
  return rows[0] ?? {};
}
