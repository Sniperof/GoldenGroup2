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
  assert.equal(catalog[0]?.reports[0]?.columns[0]?.key, 'branchName');
  assert.equal(catalog[0]?.reports[0]?.columns.some(column => column.key === 'primaryContactNumber'), true);
  assert.equal(catalog[0]?.reports[0]?.columns.some(column => column.key === 'taskType'), false);
});
