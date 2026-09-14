import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { AuthContext } from '@golden-crm/shared';
import { REPORT_GROUPS, TABULAR_REPORTS, buildVisibleReportCatalog } from './tabularReportCatalog.js';

function context(permissions: Array<{ permission: string; scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED' }>): AuthContext {
  return {
    userId: 42,
    roleId: 8,
    isSuperAdmin: false,
    grants: permissions,
    allowedBranchIds: [3],
    actingBranchId: 3,
  };
}

test('catalog hides report groups when the view permission is missing', () => {
  assert.deepEqual(buildVisibleReportCatalog(context([])), []);
});

test('catalog exposes export only when the separate export permission exists', () => {
  const viewOnly = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.geo_supervisors.view', scope: 'BRANCH' },
  ]));
  assert.equal(viewOnly[0]?.reports[0]?.canExport, false);

  const withExport = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.geo_supervisors.view', scope: 'BRANCH' },
    { permission: 'reports.work_files.geo_supervisors.export', scope: 'ASSIGNED' },
  ]));
  assert.equal(withExport[0]?.reports[0]?.canExport, true);
  assert.equal(withExport[0]?.reports[0]?.exportScope, 'ASSIGNED');
});

test('catalog advertises the intersection when export is broader than view', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.geo_supervisors.view', scope: 'ASSIGNED' },
    { permission: 'reports.work_files.geo_supervisors.export', scope: 'GLOBAL' },
  ]));
  assert.equal(catalog[0]?.reports[0]?.exportScope, 'ASSIGNED');
});

test('GLOBAL viewers receive the branch column while narrower viewers do not', () => {
  const global = buildVisibleReportCatalog(context([{ permission: 'reports.work_files.geo_supervisors.view', scope: 'GLOBAL' }]));
  const branch = buildVisibleReportCatalog(context([{ permission: 'reports.work_files.geo_supervisors.view', scope: 'BRANCH' }]));
  assert.equal(global[0]?.reports[0]?.columns[0]?.key, 'branchName');
  assert.equal(branch[0]?.reports[0]?.columns.some(column => column.key === 'branchName'), false);
});

test('the geo-supervisors report offers the row subject as a filter, not only as a column', () => {
  const report = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.geo_supervisors.view', scope: 'BRANCH' },
  ])).flatMap(group => group.reports).find(item => item.key === 'work_files.geo_supervisors');

  assert.ok(report);
  // The row IS a supervisor in an area, so «المشرفة» is the report's primary filter.
  // The query supported it from the start; only the catalogue kept it switched off,
  // which left the UI with a single geography dropdown for the whole report.
  assert.equal(report.filters.supervisor, true);
  assert.equal(report.filters.departmentType, true);
  assert.equal(report.filters.accompanyingTechnician, true);
  assert.deepEqual(report.filters.dateRanges?.map(range => range.fromKey), ['lastVisitFrom']);
  assert.ok(report.columns.some(column => column.key === 'departmentName'));
  assert.ok(report.guide.columnDescriptions.departmentName);
});

test('daily visits report appears under work files with required dates', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.daily_work.visits_log.view', scope: 'GLOBAL' },
    { permission: 'reports.daily_work.visits_log.export', scope: 'GLOBAL' },
  ]));
  assert.equal(catalog[0]?.key, 'work_files');
  assert.equal(catalog[0]?.reports[0]?.key, 'daily_work.visits_log');
  assert.equal(catalog[0]?.reports[0]?.title, 'جدول المواعيد اليومي');
  assert.equal(catalog[0]?.reports[0]?.grain, 'زيارة واحدة');
  assert.equal(catalog[0]?.reports[0]?.filters.dateRange, 'required');
  assert.equal(catalog[0]?.reports[0]?.filters.supervisor, true);
  assert.equal(catalog[0]?.reports[0]?.filters.technician, true);
  assert.equal(catalog[0]?.reports[0]?.filters.telemarketer, true);
  assert.equal(catalog[0]?.reports[0]?.filters.visitStatus, true);
  assert.equal(catalog[0]?.reports[0]?.columns[0]?.key, 'branchName');
  assert.equal(catalog[0]?.reports[0]?.columns.some(column => column.key === 'primaryContactNumber'), true);
  assert.equal(catalog[0]?.reports[0]?.columns.some(column => column.key === 'taskType'), false);
});

test('service devices report supports GLOBAL and BRANCH only with the agreed device columns', () => {
  const globalCatalog = buildVisibleReportCatalog(context([
    { permission: 'reports.service.installed_devices.view', scope: 'GLOBAL' },
    { permission: 'reports.service.installed_devices.export', scope: 'GLOBAL' },
  ]));
  const report = globalCatalog.flatMap(group => group.reports).find(item => item.key === 'service.installed_devices');
  assert.ok(report);
  assert.equal(report.viewScope, 'GLOBAL');
  assert.equal(report.columns[0].key, 'branchName');
  for (const key of ['governorateName', 'regionName', 'subareaName', 'neighborhoodName', 'whatsappMessage']) {
    assert.ok(report.columns.some(column => column.key === key));
  }
  assert.ok(report.columns.some(column => column.key === 'paidAmount' && column.type === 'decimal'));

  const assignedCatalog = buildVisibleReportCatalog(context([
    { permission: 'reports.service.installed_devices.view', scope: 'ASSIGNED' },
  ]));
  assert.equal(assignedCatalog.flatMap(group => group.reports).some(item => item.key === 'service.installed_devices'), false);
});

test('device faults report carries its geography, identifier search, and structured filters', () => {
  const report = buildVisibleReportCatalog(context([
    { permission: 'reports.service.installed_devices.view', scope: 'GLOBAL' },
    { permission: 'reports.service.installed_devices.export', scope: 'GLOBAL' },
  ])).flatMap(group => group.reports).find(item => item.key === 'service.device_faults');

  assert.ok(report);
  assert.equal(report.groupKey, 'service');
  assert.equal(report.title, 'تقرير الأعطال');
  assert.equal(report.grain, 'عطل واحد مسجل على جهاز');
  assert.equal(report.filters.dateRange, 'required');
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.search, true);
  assert.equal(report.filters.deviceModel, true);
  assert.equal(report.filters.faultType, true);
  assert.equal(report.filters.faultStatus, true);
  assert.equal(report.filters.faultDiscoveryPhase, true);
  assert.equal(report.filters.repairTechnician, true);
  assert.equal(report.filters.visitTechnician, true);
  assert.equal(report.filters.faultDuration, true);
  assert.equal(report.filters.faultPartsUsage, true);
  assert.deepEqual(report.filters.dateRanges?.map(range => range.fromKey), ['faultResolvedFrom']);
  for (const key of [
    'faultType', 'faultDetails', 'faultStatus', 'unresolvedReason', 'resolvedDate',
    'repairTechnicianName', 'resolutionNotes', 'partsUsedSummary', 'resolutionDurationDays',
  ]) assert.ok(report.columns.some(column => column.key === key), key);

  const assigned = buildVisibleReportCatalog(context([
    { permission: 'reports.service.installed_devices.view', scope: 'ASSIGNED' },
  ])).flatMap(group => group.reports).find(item => item.key === 'service.device_faults');
  assert.equal(assigned, undefined);
});

test('retrieved devices report contains successful withdrawal fields, geography, and retrieval path', () => {
  const report = buildVisibleReportCatalog(context([
    { permission: 'reports.service.installed_devices.view', scope: 'GLOBAL' },
    { permission: 'reports.service.installed_devices.export', scope: 'GLOBAL' },
  ])).flatMap(group => group.reports).find(item => item.key === 'service.retrieved_devices');

  assert.ok(report);
  assert.equal(report.groupKey, 'service');
  assert.equal(report.title, 'تقرير الأجهزة المسحوبة للشركة');
  assert.equal(report.grain, 'عملية سحب ناجحة واحدة لجهاز');
  assert.equal(report.filters.dateRange, 'required');
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.search, true);
  assert.equal(report.filters.deviceModel, true);
  assert.equal(report.filters.retrievalPurpose, true);
  assert.equal(report.filters.retrievalTechnician, true);
  assert.equal(report.filters.retrievedDeviceStatus, true);
  assert.equal(report.filters.retrievalSource, true);
  assert.equal(report.filters.originBranch, true);
  for (const key of [
    'retrievalDate', 'customerName', 'governorateName', 'regionName', 'subareaName', 'neighborhoodName',
    'deviceModelName', 'serialNumber', 'retrievalPurpose', 'retrievalSource', 'originBranchName',
    'retrievalTechnicianName', 'currentDeviceStatus', 'disconnectionNotes', 'retrievalNotes',
  ]) assert.ok(report.columns.some(column => column.key === key), key);
});

test('geographic portfolio report exposes the agreed current geographic columns under work files', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.performance.geographic_portfolio.view', scope: 'GLOBAL' },
    { permission: 'reports.performance.geographic_portfolio.export', scope: 'GLOBAL' },
  ]));
  const report = catalog.flatMap(group => group.reports).find(item => item.key === 'performance.geographic_portfolio');
  assert.ok(report);
  assert.equal(report.groupKey, 'work_files');
  assert.equal(report.title, 'تقييم محطات المسارات حسب نوع الزبائن والأجهزة');
  assert.equal(report.filters.dateRange, 'none');
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.route, true);
  assert.equal(report.filters.areaEvaluation, true);
  assert.equal(report.filters.evaluationConfidence, true);
  assert.equal(report.filters.periodicPressure, true);
  assert.equal(report.columns[0].key, 'branchName');
  for (const key of [
    'governorateName', 'regionName', 'subareaName', 'totalCustomers', 'suggestedCustomers',
    'challengerDevices', 'aquanovaDevices', 'safeLifeDevices', 'otherDevices',
    'periodicDueTodayDevices', 'overduePeriodicDevices', 'areaEvaluation',
    'evaluationConfidence', 'evaluationCount', 'latestEvaluationDate',
  ]) assert.ok(report.columns.some(column => column.key === key), key);

  const assignedCatalog = buildVisibleReportCatalog(context([
    { permission: 'reports.performance.geographic_portfolio.view', scope: 'ASSIGNED' },
  ]));
  assert.equal(assignedCatalog.flatMap(group => group.reports).some(item => item.key === report.key), false);
});

test('sales follow-up task report exposes only visible task-result fields and all three scopes', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.performance.sales_follow_up_tasks.view', scope: 'GLOBAL' },
    { permission: 'reports.performance.sales_follow_up_tasks.export', scope: 'GLOBAL' },
  ]));
  const report = catalog.flatMap(group => group.reports).find(item => item.key === 'performance.sales_follow_up_tasks');
  assert.ok(report);
  assert.equal(report.groupKey, 'work_files');
  assert.equal(report.grain, 'نتيجة مهمة منفذة واحدة');
  assert.equal(report.filters.dateRange, 'required');
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.supervisor, true);
  assert.equal(report.filters.technician, true);
  assert.equal(report.filters.taskType, true);
  assert.equal(report.filters.taskResult, true);
  assert.equal(report.filters.search, false);
  assert.equal(report.columns[0].key, 'branchName');
  assert.deepEqual(report.columns.slice(1).map(column => column.key), [
    'supervisorName', 'technicianName', 'customerName', 'governorateName', 'regionName',
    'subareaName', 'neighborhoodName', 'taskType', 'taskResult', 'executedDate', 'resultNotes',
  ]);

  const assigned = buildVisibleReportCatalog(context([
    { permission: 'reports.performance.sales_follow_up_tasks.view', scope: 'ASSIGNED' },
  ])).flatMap(group => group.reports).find(item => item.key === report.key);
  assert.ok(assigned);
  assert.equal(assigned.columns.some(column => column.key === 'branchName'), false);
});

test('every report belongs to a group that exists, and every group has reports', () => {
  // A report whose group was removed would vanish from the catalogue in silence:
  // the builder renders only the groups it can match, so nothing would error.
  const groupKeys = new Set(REPORT_GROUPS.map(group => group.key));
  for (const report of TABULAR_REPORTS) {
    assert.ok(groupKeys.has(report.groupKey), `${report.key} points at a missing group: ${report.groupKey}`);
  }
  // And a group with no reports is dead configuration carrying a stale name.
  const usedGroups = new Set(TABULAR_REPORTS.map(report => report.groupKey));
  for (const group of REPORT_GROUPS) {
    if (group.key === 'human_resources') continue; // declared ahead of its reports
    assert.ok(usedGroups.has(group.key), `${group.key} has no reports`);
  }
});

test('the selected tabular reports are presented in the approved groups and order', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.geo_supervisors.view', scope: 'GLOBAL' },
    { permission: 'reports.daily_work.visits_log.view', scope: 'GLOBAL' },
    { permission: 'reports.service.installed_devices.view', scope: 'GLOBAL' },
    { permission: 'reports.performance.geographic_portfolio.view', scope: 'GLOBAL' },
    { permission: 'reports.performance.sales_follow_up_tasks.view', scope: 'GLOBAL' },
    { permission: 'reports.work_files.names_file.view', scope: 'GLOBAL' },
  ]));

  const workFiles = catalog.find(group => group.key === 'work_files');
  const service = catalog.find(group => group.key === 'service');
  assert.equal(workFiles?.title, 'ملفات العمل');
  assert.deepEqual(workFiles?.reports.map(report => report.title), [
    'نطاقات الملفات',
    'جدول المواعيد اليومي',
    'تقرير صيانات',
    'تقييم محطات المسارات حسب نوع الزبائن والأجهزة',
    'متابعة البيع — مهام العرض والخدمة',
    'ملف الأسماء',
  ]);
  assert.deepEqual(service?.reports.map(report => report.title), [
    'تقرير هدايا الوسطاء',
    'تقرير الأعطال',
    'تقرير الأجهزة المسحوبة للشركة',
  ]);
});

test('mediator gifts exposes converted OP rows and optional gift tracking filters', () => {
  const report = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.names_file.view', scope: 'GLOBAL' },
    { permission: 'reports.work_files.names_file.export', scope: 'GLOBAL' },
  ])).flatMap(group => group.reports).find(item => item.key === 'work_files.mediator_gifts');
  assert.ok(report);
  assert.equal(report.grain, 'اسم مرشح واحد تحول إلى زبون OP مع وسيطه');
  assert.equal(report.filters.search, false);
  assert.equal(report.filters.candidateSourceType, true);
  assert.equal(report.filters.mediatorType, true);
  assert.equal(report.filters.giftDefinition, true);
  assert.equal(report.filters.giftConditionStatus, true);
  assert.equal(report.filters.giftDeliveryResult, true);
  assert.deepEqual(report.filters.primaryDateRanges?.map(range => range.fromKey), ['opFrom']);
  for (const key of ['mediatorName', 'customerName', 'subareaName', 'neighborhoodName', 'giftSummary', 'giftDeliveredAt']) {
    assert.ok(report.columns.some(column => column.key === key), key);
  }
});

test('names file is a current candidate-grain report without deferred follow-up fields', () => {
  const report = buildVisibleReportCatalog(context([
    { permission: 'reports.work_files.names_file.view', scope: 'GLOBAL' },
    { permission: 'reports.work_files.names_file.export', scope: 'ASSIGNED' },
  ])).flatMap(group => group.reports).find(item => item.key === 'work_files.names_file');
  assert.ok(report);
  assert.equal(report.groupKey, 'work_files');
  assert.equal(report.grain, 'سجل اسم مقترح واحد');
  assert.equal(report.filters.dateRange, 'none');
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.candidateNameSearch, true);
  assert.equal(report.filters.candidateSourceType, true);
  assert.equal(report.filters.candidateStatus, true);
  assert.equal(report.filters.candidateOutcome, true);
  assert.equal(report.filters.candidateDuplicateStatus, true);
  assert.equal(report.filters.referralSheetNumber, true);
  assert.equal(report.filters.mediatorName, true);
  assert.equal(report.filters.mediatorType, true);
  assert.equal(report.filters.accompanyingTechnician, true);
  assert.equal(report.filters.giftPromiseStatus, true);
  assert.equal(report.filters.occupation, true);
  assert.deepEqual(report.filters.primaryDateRanges?.map(range => range.fromKey), ['candidateAddedFrom']);
  assert.deepEqual(report.filters.dateRanges?.map(range => range.fromKey), ['referralSheetFrom', 'mediatorVisitFrom']);
  assert.equal(report.columns[0].key, 'branchName');
  for (const key of ['sourceType', 'giftPromiseStatus', 'candidateOutcome', 'duplicateStatus', 'additionalContactNumbers']) {
    assert.ok(report.columns.some(column => column.key === key), key);
  }
  for (const key of ['lastContactAt', 'appointmentDate', 'visitResult', 'rescheduleContact']) {
    assert.equal(report.columns.some(column => column.key === key), false, key);
  }
  assert.equal(report.exportScope, 'ASSIGNED');
});

test('service dues exposes only open-installment fields and the approved historical filters', () => {
  const report = buildVisibleReportCatalog(context([
    { permission: 'reports.service.dues.view', scope: 'GLOBAL' },
    { permission: 'reports.service.dues.export', scope: 'GLOBAL' },
  ])).flatMap(group => group.reports).find(item => item.key === 'service.dues');

  assert.ok(report);
  assert.equal(report.groupKey, 'service');
  assert.equal(report.title, 'تقرير الاستحقاقات');
  assert.equal(report.grain, 'استحقاق مالي مفتوح واحد');
  assert.equal(report.filters.dateRange, 'required');
  assert.equal(report.filters.financialAsOfDate, true);
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.collectionOwner, true);
  assert.equal(report.filters.contractSeller, true);
  assert.equal(report.filters.saleCloser, true);
  assert.equal(report.filters.contractPaymentType, true);
  assert.equal(report.filters.latestCollectionResult, true);
  for (const key of ['dueDate', 'contractFinalValue', 'agreedPaymentType', 'lastPaymentMethod', 'installmentDueAmount', 'saleCloserName', 'latestCollectedAmount']) {
    assert.ok(report.columns.some(column => column.key === key), key);
  }
  assert.equal(report.columns.find(column => column.key === 'contractFinalValue')?.titleAr, 'قيمة العقد');
  assert.equal(report.columns.find(column => column.key === 'agreedPaymentType')?.titleAr, 'نظام السداد المتفق عليه');
  assert.equal(report.columns.find(column => column.key === 'lastPaymentMethod')?.titleAr, 'طريقة آخر دفعة');
  assert.equal(report.columns.some(column => column.titleAr.includes('تسكير مع')), false);
});

test('every filter a report declares is rendered and sent by the report page', () => {
  // A flag switched on in the catalogue but not wired in the page is a filter the
  // user is promised and never gets — the same failure mode as a filter the HTTP
  // layer drops. Both ends are checked here so neither can drift alone.
  const page = readFileSync('packages/web/src/pages/Reports.tsx', 'utf8');
  const declared = new Set<string>();
  for (const report of TABULAR_REPORTS) {
    for (const [flag, value] of Object.entries(report.filters)) {
      if (value === true) declared.add(flag);
    }
    for (const range of [...(report.filters.primaryDateRanges ?? []), ...(report.filters.dateRanges ?? [])]) {
      declared.add(range.fromKey);
      declared.add(range.toKey);
    }
  }
  // Named ranges are rendered generically from the definition, so their keys only
  // need to reach the request; the flags need a render site as well.
  const rangeKeys = new Set(TABULAR_REPORTS.flatMap(report =>
    [...(report.filters.primaryDateRanges ?? []), ...(report.filters.dateRanges ?? [])]
      .flatMap(range => [range.fromKey, range.toKey])));
  const missing = [...declared].filter(flag =>
    !rangeKeys.has(flag) && !page.includes(`filters.${flag}`));
  assert.deepEqual(missing, []);
  assert.match(page, /primaryDateRanges \?\? \[\]/);
  assert.match(page, /dateRanges \?\? \[\]/);
});

test('every scoped picker a report declares is fetched from the options endpoint', () => {
  const page = readFileSync('packages/web/src/pages/Reports.tsx', 'utf8');
  const service = readFileSync('packages/api/services/reporting/tabularReportService.ts', 'utf8');
  const gate = page.slice(
    page.indexOf('const FILTERS_NEEDING_SERVER_OPTIONS'),
    page.indexOf('const EXECUTION_STAGE_OPTIONS'),
  );
  // Reports whose pickers are server-scoped must have an options provider wired,
  // or the dropdown renders empty with no error to explain it.
  for (const report of TABULAR_REPORTS) {
    const needsOptions = Object.entries(report.filters)
      .some(([flag, value]) => value === true && gate.includes(`'${flag}'`));
    if (!needsOptions) continue;
    assert.ok(
      service.includes(`reportKey === '${report.key}'`),
      `${report.key} declares a scoped picker but has no filter-options provider`,
    );
  }
});
