// ============================================================
// reports.ts — نقطة الوصول الموحّدة للمؤشرات (reporting-analytics §1.3)
// ============================================================
//   GET  /api/reports/:metricKey            — قيمة المؤشر (من الكاش أو محسوبة).
//   POST /api/reports/:metricKey/refresh     — إعادة حساب يدوية (§7.3).
// التقييد بالنطاق يُفرض داخل metricsService عبر صلاحية المؤشر — لا تقييد يدوي هنا.
// مُركّب خلف requireAuth في index.ts.
// ============================================================

import { Router, type Request, type Response } from 'express';
import type { AuthUser } from '../middleware/auth.js';
import { getOrBuildAuthContext } from '../middleware/permission.js';
import { getMetric, ReportingError, type GetMetricParams } from '../services/reporting/metricsService.js';
import { getBreakdown } from '../services/reporting/breakdownService.js';
import { buildVisibleReportCatalog } from '../services/reporting/tabularReportCatalog.js';
import { exportTabularReportRun, generateTabularReport, getTabularReportFilterOptions, getTabularReportRun } from '../services/reporting/tabularReportService.js';

const router = Router();

function readParams(req: Request): GetMetricParams {
  return {
    preset: typeof req.query.preset === 'string' ? req.query.preset : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    branchId: typeof req.query.branchId === 'string' ? req.query.branchId : undefined,
  };
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof ReportingError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[reports] request failed:', err);
  res.status(500).json({ error: 'فشل تجهيز بيانات التقرير' });
}

function readTabularParams(req: Request) {
  return {
    branchId: typeof req.query.branchId === 'string' ? req.query.branchId : undefined,
    employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
    supervisorEmployeeId: typeof req.query.supervisorEmployeeId === 'string' ? req.query.supervisorEmployeeId : undefined,
    technicianEmployeeId: typeof req.query.technicianEmployeeId === 'string' ? req.query.technicianEmployeeId : undefined,
    telemarketerUserId: typeof req.query.telemarketerUserId === 'string' ? req.query.telemarketerUserId : undefined,
    visitStatus: typeof req.query.visitStatus === 'string' ? req.query.visitStatus : undefined,
    taskType: typeof req.query.taskType === 'string' ? req.query.taskType : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    deviceModelId: typeof req.query.deviceModelId === 'string' ? req.query.deviceModelId : undefined,
    deviceModel: typeof req.query.deviceModel === 'string' ? req.query.deviceModel : undefined,
    deviceStatus: typeof req.query.deviceStatus === 'string' ? req.query.deviceStatus : undefined,
    warrantyStatus: typeof req.query.warrantyStatus === 'string' ? req.query.warrantyStatus : undefined,
    customerRating: typeof req.query.customerRating === 'string' ? req.query.customerRating : undefined,
    contactEmployeeId: typeof req.query.contactEmployeeId === 'string' ? req.query.contactEmployeeId : undefined,
    lastContactChannel: typeof req.query.lastContactChannel === 'string' ? req.query.lastContactChannel : undefined,
    replacedParts: typeof req.query.replacedParts === 'string' ? req.query.replacedParts : undefined,
    minPaidAmount: typeof req.query.minPaidAmount === 'string' ? req.query.minPaidAmount : undefined,
    maxPaidAmount: typeof req.query.maxPaidAmount === 'string' ? req.query.maxPaidAmount : undefined,
    installationFrom: typeof req.query.installationFrom === 'string' ? req.query.installationFrom : undefined,
    installationTo: typeof req.query.installationTo === 'string' ? req.query.installationTo : undefined,
    periodicMaintenanceFrom: typeof req.query.periodicMaintenanceFrom === 'string' ? req.query.periodicMaintenanceFrom : undefined,
    periodicMaintenanceTo: typeof req.query.periodicMaintenanceTo === 'string' ? req.query.periodicMaintenanceTo : undefined,
    completedVisitFrom: typeof req.query.completedVisitFrom === 'string' ? req.query.completedVisitFrom : undefined,
    completedVisitTo: typeof req.query.completedVisitTo === 'string' ? req.query.completedVisitTo : undefined,
    lastContactFrom: typeof req.query.lastContactFrom === 'string' ? req.query.lastContactFrom : undefined,
    lastContactTo: typeof req.query.lastContactTo === 'string' ? req.query.lastContactTo : undefined,
    incompleteVisitFrom: typeof req.query.incompleteVisitFrom === 'string' ? req.query.incompleteVisitFrom : undefined,
    incompleteVisitTo: typeof req.query.incompleteVisitTo === 'string' ? req.query.incompleteVisitTo : undefined,
    geoUnitId: typeof req.query.geoUnitId === 'string' ? req.query.geoUnitId : undefined,
    geoIds: typeof req.query.geoIds === 'string' ? req.query.geoIds : undefined,
    fromDate: typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined,
    toDate: typeof req.query.toDate === 'string' ? req.query.toDate : undefined,
    saleType: typeof req.query.saleType === 'string' ? req.query.saleType : undefined,
    saleSubtype: typeof req.query.saleSubtype === 'string' ? req.query.saleSubtype : undefined,
    remainingBalance: typeof req.query.remainingBalance === 'string' ? req.query.remainingBalance : undefined,
    contractId: typeof req.query.contractId === 'string' ? req.query.contractId : undefined,
    deviceModelIds: typeof req.query.deviceModelIds === 'string' ? req.query.deviceModelIds : undefined,
    callOutcome: typeof req.query.callOutcome === 'string' ? req.query.callOutcome : undefined,
    departmentTypeId: typeof req.query.departmentTypeId === 'string' ? req.query.departmentTypeId : undefined,
    financialAsOfDate: typeof req.query.financialAsOfDate === 'string' ? req.query.financialAsOfDate : undefined,
    collectionOwnerId: typeof req.query.collectionOwnerId === 'string' ? req.query.collectionOwnerId : undefined,
    saleCloserUserId: typeof req.query.saleCloserUserId === 'string' ? req.query.saleCloserUserId : undefined,
    latestCollectionResult: typeof req.query.latestCollectionResult === 'string' ? req.query.latestCollectionResult : undefined,
    opFrom: typeof req.query.opFrom === 'string' ? req.query.opFrom : undefined,
    opTo: typeof req.query.opTo === 'string' ? req.query.opTo : undefined,
    contractFrom: typeof req.query.contractFrom === 'string' ? req.query.contractFrom : undefined,
    contractTo: typeof req.query.contractTo === 'string' ? req.query.contractTo : undefined,
    giftDeliveryFrom: typeof req.query.giftDeliveryFrom === 'string' ? req.query.giftDeliveryFrom : undefined,
    giftDeliveryTo: typeof req.query.giftDeliveryTo === 'string' ? req.query.giftDeliveryTo : undefined,
    giftConditionStatus: typeof req.query.giftConditionStatus === 'string' ? req.query.giftConditionStatus : undefined,
    giftDeliveryResult: typeof req.query.giftDeliveryResult === 'string' ? req.query.giftDeliveryResult : undefined,
    giftDefinitionId: typeof req.query.giftDefinitionId === 'string' ? req.query.giftDefinitionId : undefined,
    page: typeof req.query.page === 'string' ? req.query.page : undefined,
    limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
  };
}

// ── كتالوج وتقارير جدولية — قبل /:metricKey حتى لا تُفسّر كأسماء مؤشرات ──
router.get('/catalog', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    res.json({ groups: buildVisibleReportCatalog(authContext) });
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/tabular/:reportKey/filter-options', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getTabularReportFilterOptions(authContext, req.params.reportKey, readTabularParams(req));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/tabular/:reportKey/generate', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const input = req.body ?? {};
    const data = await generateTabularReport(authContext, req.params.reportKey, {
      branchId: input.branchId, employeeId: input.employeeId,
      supervisorEmployeeId: input.supervisorEmployeeId, technicianEmployeeId: input.technicianEmployeeId,
      telemarketerUserId: input.telemarketerUserId, visitStatus: input.visitStatus,
      taskType: input.taskType,
      search: input.search, deviceModelId: input.deviceModelId, deviceModel: input.deviceModel, deviceStatus: input.deviceStatus,
      warrantyStatus: input.warrantyStatus, customerRating: input.customerRating,
      contactEmployeeId: input.contactEmployeeId, lastContactChannel: input.lastContactChannel,
      replacedParts: input.replacedParts, minPaidAmount: input.minPaidAmount, maxPaidAmount: input.maxPaidAmount,
      installationFrom: input.installationFrom, installationTo: input.installationTo,
      periodicMaintenanceFrom: input.periodicMaintenanceFrom, periodicMaintenanceTo: input.periodicMaintenanceTo,
      completedVisitFrom: input.completedVisitFrom, completedVisitTo: input.completedVisitTo,
      lastContactFrom: input.lastContactFrom, lastContactTo: input.lastContactTo,
      incompleteVisitFrom: input.incompleteVisitFrom, incompleteVisitTo: input.incompleteVisitTo,
      geoUnitId: input.geoUnitId, geoIds: input.geoIds,
      fromDate: input.fromDate, toDate: input.toDate,
      page: input.page, limit: input.limit,
      sortKey: input.sortKey, sortDir: input.sortDir,
      candidateNameSearch: input.candidateNameSearch, candidateSourceType: input.candidateSourceType,
      candidateStatus: input.candidateStatus, candidateOutcome: input.candidateOutcome,
      candidateDuplicateStatus: input.candidateDuplicateStatus,
      candidateAddedFrom: input.candidateAddedFrom, candidateAddedTo: input.candidateAddedTo,
      referralSheetNumber: input.referralSheetNumber,
      referralSheetFrom: input.referralSheetFrom, referralSheetTo: input.referralSheetTo,
      mediatorName: input.mediatorName, mediatorType: input.mediatorType,
      mediatorVisitFrom: input.mediatorVisitFrom, mediatorVisitTo: input.mediatorVisitTo,
      accompanyingTechnicianId: input.accompanyingTechnicianId,
      giftPromiseStatus: input.giftPromiseStatus, occupation: input.occupation,
      contractStatus: input.contractStatus, sellerEmployeeId: input.sellerEmployeeId,
      sellerDepartmentTypeId: input.sellerDepartmentTypeId,
      paymentType: input.paymentType, executionStage: input.executionStage,
      saleType: input.saleType, saleSubtype: input.saleSubtype,
      remainingBalance: input.remainingBalance, contractId: input.contractId,
      deviceModelIds: input.deviceModelIds, departmentTypeId: input.departmentTypeId,
      callOutcome: input.callOutcome,
      financialAsOfDate: input.financialAsOfDate,
      collectionOwnerId: input.collectionOwnerId,
      saleCloserUserId: input.saleCloserUserId,
      latestCollectionResult: input.latestCollectionResult,
      opFrom: input.opFrom, opTo: input.opTo,
      contractFrom: input.contractFrom, contractTo: input.contractTo,
      giftDeliveryFrom: input.giftDeliveryFrom, giftDeliveryTo: input.giftDeliveryTo,
      giftConditionStatus: input.giftConditionStatus,
      giftDeliveryResult: input.giftDeliveryResult,
      giftDefinitionId: input.giftDefinitionId,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(202).json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/tabular/runs/:runId', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getTabularReportRun(authContext, req.params.runId, readTabularParams(req));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) { handleError(err, res); }
});

router.get('/tabular/runs/:runId/export', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const output = await exportTabularReportRun(authContext, req.params.runId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${output.filename}"`);
    res.setHeader('X-Report-Exported-At', output.exportedAt.toISOString());
    res.download(output.filePath, output.filename, err => {
      void output.cleanup();
      if (err && !res.headersSent) handleError(err, res);
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ── المؤشرات التجميعية (Funnel/Bar/Donut) — مسار مستقل بمقطعين فلا يتصادم مع /:metricKey ──
router.get('/breakdown/:metricKey', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getBreakdown(authContext, req.params.metricKey, readParams(req));
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/breakdown/:metricKey/refresh', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getBreakdown(authContext, req.params.metricKey, { ...readParams(req), forceRefresh: true });
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/:metricKey', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getMetric(authContext, req.params.metricKey, readParams(req));
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/:metricKey/refresh', async (req, res) => {
  try {
    const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
    const data = await getMetric(authContext, req.params.metricKey, { ...readParams(req), forceRefresh: true });
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

export default router;
