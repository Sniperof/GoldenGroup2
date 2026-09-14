import type { AuthContext } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pool from '../../db.js';
import { columnsForGrantedScope, findTabularReport, mergeTabularReportColumns, type TabularReportColumn } from './tabularReportCatalog.js';
import { resolveTabularExportAccess, resolveTabularReportAccess, positiveInt, type TabularReportRequestParams } from './tabularReportAccess.js';
import { writeTabularReportExcelFile } from './tabularReportExcel.js';
import { ReportingError } from './reportingError.js';
import { buildWorkFilesGeoSupervisorsQuery, getWorkFilesGeoSupervisorsFilterOptions } from './workFilesGeoSupervisorsReport.js';
import { buildDailyVisitsQuery, getDailyVisitsFilterOptions } from './dailyVisitsReport.js';
import { buildServiceDevicesQuery, getServiceDevicesFilterOptions } from './serviceDevicesReport.js';
import { buildGeographicPortfolioQuery, getGeographicPortfolioFilterOptions } from './geographicPortfolioReport.js';
import { buildSalesFollowUpTasksQuery, getSalesFollowUpFilterOptions } from './salesFollowUpTasksReport.js';
import { buildWorkFilesNamesFileQuery, getWorkFilesNamesFileFilterOptions } from './workFilesNamesFileReport.js';
import { buildDailyWorkSalesFileQuery, getDailyWorkSalesFileFilterOptions } from './dailyWorkSalesFileReport.js';
import { buildSalesByTypeQuery, getSalesByTypeDynamicColumns, getSalesByTypeFilterOptions } from './salesByTypeReport.js';
import { buildDepartmentResultsQuery, getDepartmentResultsFilterOptions } from './departmentResultsReport.js';
import { buildSalesCountQuery, getSalesCountDynamicColumns, getSalesCountFilterOptions } from './salesCountReport.js';
import { buildCustomerCallsQuery, getCustomerCallsFilterOptions } from './customerCallsReport.js';
import { buildTechnicianWorkQuery, getTechnicianWorkFilterOptions } from './technicianWorkReport.js';
import { buildServiceDuesQuery, getServiceDuesFilterOptions } from './serviceDuesReport.js';
import { buildDeviceFaultsQuery, getDeviceFaultsFilterOptions } from './deviceFaultsReport.js';
import { buildRetrievedDevicesQuery, getRetrievedDevicesFilterOptions } from './retrievedDevicesReport.js';
import { buildMediatorGiftsQuery, getMediatorGiftsFilterOptions } from './mediatorGiftsReport.js';
import { completeTabularReportFilterOptions } from './tabularReportFilterOptions.js';
import { normalizeTabularReportSort } from './tabularReportSorting.js';

export const DEFAULT_TABULAR_REPORT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 200;
export const TABULAR_SNAPSHOT_BATCH_SIZE = 1_000;

export interface SnapshotPersistenceMetrics {
  batchSize: number;
  batchCount: number;
  cursorDeclareMs: number;
  sourceFetchMs: number;
  snapshotWriteMs: number;
  totalSnapshotMs: number;
}

type StoredRun = {
  id: string; reportKey: string; generatedBy: number;
  scopeType: 'GLOBAL' | 'BRANCH' | 'ASSIGNED'; branchIds: number[];
  filters: TabularReportRequestParams; columns: TabularReportColumn[];
  rowCount: number; generatedAt: Date; status: 'queued' | 'running' | 'completed' | 'failed';
  requestedAt: Date; startedAt: Date | null; completedAt: Date | null;
  progressRows: number; progressBatches: number; failureMessage: string | null;
  expiresAt: Date; isPinned: boolean;
};

export async function generateTabularReport(authContext: AuthContext, reportKey: string, params: TabularReportRequestParams) {
  const definition = requireDefinition(reportKey);
  const access = resolveTabularReportAccess(authContext, definition.viewPermission, params, definition.supportedScopes);
  validateTabularReportRequest(reportKey, access, params);
  const columns = mergeTabularReportColumns(
    columnsForGrantedScope(definition, access.grantedScope),
    await dynamicColumnsFor(reportKey, params),
    definition.dynamicColumnsBeforeKey,
  );
  const sort = normalizeTabularReportSort(reportKey, access, params);
  const filters = { ...normalizedFilters(params), ...(sort ?? {}) };
  const { rows } = await pool.query(
    `INSERT INTO report_runs
       (report_key,generated_by,scope_type,branch_ids,filters,columns,row_count,status,requested_at)
     VALUES ($1,$2,$3,$4::int[],$5::jsonb,$6::jsonb,0,'queued',NOW())
     RETURNING id,requested_at AS "requestedAt",expires_at AS "expiresAt"`,
    [reportKey, authContext.userId, access.scope, access.branchIds, JSON.stringify(filters), JSON.stringify(columns)],
  );
  return {
    runId: String(rows[0].id), status: 'queued' as const,
    requestedAt: new Date(rows[0].requestedAt).toISOString(),
    expiresAt: new Date(rows[0].expiresAt).toISOString(),
    progress: { rows: 0, batches: 0 },
  };
}

export async function getTabularReportRun(authContext: AuthContext, runId: string, params: TabularReportRequestParams) {
  const run = await loadAuthorizedRun(authContext, runId, false);
  const definition = requireDefinition(run.reportKey);
  if (run.status !== 'completed') return statusResponse(run);
  const { page, limit, startRow, endRow } = resolveTabularReportPagination(params);
  const { rows } = await pool.query(
    `SELECT row_data AS row FROM report_run_rows
      WHERE run_id=$1 AND row_number BETWEEN $2 AND $3
      ORDER BY row_number`,
    [run.id, startRow, endRow],
  );
  return responseForRun(definition, run, rows.map(row => row.row), page, limit);
}

export async function exportTabularReportRun(authContext: AuthContext, runId: string) {
  const exportStarted = performance.now();
  const run = await loadAuthorizedRun(authContext, runId, true);
  if (run.status !== 'completed') throw new ReportingError(409, 'لا يمكن تصدير التقرير قبل اكتمال توليده');
  const definition = requireDefinition(run.reportKey);
  const exportedAt = new Date();
  const filePath = join(tmpdir(), `golden-report-${run.id}-${randomUUID()}.xlsx`);
  let snapshotReadMs = 0;
  const client = await pool.connect();
  async function* rowBatches(): AsyncGenerator<object[]> {
    try {
      await client.query('BEGIN');
      await client.query('DECLARE tabular_report_export_cursor NO SCROLL CURSOR FOR SELECT row_data AS row FROM report_run_rows WHERE run_id=$1 ORDER BY row_number', [run.id]);
      while (true) {
        const readStarted = performance.now();
        const { rows } = await client.query('FETCH FORWARD 1000 FROM tabular_report_export_cursor');
        snapshotReadMs += elapsedMs(readStarted);
        if (rows.length === 0) break;
        yield rows.map(row => row.row as object);
        if (rows.length < 1000) break;
      }
      await client.query('CLOSE tabular_report_export_cursor');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  const workbookStarted = performance.now();
  try {
    await writeTabularReportExcelFile(definition, rowBatches(), {
      scope: run.scopeType, branchIds: run.branchIds, generatedAt: run.completedAt ?? run.generatedAt,
      exportedAt, columns: run.columns, rowCount: run.rowCount,
    }, filePath);
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
  const fileStat = await stat(filePath);
  const metrics = {
    snapshotReadMs: roundMs(snapshotReadMs),
    workbookBuildMs: elapsedMs(workbookStarted),
    totalExportMs: elapsedMs(exportStarted),
    byteSize: fileStat.size,
  };
  await pool.query(
    `INSERT INTO report_export_audit (report_run_id,report_key,exported_by,scope_type,branch_ids,filters,row_count,created_at,metrics)
     VALUES ($1,$2,$3,$4,$5::int[],$6::jsonb,$7,$8,$9::jsonb)`,
    [run.id, run.reportKey, authContext.userId, run.scopeType, run.branchIds, JSON.stringify(run.filters), run.rowCount, exportedAt, JSON.stringify(metrics)],
  );
  return {
    filePath, exportedAt,
    filename: `${definition.key.replaceAll('.', '-')}-${(run.completedAt ?? run.generatedAt).toISOString().replaceAll(':', '-').slice(0, 19)}.xlsx`,
    cleanup: () => unlink(filePath).catch(() => undefined),
  };
}

export async function getTabularReportFilterOptions(
  authContext: AuthContext,
  reportKey: string,
  params: TabularReportRequestParams,
) {
  const definition = requireDefinition(reportKey);
  const access = resolveTabularReportAccess(authContext, definition.viewPermission, params, definition.supportedScopes);
  if (reportKey === 'work_files.geo_supervisors') {
    return completeTabularReportFilterOptions(await getWorkFilesGeoSupervisorsFilterOptions(access));
  }
  if (reportKey === 'performance.geographic_portfolio') {
    return completeTabularReportFilterOptions(await getGeographicPortfolioFilterOptions(access));
  }
  if (reportKey === 'daily_work.visits_log') {
    return completeTabularReportFilterOptions(await getDailyVisitsFilterOptions(access));
  }
  if (reportKey === 'service.installed_devices') {
    return completeTabularReportFilterOptions(await getServiceDevicesFilterOptions(access));
  }
  if (reportKey === 'performance.sales_follow_up_tasks') {
    return completeTabularReportFilterOptions(await getSalesFollowUpFilterOptions(access));
  }
  if (reportKey === 'work_files.names_file') {
    return completeTabularReportFilterOptions(await getWorkFilesNamesFileFilterOptions(access));
  }
  if (reportKey === 'work_files.mediator_gifts') {
    return completeTabularReportFilterOptions(await getMediatorGiftsFilterOptions(access));
  }
  if (reportKey === 'daily_work.sales_file') {
    return completeTabularReportFilterOptions(await getDailyWorkSalesFileFilterOptions(access, params));
  }
  if (reportKey === 'performance.sales_by_type') {
    return completeTabularReportFilterOptions(await getSalesByTypeFilterOptions(access));
  }
  if (reportKey === 'performance.department_results') {
    return completeTabularReportFilterOptions(await getDepartmentResultsFilterOptions(access));
  }
  if (reportKey === 'performance.sales_count') {
    return completeTabularReportFilterOptions(await getSalesCountFilterOptions(access, params));
  }
  if (reportKey === 'performance.customer_calls') {
    return completeTabularReportFilterOptions(await getCustomerCallsFilterOptions(access, params));
  }
  if (reportKey === 'performance.technician_work') {
    return completeTabularReportFilterOptions(await getTechnicianWorkFilterOptions(access));
  }
  if (reportKey === 'service.dues') {
    return completeTabularReportFilterOptions(await getServiceDuesFilterOptions(access));
  }
  if (reportKey === 'service.device_faults') {
    return completeTabularReportFilterOptions(await getDeviceFaultsFilterOptions(access));
  }
  if (reportKey === 'service.retrieved_devices') {
    return completeTabularReportFilterOptions(await getRetrievedDevicesFilterOptions(access));
  }
  return completeTabularReportFilterOptions(null);
}

type ReportSqlQuery = { sql: string; params: unknown[] };

export async function persistTabularReportSnapshot(
  client: Pick<PoolClient, 'query'>,
  runId: string,
  reportQuery: ReportSqlQuery,
  batchSize = TABULAR_SNAPSHOT_BATCH_SIZE,
  onBatch?: (progress: { rowCount: number; batchCount: number }) => Promise<void>,
): Promise<{ rowCount: number; metrics: SnapshotPersistenceMetrics }> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error('حجم دفعة التقرير غير صالح');
  const cursorName = 'tabular_report_snapshot_cursor';
  const snapshotStarted = performance.now();
  const declareStarted = performance.now();
  await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${reportQuery.sql}`, reportQuery.params);
  const cursorDeclareMs = elapsedMs(declareStarted);
  let rowCount = 0;
  let batchCount = 0;
  let sourceFetchMs = 0;
  let snapshotWriteMs = 0;
  while (true) {
    const fetchStarted = performance.now();
    const batch = await client.query(`FETCH FORWARD ${batchSize} FROM ${cursorName}`);
    sourceFetchMs += elapsedMs(fetchStarted);
    if (batch.rows.length === 0) break;
    const writeStarted = performance.now();
    await client.query(
      `INSERT INTO report_run_rows (run_id,row_number,row_data)
       SELECT $1::bigint, ($2::int + ordinality)::int, value
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY`,
      [runId, rowCount, JSON.stringify(batch.rows)],
    );
    snapshotWriteMs += elapsedMs(writeStarted);
    rowCount += batch.rows.length;
    batchCount += 1;
    await onBatch?.({ rowCount, batchCount });
    if (batch.rows.length < batchSize) break;
  }
  await client.query(`CLOSE ${cursorName}`);
  return {
    rowCount,
    metrics: {
      batchSize,
      batchCount,
      cursorDeclareMs,
      sourceFetchMs: roundMs(sourceFetchMs),
      snapshotWriteMs: roundMs(snapshotWriteMs),
      totalSnapshotMs: elapsedMs(snapshotStarted),
    },
  };
}

export function resolveTabularReportPagination(params: Pick<TabularReportRequestParams, 'page' | 'limit'>) {
  const page = positiveInt(params.page) ?? 1;
  const limit = Math.min(positiveInt(params.limit) ?? DEFAULT_TABULAR_REPORT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = (page - 1) * limit;
  return { page, limit, offset, startRow: offset + 1, endRow: offset + limit };
}

function roundMs(value: number): number { return Math.round(value * 100) / 100; }
function elapsedMs(startedAt: number): number { return roundMs(performance.now() - startedAt); }

export function normalizedFilters(params: TabularReportRequestParams): TabularReportRequestParams {
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
    sortKey: typeof params.sortKey === 'string' ? params.sortKey : null,
    sortDir: typeof params.sortDir === 'string' ? params.sortDir : null,
    candidateNameSearch: typeof params.candidateNameSearch === 'string' ? params.candidateNameSearch.trim() : null,
    candidateSourceType: typeof params.candidateSourceType === 'string' ? params.candidateSourceType : null,
    candidateStatus: typeof params.candidateStatus === 'string' ? params.candidateStatus : null,
    candidateOutcome: typeof params.candidateOutcome === 'string' ? params.candidateOutcome : null,
    candidateDuplicateStatus: typeof params.candidateDuplicateStatus === 'string' ? params.candidateDuplicateStatus : null,
    candidateAddedFrom: typeof params.candidateAddedFrom === 'string' ? params.candidateAddedFrom : null,
    candidateAddedTo: typeof params.candidateAddedTo === 'string' ? params.candidateAddedTo : null,
    referralSheetNumber: positiveInt(params.referralSheetNumber),
    referralSheetFrom: typeof params.referralSheetFrom === 'string' ? params.referralSheetFrom : null,
    referralSheetTo: typeof params.referralSheetTo === 'string' ? params.referralSheetTo : null,
    mediatorName: typeof params.mediatorName === 'string' ? params.mediatorName.trim() : null,
    mediatorType: typeof params.mediatorType === 'string' ? params.mediatorType : null,
    mediatorVisitFrom: typeof params.mediatorVisitFrom === 'string' ? params.mediatorVisitFrom : null,
    mediatorVisitTo: typeof params.mediatorVisitTo === 'string' ? params.mediatorVisitTo : null,
    accompanyingTechnicianId: positiveInt(params.accompanyingTechnicianId),
    giftPromiseStatus: typeof params.giftPromiseStatus === 'string' ? params.giftPromiseStatus : null,
    occupation: typeof params.occupation === 'string' ? params.occupation.trim() : null,
    contractStatus: typeof params.contractStatus === 'string' ? params.contractStatus : null,
    sellerEmployeeId: positiveInt(params.sellerEmployeeId),
    sellerDepartmentTypeId: positiveInt(params.sellerDepartmentTypeId),
    paymentType: typeof params.paymentType === 'string' ? params.paymentType : null,
    executionStage: typeof params.executionStage === 'string' ? params.executionStage : null,
    saleType: typeof params.saleType === 'string' ? params.saleType : null,
    saleSubtype: typeof params.saleSubtype === 'string' ? params.saleSubtype : null,
    remainingBalance: typeof params.remainingBalance === 'string' ? params.remainingBalance : null,
    contractId: positiveInt(params.contractId),
    financialAsOfDate: typeof params.financialAsOfDate === 'string' ? params.financialAsOfDate : null,
    collectionOwnerId: positiveInt(params.collectionOwnerId),
    saleCloserUserId: positiveInt(params.saleCloserUserId),
    latestCollectionResult: typeof params.latestCollectionResult === 'string' ? params.latestCollectionResult : null,
    deviceModelIds: typeof params.deviceModelIds === 'string' ? params.deviceModelIds : null,
    departmentTypeId: positiveInt(params.departmentTypeId),
    faultTypeId: positiveInt(params.faultTypeId),
    faultStatus: typeof params.faultStatus === 'string' ? params.faultStatus : null,
    faultDiscoveryPhase: typeof params.faultDiscoveryPhase === 'string' ? params.faultDiscoveryPhase : null,
    repairTechnicianEmployeeId: positiveInt(params.repairTechnicianEmployeeId),
    faultResolvedFrom: typeof params.faultResolvedFrom === 'string' ? params.faultResolvedFrom : null,
    faultResolvedTo: typeof params.faultResolvedTo === 'string' ? params.faultResolvedTo : null,
    faultDurationBucket: typeof params.faultDurationBucket === 'string' ? params.faultDurationBucket : null,
    faultPartsUsage: typeof params.faultPartsUsage === 'string' ? params.faultPartsUsage : null,
    callOutcome: typeof params.callOutcome === 'string' ? params.callOutcome : null,
    retrievalPurpose: typeof params.retrievalPurpose === 'string' ? params.retrievalPurpose : null,
    retrievalTechnicianEmployeeId: positiveInt(params.retrievalTechnicianEmployeeId),
    retrievedDeviceStatus: typeof params.retrievedDeviceStatus === 'string' ? params.retrievedDeviceStatus : null,
    opFrom: typeof params.opFrom === 'string' ? params.opFrom : null,
    opTo: typeof params.opTo === 'string' ? params.opTo : null,
    contractFrom: typeof params.contractFrom === 'string' ? params.contractFrom : null,
    contractTo: typeof params.contractTo === 'string' ? params.contractTo : null,
    giftDeliveryFrom: typeof params.giftDeliveryFrom === 'string' ? params.giftDeliveryFrom : null,
    giftDeliveryTo: typeof params.giftDeliveryTo === 'string' ? params.giftDeliveryTo : null,
    giftConditionStatus: typeof params.giftConditionStatus === 'string' ? params.giftConditionStatus : null,
    giftDeliveryResult: typeof params.giftDeliveryResult === 'string' ? params.giftDeliveryResult : null,
    giftDefinitionId: positiveInt(params.giftDefinitionId),
    visitTechnicianEmployeeId: positiveInt(params.visitTechnicianEmployeeId),
    retrievalSource: typeof params.retrievalSource === 'string' ? params.retrievalSource : null,
    originBranchId: positiveInt(params.originBranchId),
    lastVisitFrom: typeof params.lastVisitFrom === 'string' ? params.lastVisitFrom : null,
    lastVisitTo: typeof params.lastVisitTo === 'string' ? params.lastVisitTo : null,
    routeId: positiveInt(params.routeId),
    areaEvaluation: typeof params.areaEvaluation === 'string' ? params.areaEvaluation : null,
    evaluationConfidence: typeof params.evaluationConfidence === 'string' ? params.evaluationConfidence : null,
    periodicPressure: typeof params.periodicPressure === 'string' ? params.periodicPressure : null,
    departmentId: positiveInt(params.departmentId),
    jobTitle: typeof params.jobTitle === 'string' ? params.jobTitle.trim() : null,
    employmentStatus: typeof params.employmentStatus === 'string' ? params.employmentStatus : null,
    technicianActivity: typeof params.technicianActivity === 'string' ? params.technicianActivity : null,
    callBookingPresence: typeof params.callBookingPresence === 'string' ? params.callBookingPresence : null,
    receivableSourceType: typeof params.receivableSourceType === 'string' ? params.receivableSourceType : null,
    collectionAppointmentFrom: typeof params.collectionAppointmentFrom === 'string' ? params.collectionAppointmentFrom : null,
    collectionAppointmentTo: typeof params.collectionAppointmentTo === 'string' ? params.collectionAppointmentTo : null,
    collectionAppointmentPresence: typeof params.collectionAppointmentPresence === 'string' ? params.collectionAppointmentPresence : null,
    taskResult: typeof params.taskResult === 'string' ? params.taskResult : null,
    cancellationReasonId: positiveInt(params.cancellationReasonId),
    visitOrigin: typeof params.visitOrigin === 'string' ? params.visitOrigin : null,
  };
}

async function loadAuthorizedRun(authContext: AuthContext, runId: string, forExport: boolean): Promise<StoredRun> {
  if (!/^\d+$/.test(runId)) throw new ReportingError(400, 'معرف توليد التقرير غير صالح');
  const { rows } = await pool.query(
    `SELECT id,report_key AS "reportKey",generated_by AS "generatedBy",scope_type AS "scopeType",
            branch_ids AS "branchIds",filters,columns,row_count AS "rowCount",generated_at AS "generatedAt",
            status,requested_at AS "requestedAt",started_at AS "startedAt",completed_at AS "completedAt",
             COALESCE(runtime.progress_rows,report_runs.progress_rows) AS "progressRows",
             COALESCE(runtime.progress_batches,report_runs.progress_batches) AS "progressBatches",
             failure_message AS "failureMessage",
             expires_at AS "expiresAt",is_pinned AS "isPinned"
      FROM report_runs
      LEFT JOIN report_run_runtime runtime ON runtime.report_run_id=report_runs.id
      WHERE report_runs.id=$1 AND generated_by=$2 AND (is_pinned IS TRUE OR expires_at>NOW())`, [runId, authContext.userId],
  );
  if (!rows[0]) throw new ReportingError(404, 'نسخة التقرير غير موجودة');
  const run = rows[0] as StoredRun;
  run.id = String(run.id); run.branchIds = (run.branchIds ?? []).map(Number); run.rowCount = Number(run.rowCount); run.generatedAt = new Date(run.generatedAt);
  run.requestedAt = new Date(run.requestedAt); run.startedAt = run.startedAt ? new Date(run.startedAt) : null;
  run.completedAt = run.completedAt ? new Date(run.completedAt) : null;
  run.progressRows = Number(run.progressRows ?? 0); run.progressBatches = Number(run.progressBatches ?? 0);
  run.expiresAt = new Date(run.expiresAt); run.isPinned = run.isPinned === true;
  const definition = requireDefinition(run.reportKey);
  const current = forExport
    ? resolveTabularExportAccess(authContext, definition.viewPermission, definition.exportPermission, run.filters, definition.supportedScopes)
    : resolveTabularReportAccess(authContext, definition.viewPermission, run.filters, definition.supportedScopes);
  const scopeRank = { ASSIGNED: 1, BRANCH: 2, GLOBAL: 3 } as const;
  if (scopeRank[current.grantedScope] < scopeRank[run.scopeType]) throw new ReportingError(403, 'لم تعد صلاحيتك تسمح بنطاق هذه النسخة');
  if (run.branchIds.length > 0 && current.grantedScope !== 'GLOBAL' && run.branchIds.some(id => !current.branchIds.includes(id))) throw new ReportingError(403, 'لم تعد فروع هذه النسخة ضمن صلاحيتك');
  return run;
}

function responseForRun(definition: ReturnType<typeof requireDefinition>, run: StoredRun, rows: object[], page: number, limit: number) {
  return { runId: run.id, report: { key: definition.key, groupKey: definition.groupKey, title: definition.titleAr,
    description: definition.descriptionAr, question: definition.question, grain: definition.grain, columns: run.columns,
    filters: definition.filters, guide: definition.guide },
    scope: run.scopeType, branchIds: run.branchIds, filters: run.filters, rows,
    pagination: { page, limit, total: run.rowCount, pages: Math.ceil(run.rowCount / limit) },
    status: 'completed' as const, generatedAt: (run.completedAt ?? run.generatedAt).toISOString(),
    requestedAt: run.requestedAt.toISOString(), expiresAt: run.expiresAt.toISOString(),
    progress: { rows: run.rowCount, batches: run.progressBatches } };
}

function statusResponse(run: StoredRun) {
  return {
    runId: run.id, status: run.status, requestedAt: run.requestedAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null, generatedAt: run.completedAt?.toISOString() ?? null,
    progress: { rows: run.progressRows, batches: run.progressBatches },
    error: run.status === 'failed' ? (run.failureMessage ?? 'فشل توليد التقرير') : null,
  };
}

export function requireDefinition(reportKey: string) { const definition = findTabularReport(reportKey); if (!definition) throw new ReportingError(404, 'التقرير غير معروف'); return definition; }

export function buildReportQuery(reportKey: string, access: ReturnType<typeof resolveTabularReportAccess>, params: TabularReportRequestParams, options: { offset?: number; limit: number; includeTotalRows?: boolean }) {
  if (reportKey === 'work_files.geo_supervisors') return buildWorkFilesGeoSupervisorsQuery(access, params, options);
  if (reportKey === 'daily_work.visits_log') return buildDailyVisitsQuery(access, params, options);
  if (reportKey === 'service.installed_devices') return buildServiceDevicesQuery(access, params, options);
  if (reportKey === 'performance.geographic_portfolio') return buildGeographicPortfolioQuery(access, params, options);
  if (reportKey === 'performance.sales_follow_up_tasks') return buildSalesFollowUpTasksQuery(access, params, options);
  if (reportKey === 'work_files.names_file') return buildWorkFilesNamesFileQuery(access, params, options);
  if (reportKey === 'work_files.mediator_gifts') return buildMediatorGiftsQuery(access, params, options);
  if (reportKey === 'daily_work.sales_file') return buildDailyWorkSalesFileQuery(access, params, options);
  if (reportKey === 'service.dues') return buildServiceDuesQuery(access, params, options);
  if (reportKey === 'service.device_faults') return buildDeviceFaultsQuery(access, params, options);
  if (reportKey === 'service.retrieved_devices') return buildRetrievedDevicesQuery(access, params, options);
  if (reportKey === 'performance.sales_by_type') return buildSalesByTypeQuery(access, params, options);
  if (reportKey === 'performance.department_results') return buildDepartmentResultsQuery(access, params, options);
  if (reportKey === 'performance.sales_count') return buildSalesCountQuery(access, params, options);
  if (reportKey === 'performance.customer_calls') return buildCustomerCallsQuery(access, params, options);
  if (reportKey === 'performance.technician_work') return buildTechnicianWorkQuery(access, params, options);
  throw new ReportingError(404, 'التقرير غير معروف');
}

/**
 * Columns a single run adds beyond its report definition (§9.10). Dispatched by key
 * like the query and the filter options, because resolving the labels needs the
 * database while the catalog stays data-only.
 */
async function dynamicColumnsFor(reportKey: string, params: TabularReportRequestParams): Promise<TabularReportColumn[]> {
  if (reportKey === 'performance.sales_by_type') return getSalesByTypeDynamicColumns(params);
  // The department report carries fixed family columns and the same optional picker.
  if (reportKey === 'performance.department_results') return getSalesByTypeDynamicColumns(params);
  // The sales-count report owns its picker: the totals stay fixed catalogue columns.
  if (reportKey === 'performance.sales_count') return getSalesCountDynamicColumns(params);
  return [];
}

export function validateTabularReportRequest(
  reportKey: string,
  access: ReturnType<typeof resolveTabularReportAccess>,
  params: TabularReportRequestParams,
) {
  buildReportQuery(reportKey, access, params, { limit: 1, includeTotalRows: false });
}
