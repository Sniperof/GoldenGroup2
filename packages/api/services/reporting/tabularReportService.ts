import type { AuthContext } from '@golden-crm/shared';
import pool from '../../db.js';
import { columnsForGrantedScope, findTabularReport, type TabularReportColumn } from './tabularReportCatalog.js';
import { resolveTabularExportAccess, resolveTabularReportAccess, positiveInt, type TabularReportRequestParams } from './tabularReportAccess.js';
import { buildTabularReportExcel } from './tabularReportExcel.js';
import { ReportingError } from './reportingError.js';
import { getWorkFilesGeoSupervisorsReport } from './workFilesGeoSupervisorsReport.js';
import { getDailyVisitsFilterOptions, getDailyVisitsReport } from './dailyVisitsReport.js';
import { getServiceDevicesFilterOptions, getServiceDevicesReport } from './serviceDevicesReport.js';
import { getGeographicPortfolioReport } from './geographicPortfolioReport.js';
import { getSalesFollowUpFilterOptions, getSalesFollowUpTasksReport } from './salesFollowUpTasksReport.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_REPORT_ROWS = 50_000;

type StoredRun = {
  id: string; reportKey: string; generatedBy: number;
  scopeType: 'GLOBAL' | 'BRANCH' | 'ASSIGNED'; branchIds: number[];
  filters: TabularReportRequestParams; columns: TabularReportColumn[];
  rowCount: number; generatedAt: Date;
};

export async function generateTabularReport(authContext: AuthContext, reportKey: string, params: TabularReportRequestParams) {
  const definition = requireDefinition(reportKey);
  const access = resolveTabularReportAccess(authContext, definition.viewPermission, params, definition.supportedScopes);
  const result = await executeReport(reportKey, access, params, { limit: MAX_REPORT_ROWS + 1 });
  if (result.rows.length > MAX_REPORT_ROWS) throw new ReportingError(413, `عدد صفوف التقرير يتجاوز الحد (${MAX_REPORT_ROWS})؛ ضيّق الفلاتر أولًا`);
  const columns = columnsForGrantedScope(definition, access.grantedScope);
  const filters = normalizedFilters(params);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: runRows } = await client.query(
      `INSERT INTO report_runs (report_key, generated_by, scope_type, branch_ids, filters, columns, row_count)
       VALUES ($1,$2,$3,$4::int[],$5::jsonb,$6::jsonb,$7)
       RETURNING id, generated_at AS "generatedAt"`,
      [reportKey, authContext.userId, access.scope, access.branchIds, JSON.stringify(filters), JSON.stringify(columns), result.rows.length],
    );
    const runId = String(runRows[0].id);
    if (result.rows.length > 0) await client.query(
      `INSERT INTO report_run_rows (run_id,row_number,row_data)
       SELECT $1::bigint, ordinality::int, value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY`,
      [runId, JSON.stringify(result.rows)],
    );
    await client.query('COMMIT');
    const run: StoredRun = { id: runId, reportKey, generatedBy: authContext.userId, scopeType: access.scope,
      branchIds: access.branchIds, filters, columns, rowCount: result.rows.length, generatedAt: new Date(runRows[0].generatedAt) };
    return responseForRun(definition, run, result.rows.slice(0, DEFAULT_PAGE_SIZE), 1, DEFAULT_PAGE_SIZE);
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}

export async function getTabularReportRun(authContext: AuthContext, runId: string, params: TabularReportRequestParams) {
  const run = await loadAuthorizedRun(authContext, runId, false);
  const definition = requireDefinition(run.reportKey);
  const page = positiveInt(params.page) ?? 1;
  const limit = Math.min(positiveInt(params.limit) ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { rows } = await pool.query(
    `SELECT row_data AS row FROM report_run_rows WHERE run_id=$1 ORDER BY row_number LIMIT $2 OFFSET $3`,
    [run.id, limit, (page - 1) * limit],
  );
  return responseForRun(definition, run, rows.map(row => row.row), page, limit);
}

export async function exportTabularReportRun(authContext: AuthContext, runId: string) {
  const run = await loadAuthorizedRun(authContext, runId, true);
  const definition = requireDefinition(run.reportKey);
  const { rows } = await pool.query(`SELECT row_data AS row FROM report_run_rows WHERE run_id=$1 ORDER BY row_number`, [run.id]);
  const exportedAt = new Date();
  const buffer = await buildTabularReportExcel(definition, rows.map(row => row.row), {
    scope: run.scopeType, branchIds: run.branchIds, generatedAt: run.generatedAt, exportedAt, columns: run.columns,
  });
  await pool.query(
    `INSERT INTO report_export_audit (report_run_id,report_key,exported_by,scope_type,branch_ids,filters,row_count,created_at)
     VALUES ($1,$2,$3,$4,$5::int[],$6::jsonb,$7,$8)`,
    [run.id, run.reportKey, authContext.userId, run.scopeType, run.branchIds, JSON.stringify(run.filters), run.rowCount, exportedAt],
  );
  return { buffer, exportedAt, filename: `${definition.key.replaceAll('.', '-')}-${run.generatedAt.toISOString().replaceAll(':', '-').slice(0, 19)}.xlsx` };
}

export async function getTabularReportFilterOptions(
  authContext: AuthContext,
  reportKey: string,
  params: TabularReportRequestParams,
) {
  const definition = requireDefinition(reportKey);
  const access = resolveTabularReportAccess(authContext, definition.viewPermission, params, definition.supportedScopes);
  if (reportKey === 'daily_work.visits_log') return getDailyVisitsFilterOptions(access);
  if (reportKey === 'service.installed_devices') return getServiceDevicesFilterOptions(access);
  if (reportKey === 'performance.sales_follow_up_tasks') {
    const options = await getSalesFollowUpFilterOptions(access);
    return {
      ...options, telemarketers: [], visitStatuses: [], deviceModels: [], deviceStatuses: [],
      warrantyStatuses: [], customerRatings: [], contactEmployees: [],
    };
  }
  return {
    supervisors: [], technicians: [], telemarketers: [], visitStatuses: [], taskTypes: [],
    deviceModels: [], deviceStatuses: [], warrantyStatuses: [], customerRatings: [], contactEmployees: [],
  };
}

function normalizedFilters(params: TabularReportRequestParams): TabularReportRequestParams {
  return {
    branchId: positiveInt(params.branchId), employeeId: positiveInt(params.employeeId),
    supervisorEmployeeId: positiveInt(params.supervisorEmployeeId),
    technicianEmployeeId: positiveInt(params.technicianEmployeeId),
    telemarketerUserId: positiveInt(params.telemarketerUserId),
    visitStatus: typeof params.visitStatus === 'string' ? params.visitStatus : null,
    taskType: typeof params.taskType === 'string' ? params.taskType : null,
    search: typeof params.search === 'string' ? params.search.trim() : null,
    deviceModelId: positiveInt(params.deviceModelId),
    deviceModel: typeof params.deviceModel === 'string' ? params.deviceModel : null,
    deviceStatus: typeof params.deviceStatus === 'string' ? params.deviceStatus : null,
    warrantyStatus: typeof params.warrantyStatus === 'string' ? params.warrantyStatus : null,
    customerRating: typeof params.customerRating === 'string' ? params.customerRating : null,
    contactEmployeeId: positiveInt(params.contactEmployeeId),
    lastContactChannel: typeof params.lastContactChannel === 'string' ? params.lastContactChannel : null,
    replacedParts: typeof params.replacedParts === 'string' ? params.replacedParts : null,
    minPaidAmount: params.minPaidAmount == null || params.minPaidAmount === '' ? null : Number(params.minPaidAmount),
    maxPaidAmount: params.maxPaidAmount == null || params.maxPaidAmount === '' ? null : Number(params.maxPaidAmount),
    installationFrom: typeof params.installationFrom === 'string' ? params.installationFrom : null,
    installationTo: typeof params.installationTo === 'string' ? params.installationTo : null,
    periodicMaintenanceFrom: typeof params.periodicMaintenanceFrom === 'string' ? params.periodicMaintenanceFrom : null,
    periodicMaintenanceTo: typeof params.periodicMaintenanceTo === 'string' ? params.periodicMaintenanceTo : null,
    completedVisitFrom: typeof params.completedVisitFrom === 'string' ? params.completedVisitFrom : null,
    completedVisitTo: typeof params.completedVisitTo === 'string' ? params.completedVisitTo : null,
    lastContactFrom: typeof params.lastContactFrom === 'string' ? params.lastContactFrom : null,
    lastContactTo: typeof params.lastContactTo === 'string' ? params.lastContactTo : null,
    incompleteVisitFrom: typeof params.incompleteVisitFrom === 'string' ? params.incompleteVisitFrom : null,
    incompleteVisitTo: typeof params.incompleteVisitTo === 'string' ? params.incompleteVisitTo : null,
    geoUnitId: positiveInt(params.geoUnitId), geoIds: typeof params.geoIds === 'string' ? params.geoIds : null,
    fromDate: typeof params.fromDate === 'string' ? params.fromDate : null,
    toDate: typeof params.toDate === 'string' ? params.toDate : null,
  };
}

async function loadAuthorizedRun(authContext: AuthContext, runId: string, forExport: boolean): Promise<StoredRun> {
  if (!/^\d+$/.test(runId)) throw new ReportingError(400, 'معرف توليد التقرير غير صالح');
  const { rows } = await pool.query(
    `SELECT id,report_key AS "reportKey",generated_by AS "generatedBy",scope_type AS "scopeType",
            branch_ids AS "branchIds",filters,columns,row_count AS "rowCount",generated_at AS "generatedAt"
     FROM report_runs WHERE id=$1 AND generated_by=$2`, [runId, authContext.userId],
  );
  if (!rows[0]) throw new ReportingError(404, 'نسخة التقرير غير موجودة');
  const run = rows[0] as StoredRun;
  run.id = String(run.id); run.branchIds = (run.branchIds ?? []).map(Number); run.rowCount = Number(run.rowCount); run.generatedAt = new Date(run.generatedAt);
  const definition = requireDefinition(run.reportKey);
  const current = forExport
    ? resolveTabularExportAccess(authContext, definition.viewPermission, definition.exportPermission, run.filters, definition.supportedScopes)
    : resolveTabularReportAccess(authContext, definition.viewPermission, run.filters, definition.supportedScopes);
  if (run.scopeType === 'GLOBAL' && current.grantedScope !== 'GLOBAL') throw new ReportingError(403, 'لم تعد صلاحيتك تسمح بهذه النسخة الشاملة');
  if (run.branchIds.length > 0 && current.grantedScope !== 'GLOBAL' && run.branchIds.some(id => !current.branchIds.includes(id))) throw new ReportingError(403, 'لم تعد فروع هذه النسخة ضمن صلاحيتك');
  return run;
}

function responseForRun(definition: ReturnType<typeof requireDefinition>, run: StoredRun, rows: object[], page: number, limit: number) {
  return { runId: run.id, report: { key: definition.key, groupKey: definition.groupKey, title: definition.titleAr,
    description: definition.descriptionAr, question: definition.question, grain: definition.grain, columns: run.columns,
    filters: definition.filters, guide: definition.guide },
    scope: run.scopeType, branchIds: run.branchIds, filters: run.filters, rows,
    pagination: { page, limit, total: run.rowCount, pages: Math.ceil(run.rowCount / limit) }, generatedAt: run.generatedAt.toISOString() };
}

function requireDefinition(reportKey: string) { const definition = findTabularReport(reportKey); if (!definition) throw new ReportingError(404, 'التقرير غير معروف'); return definition; }

async function executeReport(reportKey: string, access: ReturnType<typeof resolveTabularReportAccess>, params: TabularReportRequestParams, options: { offset?: number; limit: number }) {
  if (reportKey === 'work_files.geo_supervisors') return getWorkFilesGeoSupervisorsReport(access, params, options);
  if (reportKey === 'daily_work.visits_log') return getDailyVisitsReport(access, params, options);
  if (reportKey === 'service.installed_devices') return getServiceDevicesReport(access, params, options);
  if (reportKey === 'performance.geographic_portfolio') return getGeographicPortfolioReport(access, params, options);
  if (reportKey === 'performance.sales_follow_up_tasks') return getSalesFollowUpTasksReport(access, params, options);
  throw new ReportingError(404, 'التقرير غير معروف');
}
