import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface SalesByTypeRow {
  branchId: number;
  branchName: string;
  tradeInSales: number;
  retentionSales: number;
  marketingOffers: number;
  marketingSales: number;
  marketingCloseRate: string | null;
  instantOffers: number;
  instantSales: number;
  instantCloseRate: string | null;
  socialMediaSales: number;
  totalOffers: number;
  totalOfferSales: number;
  overallCloseRate: string | null;
  selectedDevicesTotal?: number;
}

/**
 * The row grain is the branch, so a counted contract is one that is a sale today:
 * a draft is not a sale yet and a cancelled contract is a sale that ended. The same
 * rule decides whether an offer counts as converted, so the offer columns and the
 * contract columns never disagree about what a sale is.
 */
const COUNTED_CONTRACT_STATUSES_SQL = `('active', 'completed')`;

/** `contracts.contract_date` is VARCHAR, so it is read behind a shape guard. */
const CONTRACT_DATE_SHAPE_SQL = `contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`;

/** The device model is read from the created device first, then from the contract. */
const DEVICE_MODEL_ID_SQL = `COALESCE(device.device_model_id, contract.device_model_id)`;

/** The managed list value stored on contracts for the social-media channel. */
const SOCIAL_MEDIA_SOURCE = 'تواصل اجتماعي ( فيس و انستا )';

const SALE_SUBTYPES = new Set(['definitive', 'temporary', 'free']);

/**
 * An offer counts as converted when a real contract stands behind it, not when the
 * `is_device_sold` flag is raised: in development 10 of 13 offers carry the flag but
 * only 3 carry a sale reference that matches a contract (DEC-D). Both link paths are
 * honoured — the direct `contract_id` column and the sale reference — so the report
 * does not break when the currently unused column starts being filled. The contract's
 * own date is deliberately not constrained: an offer whose contract was signed after
 * the period is a successful offer, not a failed one.
 */
const OFFER_IS_CONVERTED_SQL = `EXISTS (
            SELECT 1 FROM contracts offer_contract
             WHERE offer_contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
               AND (
                 offer_contract.id = demo.contract_id
                 OR (
                   NULLIF(BTRIM(demo.sale_reference_number), '') IS NOT NULL
                   AND offer_contract.sale_reference_number = demo.sale_reference_number
                 )
               )
          )`;

function dateFilter(value: unknown, label: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

/** Selected device models arrive as a comma separated list of ids and stay ids. */
export function parseDeviceModelIds(request: TabularReportRequestParams): number[] {
  const raw = String(request.deviceModelIds ?? '').trim();
  if (!raw) return [];
  const parsed = raw.split(',').map(value => value.trim()).filter(value => value !== '')
    .map(value => {
      const id = positiveInt(value);
      if (id == null) throw new ReportingError(400, 'أحد الأجهزة المختارة غير صالح');
      return id;
    });
  return Array.from(new Set(parsed));
}

export function buildSalesByTypeQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];

  const branchFilters: string[] = [];
  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    branchFilters.push(`branch.id = ANY($${params.length}::int[])`);
  }

  const fromDate = dateFilter(request.fromDate, 'بداية المدة');
  const toDate = dateFilter(request.toDate, 'نهاية المدة');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدة التقرير مطلوبة لتوليده');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية المدة يجب ألا تكون بعد نهايتها');
  params.push(fromDate);
  const fromRef = `$${params.length}`;
  params.push(toDate);
  const toRef = `$${params.length}`;

  params.push(SOCIAL_MEDIA_SOURCE);
  const socialSourceRef = `$${params.length}`;

  const saleSubtype = typeof request.saleSubtype === 'string' && request.saleSubtype.trim()
    ? request.saleSubtype.trim() : null;
  let subtypeSql = '';
  if (saleSubtype != null) {
    if (!SALE_SUBTYPES.has(saleSubtype)) throw new ReportingError(400, 'صفة البيعة غير صالحة');
    params.push(saleSubtype);
    subtypeSql = `
           AND contract.sale_subtype = $${params.length}`;
  }

  // One column per selected model plus their total. The column key carries the model
  // id, never its name, so renaming a model keeps its column identity in old runs.
  const deviceModelIds = parseDeviceModelIds(request);
  let selectedInLateralSql = '';
  let selectedInSelectSql = '';
  if (deviceModelIds.length > 0) {
    params.push(deviceModelIds);
    const idsRef = `$${params.length}::int[]`;
    selectedInLateralSql = deviceModelIds.map(id => `,
               COUNT(*) FILTER (WHERE ${DEVICE_MODEL_ID_SQL} = ${id})::int AS "deviceModel_${id}"`).join('')
      + `,
               COUNT(*) FILTER (WHERE ${DEVICE_MODEL_ID_SQL} = ANY(${idsRef}))::int AS "selectedDevicesTotal"`;
    selectedInSelectSql = deviceModelIds
      .map(id => `,
           COALESCE(contracts."deviceModel_${id}", 0) AS "deviceModel_${id}"`).join('')
      + `,
           COALESCE(contracts."selectedDevicesTotal", 0) AS "selectedDevicesTotal"`;
  }

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  // A closed branch stays out of the listing unless it actually traded inside the
  // period: hiding it unconditionally would read as «no such branch», and listing
  // every closed branch would bury the active ones under permanent zero rows.
  branchFilters.push(`(
       branch.status = 'active'
       OR COALESCE(contracts.trade_in_sales, 0) + COALESCE(contracts.retention_sales, 0)
        + COALESCE(contracts.social_media_sales, 0) + COALESCE(offers.total_offers, 0) > 0
     )`);

  // Each population is collapsed in its own lateral: contracts and offers have
  // different grains, and joining them directly would multiply one by the other.
  const sql = `
    SELECT branch.id AS "branchId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           COALESCE(contracts.trade_in_sales, 0) AS "tradeInSales",
           COALESCE(contracts.retention_sales, 0) AS "retentionSales",
           COALESCE(offers.marketing_offers, 0) AS "marketingOffers",
           COALESCE(offers.marketing_sales, 0) AS "marketingSales",
           CASE WHEN COALESCE(offers.marketing_offers, 0) > 0
                THEN ROUND(offers.marketing_sales * 100.0 / offers.marketing_offers, 1) END AS "marketingCloseRate",
           COALESCE(offers.instant_offers, 0) AS "instantOffers",
           COALESCE(offers.instant_sales, 0) AS "instantSales",
           CASE WHEN COALESCE(offers.instant_offers, 0) > 0
                THEN ROUND(offers.instant_sales * 100.0 / offers.instant_offers, 1) END AS "instantCloseRate",
           COALESCE(contracts.social_media_sales, 0) AS "socialMediaSales",
           COALESCE(offers.total_offers, 0) AS "totalOffers",
           COALESCE(offers.total_offer_sales, 0) AS "totalOfferSales",
           CASE WHEN COALESCE(offers.total_offers, 0) > 0
                THEN ROUND(offers.total_offer_sales * 100.0 / offers.total_offers, 1) END AS "overallCloseRate"${selectedInSelectSql}
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM branches branch
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE contract.sale_type = 'tradein')::int AS trade_in_sales,
               COUNT(*) FILTER (WHERE contract.sale_type = 'retention')::int AS retention_sales,
               COUNT(*) FILTER (WHERE BTRIM(contract.sale_source) = ${socialSourceRef})::int AS social_media_sales${selectedInLateralSql}
          FROM contracts contract
          LEFT JOIN installed_devices device ON device.contract_id = contract.id
         WHERE contract.branch_id = branch.id
           AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
           AND ${CONTRACT_DATE_SHAPE_SQL}
           AND contract.contract_date >= ${fromRef}
           AND contract.contract_date <= ${toRef}${subtypeSql}
      ) contracts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE visit.origin_type = 'telemarketing')::int AS marketing_offers,
               COUNT(*) FILTER (WHERE visit.origin_type = 'telemarketing' AND converted.is_converted)::int AS marketing_sales,
               COUNT(*) FILTER (WHERE visit.origin_type = 'field_initiated')::int AS instant_offers,
               COUNT(*) FILTER (WHERE visit.origin_type = 'field_initiated' AND converted.is_converted)::int AS instant_sales,
               COUNT(*)::int AS total_offers,
               COUNT(*) FILTER (WHERE converted.is_converted)::int AS total_offer_sales
          FROM visit_task_device_demo_results demo
          JOIN visit_task_results result ON result.id = demo.visit_task_result_id
          JOIN visit_tasks task ON task.id = result.visit_task_id
          JOIN field_visits visit ON visit.id = task.field_visit_id
          CROSS JOIN LATERAL (SELECT ${OFFER_IS_CONVERTED_SQL} AS is_converted) converted
         WHERE visit.branch_id = branch.id
           AND result.closed_at IS NOT NULL
           AND (result.closed_at AT TIME ZONE 'Asia/Damascus')::date >= ${fromRef}::date
           AND (result.closed_at AT TIME ZONE 'Asia/Damascus')::date <= ${toRef}::date
      ) offers ON TRUE
     WHERE ${branchFilters.join(' AND ')}
     ORDER BY ${buildTabularReportOrderBy(
       'performance.sales_by_type', access, request,
       `COALESCE(contracts.trade_in_sales, 0) + COALESCE(contracts.retention_sales, 0)
              + COALESCE(offers.total_offer_sales, 0) DESC, branch.id ASC`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getSalesByTypeReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildSalesByTypeQuery(access, request, options);
  const { rows } = await pool.query<SalesByTypeRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * The per-run columns of this report: one per selected device model, then their total.
 * Labels are read from `device_models` on the server, never taken from text sent by the
 * browser, and the column key carries the model id so an old run keeps its identity
 * after a model is renamed. A selected id that no longer exists is rejected rather than
 * rendered as an untitled column.
 */
export async function getSalesByTypeDynamicColumns(
  request: TabularReportRequestParams,
): Promise<Array<{ key: string; titleAr: string; type: 'integer'; width: number; sortable: boolean }>> {
  const ids = parseDeviceModelIds(request);
  if (ids.length === 0) return [];
  const { rows } = await pool.query<{ id: number; label: string }>(`
    SELECT model.id,
           COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''),
                    NULLIF(BTRIM(model.name), ''), 'جهاز #' || model.id::text) AS label
      FROM device_models model
     WHERE model.id = ANY($1::int[])
  `, [ids]);
  const labels = new Map(rows.map(row => [Number(row.id), String(row.label)]));
  const missing = ids.filter(id => !labels.has(id));
  if (missing.length > 0) throw new ReportingError(400, 'أحد الأجهزة المختارة غير موجود');
  return [
    ...ids.map(id => ({
      key: `deviceModel_${id}`, titleAr: `بيعات ${labels.get(id)}`,
      type: 'integer' as const, width: 20, sortable: true,
    })),
    {
      key: 'selectedDevicesTotal', titleAr: 'إجمالي الأجهزة المختارة',
      type: 'integer' as const, width: 22, sortable: true,
    },
  ];
}

/**
 * The whole device catalogue is offered, not only the models that already sold: a
 * selected model with no sales is a real answer («we sold none of these»), and the
 * counts themselves stay bound to the caller's branch scope by the query. A retired
 * model is still listed — it may carry sales in a past period — but its label says so,
 * so nobody reads a discontinued device as a current one. A deleted model is not a
 * device any more and is left out.
 */
export async function getSalesByTypeFilterOptions(
  _access: TabularReportAccess,
): Promise<Partial<TabularReportFilterOptions>> {
  const { rows } = await pool.query(`
    SELECT model.id::text AS value,
           COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''),
                    NULLIF(BTRIM(model.name), ''), 'جهاز #' || model.id::text)
             || CASE WHEN model.is_active THEN '' ELSE ' (غير نشط)' END AS label
      FROM device_models model
     WHERE model.deleted_at IS NULL
     ORDER BY model.is_active DESC, label
  `);
  return {
    deviceModels: rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
