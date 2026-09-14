import pool from '../../db.js';
import type { TabularReportAccess, TabularReportRequestParams } from './tabularReportAccess.js';
import { positiveInt } from './tabularReportAccess.js';
import { buildTabularReportOrderBy } from './tabularReportSorting.js';
import { ReportingError } from './reportingError.js';
import type { TabularReportColumn } from './tabularReportCatalog.js';
import type { TabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { parseDeviceModelIds } from './salesByTypeReport.js';
import { employeeDimensionConditions, getEmployeeDimensionOptions } from './reportEmployeeDimension.js';

interface QueryOptions { offset?: number; limit: number; includeTotalRows?: boolean }

export interface SalesCountRow {
  branchId: number;
  sellerId: number | null;
  branchName: string;
  sellerName: string;
  jobTitle: string | null;
  departmentName: string | null;
  totalSales: number;
  salesPoints: string;
}

/**
 * The device picker is what the report is about (DEC-I), so at least one model is
 * required and the count is capped. The cap is declared in the report guide rather
 * than silently truncating: the catalogue holds 58 models, and selecting them all
 * would emit 58 filtered aggregates and 58 Excel columns (§9.7.5).
 */
export const SALES_COUNT_MIN_DEVICE_MODELS = 1;
export const SALES_COUNT_MAX_DEVICE_MODELS = 10;

/**
 * Which job titles the seller picker offers (DEC-K). Stored on the department type's
 * metadata beside `sellerJobTitles`, but under its own key on purpose: the other key
 * feeds the «عدد البائع» headcount column of the department-results report, and adding
 * technicians there would make branches look like they hired sellers overnight.
 */
export const SALE_OWNER_JOB_TITLES_KEY = 'saleOwnerJobTitles';

/** A sale is what counts as a sale today, consistently across every report. */
const COUNTED_CONTRACT_STATUSES_SQL = `('active', 'completed')`;

/** `contracts.contract_date` is VARCHAR, so it is read behind a shape guard. */
const CONTRACT_DATE_SHAPE_SQL = `contract.contract_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`;

/**
 * One device per contract by construction: the installed device is reduced to a single
 * row before it reaches the grain, so a second device on the same contract could never
 * duplicate the sale (§9.4.2).
 */
const CONTRACT_DEVICE_SQL = `LEFT JOIN LATERAL (
        SELECT installed.device_model_id
          FROM installed_devices installed
         WHERE installed.contract_id = contract.id
         ORDER BY installed.id ASC
         LIMIT 1
      ) device ON TRUE`;

const DEVICE_MODEL_ID_SQL = `COALESCE(device.device_model_id, contract.device_model_id)`;

function dateFilter(value: unknown, label: string): string | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (normalized == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime())) {
    throw new ReportingError(400, `${label} غير صالح`);
  }
  return normalized;
}

/** The mandatory picker, validated before it can reach SQL. */
export function parseSalesCountDeviceModelIds(request: TabularReportRequestParams): number[] {
  const ids = parseDeviceModelIds(request);
  if (ids.length < SALES_COUNT_MIN_DEVICE_MODELS) {
    throw new ReportingError(400, 'اختر جهازًا واحدًا على الأقل لتوليد التقرير');
  }
  if (ids.length > SALES_COUNT_MAX_DEVICE_MODELS) {
    throw new ReportingError(400, `لا يمكن اختيار أكثر من ${SALES_COUNT_MAX_DEVICE_MODELS} أجهزة في التوليد الواحد`);
  }
  return ids;
}

/**
 * The row is a seller inside a branch, and the sales themselves produce the rows: the
 * contract whose `sale_owner_id` is NULL collects into one «غير منسوب» row per branch
 * instead of dropping out of the report. Every measured column is a plain aggregate of
 * the same population, so no join can multiply the grain.
 */
export function buildSalesCountQuery(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const filters: string[] = [];

  if (access.branchIds.length > 0) {
    params.push(access.branchIds);
    filters.push(`contract.branch_id = ANY($${params.length}::int[])`);
  }
  if (access.scope === 'ASSIGNED') {
    params.push(access.userId);
    filters.push(`EXISTS (
      SELECT 1 FROM hr_users scoped_user
       WHERE scoped_user.id = $${params.length}
         AND scoped_user.employee_id = contract.sale_owner_id
    )`);
  }

  const fromDate = dateFilter(request.fromDate, 'بداية المدة');
  const toDate = dateFilter(request.toDate, 'نهاية المدة');
  if (!fromDate || !toDate) throw new ReportingError(400, 'مدة التقرير مطلوبة لتوليده');
  if (fromDate > toDate) throw new ReportingError(400, 'بداية المدة يجب ألا تكون بعد نهايتها');
  params.push(fromDate);
  const fromRef = `$${params.length}`;
  params.push(toDate);
  const toRef = `$${params.length}`;

  const deviceModelIds = parseSalesCountDeviceModelIds(request);
  params.push(deviceModelIds);
  const modelIdsRef = `$${params.length}::int[]`;

  const sellerEmployeeId = positiveInt(request.sellerEmployeeId);
  if (sellerEmployeeId != null) {
    params.push(sellerEmployeeId);
    filters.push(`contract.sale_owner_id = $${params.length}`);
  }

  const departmentTypeId = positiveInt(request.departmentTypeId);
  if (departmentTypeId != null) {
    params.push(departmentTypeId);
    filters.push(`department.department_type_id = $${params.length}`);
  }

  // The report already shows the seller's department and title; these narrow by them
  // rather than leaving the reader to scan the whole leaderboard for one department.
  filters.push(...employeeDimensionConditions(request, params, 'contract.sale_owner_id'));

  const deviceColumnsSql = deviceModelIds.map(id => `,
           COUNT(*) FILTER (WHERE ${DEVICE_MODEL_ID_SQL} = ${id})::int AS "deviceModel_${id}"`).join('');

  params.push(options.limit);
  const limitRef = `$${params.length}`;
  let offsetSql = '';
  if (options.offset != null) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT contract.branch_id AS "branchId",
           contract.sale_owner_id AS "sellerId",
           COALESCE(NULLIF(BTRIM(branch.name), ''), 'غير محدد') AS "branchName",
           COALESCE(NULLIF(BTRIM(owner.name), ''), 'غير منسوب إلى بائع') AS "sellerName",
           NULLIF(BTRIM(owner.job_title), '') AS "jobTitle",
           NULLIF(BTRIM(department.name), '') AS "departmentName",
           COUNT(*)::int AS "totalSales",
           COALESCE(SUM(model.sale_points), 0)::numeric AS "salesPoints"${deviceColumnsSql}
           ${options.includeTotalRows === false ? '' : ', COUNT(*) OVER()::int AS "totalRows"'}
      FROM contracts contract
      JOIN branches branch ON branch.id = contract.branch_id
      ${CONTRACT_DEVICE_SQL}
      LEFT JOIN device_models model ON model.id = ${DEVICE_MODEL_ID_SQL}
      LEFT JOIN employees owner ON owner.id = contract.sale_owner_id
      LEFT JOIN departments department ON department.id = owner.department_id
     WHERE contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
       AND contract.sale_subtype = 'definitive'
       AND ${CONTRACT_DATE_SHAPE_SQL}
       AND contract.contract_date >= ${fromRef}::text
       AND contract.contract_date <= ${toRef}::text
       AND ${DEVICE_MODEL_ID_SQL} = ANY(${modelIdsRef})
       ${filters.map(filter => `AND ${filter}`).join('\n       ')}
     GROUP BY contract.branch_id, contract.sale_owner_id, branch.name,
              owner.name, owner.job_title, department.name
     ORDER BY ${buildTabularReportOrderBy(
       'performance.sales_count', access, request,
       `"salesPoints" DESC, "totalSales" DESC, contract.branch_id ASC, contract.sale_owner_id ASC NULLS LAST`,
     )}
     LIMIT ${limitRef}${offsetSql}
  `;
  return { sql, params };
}

export async function getSalesCountReport(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
  options: QueryOptions,
) {
  const query = buildSalesCountQuery(access, request, options);
  const { rows } = await pool.query<SalesCountRow>(query.sql, query.params);
  return { rows, total: rows.length };
}

/**
 * One column per selected model (§9.10). The totals stay fixed catalogue columns, so
 * the header keeps its shape while the breakdown changes with the run.
 */
export async function getSalesCountDynamicColumns(
  request: TabularReportRequestParams,
): Promise<TabularReportColumn[]> {
  const ids = parseSalesCountDeviceModelIds(request);
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
  return ids.map(id => ({
    key: `deviceModel_${id}`, titleAr: `بيعات ${labels.get(id)}`,
    type: 'integer' as const, width: 20, sortable: true,
  }));
}

/**
 * The device options carry their sales weight in the label, because 42 of the 58
 * catalogue models hold no weight: selecting one of those is legitimate, but the
 * generator has to know the points column will read zero before generating (DEC-L).
 * The seller options follow DEC-K — the active holders of the selling job titles, plus
 * anyone who actually owns a sale inside the requested period even after leaving — and
 * both lists stay inside the caller's branch scope (§9.7.1).
 */
export async function getSalesCountFilterOptions(
  access: TabularReportAccess,
  request: TabularReportRequestParams,
): Promise<Partial<TabularReportFilterOptions>> {
  const scopeIds = access.branchIds.length > 0 ? access.branchIds : null;
  const fromDate = dateFilter(request.fromDate, 'بداية المدة');
  const toDate = dateFilter(request.toDate, 'نهاية المدة');

  const [sellers, types, models] = await Promise.all([
    pool.query(`
      WITH sale_owner_titles AS (
        SELECT DISTINCT BTRIM(title.value) AS job_title
          FROM system_lists list
          CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(list.metadata->'${SALE_OWNER_JOB_TITLES_KEY}') title(value)
         WHERE list.category = 'department_type'
           AND JSONB_TYPEOF(list.metadata->'${SALE_OWNER_JOB_TITLES_KEY}') = 'array'
           AND NULLIF(BTRIM(title.value), '') IS NOT NULL
      )
      SELECT employee.id::text AS value,
             COALESCE(NULLIF(BTRIM(employee.name), ''), 'موظف #' || employee.id::text)
               || CASE WHEN employee.status = 'active' THEN '' ELSE ' (خارج الخدمة)' END AS label
        FROM employees employee
       WHERE ($1::int[] IS NULL OR employee.branch_id = ANY($1::int[]))
         AND (
           (employee.status = 'active'
             AND BTRIM(employee.job_title) IN (SELECT job_title FROM sale_owner_titles))
           OR EXISTS (
             SELECT 1 FROM contracts contract
              WHERE contract.sale_owner_id = employee.id
                AND contract.status IN ${COUNTED_CONTRACT_STATUSES_SQL}
                AND contract.sale_subtype = 'definitive'
                AND ${CONTRACT_DATE_SHAPE_SQL}
                AND ($2::text IS NULL OR contract.contract_date >= $2::text)
                AND ($3::text IS NULL OR contract.contract_date <= $3::text)
                AND ($1::int[] IS NULL OR contract.branch_id = ANY($1::int[]))
           )
         )
       ORDER BY label
    `, [scopeIds, fromDate, toDate]),
    pool.query(`
      SELECT DISTINCT list.id::text AS value, list.value AS label
        FROM departments dept
        JOIN system_lists list ON list.id = dept.department_type_id
       WHERE NULLIF(BTRIM(list.value), '') IS NOT NULL
         AND ($1::int[] IS NULL OR dept.branch_id = ANY($1::int[]))
       ORDER BY label
    `, [scopeIds]),
    pool.query(`
      SELECT model.id::text AS value,
             COALESCE(NULLIF(BTRIM(model.name_ar), ''), NULLIF(BTRIM(model.name_en), ''),
                      NULLIF(BTRIM(model.name), ''), 'جهاز #' || model.id::text)
               || CASE WHEN model.is_active THEN '' ELSE ' (غير نشط)' END
               || CASE WHEN model.sale_points IS NULL THEN ' — بلا نقاط'
                       WHEN model.sale_points = 1 THEN ' — نقطة'
                       WHEN model.sale_points = 0.5 THEN ' — نصف نقطة'
                       ELSE ' — ' || TRIM(TO_CHAR(model.sale_points, 'FM999990.00')) || ' نقطة' END AS label
        FROM device_models model
       WHERE model.deleted_at IS NULL
       ORDER BY model.is_active DESC, label
    `),
  ]);

  return {
    ...await getEmployeeDimensionOptions(access.branchIds),
    contractSellers: sellers.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    departmentTypes: types.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
    deviceModels: models.rows.map(row => ({ value: String(row.value), label: String(row.label) })),
  };
}
