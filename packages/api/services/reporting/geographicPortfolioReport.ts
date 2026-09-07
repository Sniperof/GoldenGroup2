import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';

const CHALLENGER_MODEL_ID = 1195;
const AQUANOVA_MODEL_ID = 2462;
const SAFE_LIFE_MODEL_ID = 1300;

interface QueryOptions {
  offset?: number;
  limit: number;
  includeTotalRows?: boolean;
}

export interface GeographicPortfolioRow {
  branchId: number | null;
  branchName: string;
  governorateName: string;
  regionName: string;
  subareaName: string;
  totalCustomers: number;
  fopCustomers: number;
  leadCustomers: number;
  suggestedCustomers: number;
  opCustomers: number;
  challengerDevices: number;
  aquanovaDevices: number;
  safeLifeDevices: number;
  otherDevices: number;
  periodicDueTodayDevices: number;
  overduePeriodicDevices: number;
  areaEvaluation: string;
  evaluationConfidence: string;
  evaluationCount: number;
  latestEvaluationDate: string | null;
}

function parseGeoIds(request: TabularReportRequestParams): number[] {
  return Array.from(new Set(
    String(request.geoIds ?? request.geoUnitId ?? '')
      .split(',')
      .map(value => positiveInt(value))
      .filter((value): value is number => value != null),
  ));
}

function locationProjection(alias: string): string {
  return `
    COALESCE(
      CASE WHEN ${alias}0.level = 1 THEN ${alias}0.id END,
      CASE WHEN ${alias}1.level = 1 THEN ${alias}1.id END,
      CASE WHEN ${alias}2.level = 1 THEN ${alias}2.id END,
      CASE WHEN ${alias}3.level = 1 THEN ${alias}3.id END
    ) AS governorate_id,
    COALESCE(
      CASE WHEN ${alias}0.level = 2 THEN ${alias}0.id END,
      CASE WHEN ${alias}1.level = 2 THEN ${alias}1.id END,
      CASE WHEN ${alias}2.level = 2 THEN ${alias}2.id END,
      CASE WHEN ${alias}3.level = 2 THEN ${alias}3.id END
    ) AS region_id,
    COALESCE(
      CASE WHEN ${alias}0.level = 3 THEN ${alias}0.id END,
      CASE WHEN ${alias}1.level = 3 THEN ${alias}1.id END,
      CASE WHEN ${alias}2.level = 3 THEN ${alias}2.id END,
      CASE WHEN ${alias}3.level = 3 THEN ${alias}3.id END
    ) AS subarea_id
  `;
}

function locationJoins(sourceExpression: string, alias: string): string {
  return `
    LEFT JOIN geo_units ${alias}0 ON ${alias}0.id = ${sourceExpression}
    LEFT JOIN geo_units ${alias}1 ON ${alias}1.id = ${alias}0.parent_id
    LEFT JOIN geo_units ${alias}2 ON ${alias}2.id = ${alias}1.parent_id
    LEFT JOIN geo_units ${alias}3 ON ${alias}3.id = ${alias}2.parent_id
  `;
}

export function buildGeographicPortfolioQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const clientFilters = ['client.deleted_at IS NULL'];
  const deviceFilters: string[] = [];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    const branchRef = `$${params.length}::int[]`;
    clientFilters.push(`client.branch_id = ANY(${branchRef})`);
    deviceFilters.push(`device.branch_id = ANY(${branchRef})`);
  }

  const geoIds = parseGeoIds(request);
  if (geoIds.length > 0) {
    params.push(geoIds);
    const geoRef = `$${params.length}::int[]`;
    clientFilters.push(`COALESCE(client.neighborhood, client.district, client.governorate) = ANY(${geoRef})`);
    deviceFilters.push(`device.installation_geo_unit_id = ANY(${geoRef})`);
  }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    WITH client_base AS MATERIALIZED (
      SELECT client.id,
             client.branch_id,
             client.candidate_status,
             COALESCE(client.neighborhood, client.district, client.governorate) AS geo_unit_id
        FROM clients client
       WHERE ${clientFilters.join(' AND ')}
    ),
    client_located AS MATERIALIZED (
      SELECT base.id,
             base.branch_id,
             base.candidate_status,
             ${locationProjection('cg')}
        FROM client_base base
        ${locationJoins('base.geo_unit_id', 'cg')}
    ),
    client_aggregate AS (
      SELECT branch_id, governorate_id, region_id, subarea_id,
             COUNT(*)::int AS total_customers,
             COUNT(*) FILTER (WHERE candidate_status = 'FOP')::int AS fop_customers,
             COUNT(*) FILTER (WHERE candidate_status IS NULL)::int AS lead_customers,
             COUNT(*) FILTER (WHERE candidate_status = 'Suggested')::int AS suggested_customers,
             COUNT(*) FILTER (WHERE candidate_status = 'OP')::int AS op_customers
        FROM client_located
       GROUP BY branch_id, governorate_id, region_id, subarea_id
    ),
    periodic_state AS (
      SELECT task.device_id,
             BOOL_OR(task.due_date = CURRENT_DATE) AS due_today,
             BOOL_OR(task.due_date < CURRENT_DATE) AS overdue
        FROM open_tasks task
       WHERE task.task_type = 'periodic_maintenance'
         AND task.status NOT IN ('completed', 'closed', 'cancelled')
         AND task.device_id IS NOT NULL
       GROUP BY task.device_id
    ),
    device_located AS MATERIALIZED (
      SELECT device.id,
             device.branch_id,
             device.device_model_id,
             COALESCE(periodic.due_today, FALSE) AS periodic_due_today,
             COALESCE(periodic.overdue, FALSE) AS periodic_overdue,
             ${locationProjection('dg')}
        FROM installed_devices device
        LEFT JOIN periodic_state periodic ON periodic.device_id = device.id
        ${locationJoins('device.installation_geo_unit_id', 'dg')}
       ${deviceFilters.length > 0 ? `WHERE ${deviceFilters.join(' AND ')}` : ''}
    ),
    device_aggregate AS (
      SELECT branch_id, governorate_id, region_id, subarea_id,
             COUNT(*) FILTER (WHERE device_model_id = ${CHALLENGER_MODEL_ID})::int AS challenger_devices,
             COUNT(*) FILTER (WHERE device_model_id = ${AQUANOVA_MODEL_ID})::int AS aquanova_devices,
             COUNT(*) FILTER (WHERE device_model_id = ${SAFE_LIFE_MODEL_ID})::int AS safe_life_devices,
             COUNT(*) FILTER (
               WHERE device_model_id IS NULL
                  OR device_model_id NOT IN (${CHALLENGER_MODEL_ID}, ${AQUANOVA_MODEL_ID}, ${SAFE_LIFE_MODEL_ID})
             )::int AS other_devices,
             COUNT(*) FILTER (WHERE periodic_due_today)::int AS periodic_due_today_devices,
             COUNT(*) FILTER (WHERE periodic_overdue)::int AS overdue_periodic_devices
        FROM device_located
       GROUP BY branch_id, governorate_id, region_id, subarea_id
    ),
    survey_ratings AS (
      SELECT located.branch_id,
             located.governorate_id,
             located.region_id,
             located.subarea_id,
             survey.id,
             survey.filled_at,
             CASE survey.area_evaluation
               WHEN 'ضعيفة' THEN 1
               WHEN 'متوسطة' THEN 2
               WHEN 'جيدة' THEN 3
               WHEN 'ممتازة' THEN 4
             END AS score,
             CASE
               WHEN survey.filled_at >= NOW() - INTERVAL '90 days' THEN 1.00
               WHEN survey.filled_at >= NOW() - INTERVAL '180 days' THEN 0.75
               ELSE 0.50
             END::numeric AS recency_weight
        FROM visit_surveys survey
        JOIN field_visits visit ON visit.id = survey.field_visit_id
        JOIN client_located located ON located.id = visit.client_id
       WHERE survey.is_skipped = FALSE
         AND survey.area_evaluation IS NOT NULL
         AND survey.filled_at >= NOW() - INTERVAL '365 days'
         AND visit.status IN ('completed', 'closed')
    ),
    survey_aggregate AS (
      SELECT branch_id, governorate_id, region_id, subarea_id,
             COUNT(*) FILTER (WHERE score IS NOT NULL)::int AS evaluation_count,
             COUNT(*) FILTER (
               WHERE score IS NOT NULL AND filled_at >= NOW() - INTERVAL '180 days'
             )::int AS recent_evaluation_count,
             MAX(filled_at) FILTER (WHERE score IS NOT NULL) AS latest_evaluation_at,
             COALESCE(SUM(recency_weight) FILTER (WHERE score IS NOT NULL), 0) AS total_weight,
             COALESCE(SUM(recency_weight) FILTER (WHERE score = 1), 0) AS weak_weight,
             COALESCE(SUM(recency_weight) FILTER (WHERE score = 2), 0) AS medium_weight,
             COALESCE(SUM(recency_weight) FILTER (WHERE score = 3), 0) AS good_weight
        FROM survey_ratings
       GROUP BY branch_id, governorate_id, region_id, subarea_id
    ),
    report_keys AS (
      SELECT branch_id, governorate_id, region_id, subarea_id FROM client_aggregate
      UNION
      SELECT branch_id, governorate_id, region_id, subarea_id FROM device_aggregate
      UNION
      SELECT branch_id, governorate_id, region_id, subarea_id FROM survey_aggregate
    )
    SELECT keys.branch_id AS "branchId",
           COALESCE(branch.name, 'غير محدد') AS "branchName",
           COALESCE(governorate.name, 'غير محدد') AS "governorateName",
           COALESCE(region.name, 'غير محدد') AS "regionName",
           COALESCE(subarea.name, 'غير محدد') AS "subareaName",
           COALESCE(customers.total_customers, 0)::int AS "totalCustomers",
           COALESCE(customers.fop_customers, 0)::int AS "fopCustomers",
           COALESCE(customers.lead_customers, 0)::int AS "leadCustomers",
           COALESCE(customers.suggested_customers, 0)::int AS "suggestedCustomers",
           COALESCE(customers.op_customers, 0)::int AS "opCustomers",
           COALESCE(devices.challenger_devices, 0)::int AS "challengerDevices",
           COALESCE(devices.aquanova_devices, 0)::int AS "aquanovaDevices",
           COALESCE(devices.safe_life_devices, 0)::int AS "safeLifeDevices",
           COALESCE(devices.other_devices, 0)::int AS "otherDevices",
           COALESCE(devices.periodic_due_today_devices, 0)::int AS "periodicDueTodayDevices",
           COALESCE(devices.overdue_periodic_devices, 0)::int AS "overduePeriodicDevices",
           CASE
             WHEN COALESCE(evaluation.evaluation_count, 0) = 0 THEN 'لا توجد بيانات كافية'
             WHEN evaluation.weak_weight >= evaluation.total_weight / 2 THEN 'ضعيفة'
             WHEN evaluation.weak_weight + evaluation.medium_weight >= evaluation.total_weight / 2 THEN 'متوسطة'
             WHEN evaluation.weak_weight + evaluation.medium_weight + evaluation.good_weight >= evaluation.total_weight / 2 THEN 'جيدة'
             ELSE 'ممتازة'
           END AS "areaEvaluation",
           CASE
             WHEN COALESCE(evaluation.evaluation_count, 0) = 0 THEN 'غير متاحة'
             WHEN evaluation.evaluation_count >= 10
              AND evaluation.recent_evaluation_count >= 5
              AND evaluation.latest_evaluation_at >= NOW() - INTERVAL '90 days' THEN 'مرتفعة'
             WHEN evaluation.evaluation_count >= 5
              AND evaluation.latest_evaluation_at >= NOW() - INTERVAL '180 days' THEN 'متوسطة'
             ELSE 'منخفضة'
           END AS "evaluationConfidence",
           COALESCE(evaluation.evaluation_count, 0)::int AS "evaluationCount",
           TO_CHAR(evaluation.latest_evaluation_at::date, 'YYYY-MM-DD') AS "latestEvaluationDate"
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM report_keys keys
      LEFT JOIN branches branch ON branch.id = keys.branch_id
      LEFT JOIN geo_units governorate ON governorate.id = keys.governorate_id
      LEFT JOIN geo_units region ON region.id = keys.region_id
      LEFT JOIN geo_units subarea ON subarea.id = keys.subarea_id
      LEFT JOIN client_aggregate customers
        ON customers.branch_id IS NOT DISTINCT FROM keys.branch_id
       AND customers.governorate_id IS NOT DISTINCT FROM keys.governorate_id
       AND customers.region_id IS NOT DISTINCT FROM keys.region_id
       AND customers.subarea_id IS NOT DISTINCT FROM keys.subarea_id
      LEFT JOIN device_aggregate devices
        ON devices.branch_id IS NOT DISTINCT FROM keys.branch_id
       AND devices.governorate_id IS NOT DISTINCT FROM keys.governorate_id
       AND devices.region_id IS NOT DISTINCT FROM keys.region_id
       AND devices.subarea_id IS NOT DISTINCT FROM keys.subarea_id
      LEFT JOIN survey_aggregate evaluation
        ON evaluation.branch_id IS NOT DISTINCT FROM keys.branch_id
       AND evaluation.governorate_id IS NOT DISTINCT FROM keys.governorate_id
       AND evaluation.region_id IS NOT DISTINCT FROM keys.region_id
       AND evaluation.subarea_id IS NOT DISTINCT FROM keys.subarea_id
     ORDER BY ${buildTabularReportOrderBy(
       'performance.geographic_portfolio', access, request,
       `COALESCE(branch.name, 'غير محدد'), COALESCE(governorate.name, 'غير محدد'),
        COALESCE(region.name, 'غير محدد'), COALESCE(subarea.name, 'غير محدد'),
        keys.branch_id NULLS LAST, keys.governorate_id NULLS LAST,
        keys.region_id NULLS LAST, keys.subarea_id NULLS LAST`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;

  return { sql, params };
}

export async function getGeographicPortfolioReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): Promise<{ rows: GeographicPortfolioRow[]; total: number }> {
  const query = buildGeographicPortfolioQuery(access, request, options);
  const { rows } = await pool.query(query.sql, query.params);
  const total = rows.length > 0 ? Number(rows[0].totalRows) : 0;
  return {
    rows: rows.map(row => ({
      branchId: row.branchId == null ? null : Number(row.branchId),
      branchName: String(row.branchName),
      governorateName: String(row.governorateName),
      regionName: String(row.regionName),
      subareaName: String(row.subareaName),
      totalCustomers: Number(row.totalCustomers),
      fopCustomers: Number(row.fopCustomers),
      leadCustomers: Number(row.leadCustomers),
      suggestedCustomers: Number(row.suggestedCustomers),
      opCustomers: Number(row.opCustomers),
      challengerDevices: Number(row.challengerDevices),
      aquanovaDevices: Number(row.aquanovaDevices),
      safeLifeDevices: Number(row.safeLifeDevices),
      otherDevices: Number(row.otherDevices),
      periodicDueTodayDevices: Number(row.periodicDueTodayDevices),
      overduePeriodicDevices: Number(row.overduePeriodicDevices),
      areaEvaluation: String(row.areaEvaluation),
      evaluationConfidence: String(row.evaluationConfidence),
      evaluationCount: Number(row.evaluationCount),
      latestEvaluationDate: row.latestEvaluationDate == null ? null : String(row.latestEvaluationDate),
    })),
    total,
  };
}
