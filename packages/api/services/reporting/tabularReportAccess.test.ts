import assert from 'node:assert/strict';
import test from 'node:test';
import type { ListAccessPlan } from '@golden-crm/shared';
import { ReportingError } from './reportingError.js';
import { resolveAccessPlan, resolveTabularExportAccess } from './tabularReportAccess.js';

function plan(scope: ListAccessPlan['scope'], allowedBranchIds = [3, 7]): ListAccessPlan {
  return { scope, allowedBranchIds, userId: 42 };
}

test('GLOBAL report access may drill down to one requested branch', () => {
  assert.deepEqual(resolveAccessPlan(plan('GLOBAL'), 9), {
    scope: 'BRANCH', grantedScope: 'GLOBAL', branchIds: [9], userId: 42,
  });
});

test('BRANCH report access rejects an unassigned branch', () => {
  assert.throws(
    () => resolveAccessPlan(plan('BRANCH'), 9),
    (error: unknown) => error instanceof ReportingError && error.status === 403,
  );
});

test('BRANCH report access keeps the active assigned branch set', () => {
  assert.deepEqual(resolveAccessPlan(plan('BRANCH'), null), {
    scope: 'BRANCH', grantedScope: 'BRANCH', branchIds: [3, 7], userId: 42,
  });
});

test('ASSIGNED report access keeps both branch and personal boundaries', () => {
  assert.deepEqual(resolveAccessPlan(plan('ASSIGNED'), null), {
    scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [3, 7], userId: 42,
  });
});

test('missing report permission is denied by default', () => {
  assert.throws(
    () => resolveAccessPlan(plan('NONE'), null),
    (error: unknown) => error instanceof ReportingError && error.status === 403,
  );
});

test('export can never be broader than the report view permission', () => {
  const authContext = {
    userId: 42,
    roleId: 8,
    isSuperAdmin: false,
    grants: [
      { permission: 'reports.work_files.geo_supervisors.view', scope: 'ASSIGNED' as const },
      { permission: 'reports.work_files.geo_supervisors.export', scope: 'BRANCH' as const },
    ],
    allowedBranchIds: [3, 7],
    actingBranchId: 3,
  };
  assert.deepEqual(resolveTabularExportAccess(
    authContext,
    'reports.work_files.geo_supervisors.view',
    'reports.work_files.geo_supervisors.export',
    {},
  ), {
    scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [3, 7], userId: 42,
  });
});

test('export is denied when export exists but report view is missing', () => {
  const authContext = {
    userId: 42,
    roleId: 8,
    isSuperAdmin: false,
    grants: [{ permission: 'reports.work_files.geo_supervisors.export', scope: 'BRANCH' as const }],
    allowedBranchIds: [3],
    actingBranchId: 3,
  };
  assert.throws(
    () => resolveTabularExportAccess(
      authContext,
      'reports.work_files.geo_supervisors.view',
      'reports.work_files.geo_supervisors.export',
      {},
    ),
    (error: unknown) => error instanceof ReportingError && error.status === 403,
  );
});
