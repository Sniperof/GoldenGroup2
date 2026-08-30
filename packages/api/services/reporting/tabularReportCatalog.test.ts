import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { buildVisibleReportCatalog } from './tabularReportCatalog.js';

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

test('daily visits report is a separate daily-work capability with required dates', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.daily_work.visits_log.view', scope: 'GLOBAL' },
    { permission: 'reports.daily_work.visits_log.export', scope: 'GLOBAL' },
  ]));
  assert.equal(catalog[0]?.key, 'daily_work');
  assert.equal(catalog[0]?.reports[0]?.key, 'daily_work.visits_log');
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

test('geographic portfolio report exposes the agreed current geographic columns under performance', () => {
  const catalog = buildVisibleReportCatalog(context([
    { permission: 'reports.performance.geographic_portfolio.view', scope: 'GLOBAL' },
    { permission: 'reports.performance.geographic_portfolio.export', scope: 'GLOBAL' },
  ]));
  const report = catalog.flatMap(group => group.reports).find(item => item.key === 'performance.geographic_portfolio');
  assert.ok(report);
  assert.equal(report.groupKey, 'performance');
  assert.equal(report.filters.dateRange, 'none');
  assert.equal(report.filters.geography, true);
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
  assert.equal(report.groupKey, 'performance');
  assert.equal(report.grain, 'نتيجة مهمة منفذة واحدة');
  assert.equal(report.filters.dateRange, 'required');
  assert.equal(report.filters.geography, true);
  assert.equal(report.filters.supervisor, true);
  assert.equal(report.filters.technician, true);
  assert.equal(report.filters.taskType, true);
  assert.equal(report.filters.search, false);
  assert.equal(report.columns[0].key, 'branchName');
  assert.deepEqual(report.columns.slice(1).map(column => column.key), [
    'supervisorName', 'technicianName', 'customerName', 'governorateName', 'regionName',
    'subareaName', 'neighborhoodName', 'taskType', 'executedDate', 'resultNotes',
  ]);

  const assigned = buildVisibleReportCatalog(context([
    { permission: 'reports.performance.sales_follow_up_tasks.view', scope: 'ASSIGNED' },
  ])).flatMap(group => group.reports).find(item => item.key === report.key);
  assert.ok(assigned);
  assert.equal(assigned.columns.some(column => column.key === 'branchName'), false);
});
