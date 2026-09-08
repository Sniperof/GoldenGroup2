import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ListAccessPlan } from '@golden-crm/shared';
import { ReportingError } from './reportingError.js';
import { readTabularReportRequestParams, resolveAccessPlan, resolveTabularExportAccess, resolveTabularReportAccess, TABULAR_REQUEST_PARAM_KEYS } from './tabularReportAccess.js';

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

test('a report that supports GLOBAL and BRANCH rejects an ASSIGNED grant', () => {
  const authContext = {
    userId: 42, roleId: 8, isSuperAdmin: false,
    grants: [{ permission: 'reports.service.installed_devices.view', scope: 'ASSIGNED' as const }],
    allowedBranchIds: [3], actingBranchId: 3,
  };
  assert.throws(
    () => resolveTabularReportAccess(
      authContext,
      'reports.service.installed_devices.view',
      {},
      ['GLOBAL', 'BRANCH'],
    ),
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

test('names-file permission covers GLOBAL BRANCH ASSIGNED and explicit super-admin paths', () => {
  for (const scope of ['GLOBAL', 'BRANCH', 'ASSIGNED'] as const) {
    const authContext = {
      userId: 42, roleId: 8, isSuperAdmin: false,
      grants: [{ permission: 'reports.work_files.names_file.view', scope }],
      allowedBranchIds: [3], actingBranchId: 3,
    };
    assert.equal(resolveTabularReportAccess(
      authContext, 'reports.work_files.names_file.view', {}, ['GLOBAL', 'BRANCH', 'ASSIGNED'],
    ).grantedScope, scope);
  }

  const superAdmin = {
    userId: 1, roleId: 1, isSuperAdmin: true, grants: [], allowedBranchIds: [], actingBranchId: null,
  };
  assert.equal(resolveTabularReportAccess(
    superAdmin, 'reports.work_files.names_file.view', {}, ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  ).scope, 'GLOBAL');
});

test('names-file permission rejects missing grant, wrong branch and unassigned candidate rows', () => {
  const missing = { userId: 42, roleId: 8, isSuperAdmin: false, grants: [], allowedBranchIds: [3], actingBranchId: 3 };
  assert.throws(
    () => resolveTabularReportAccess(missing, 'reports.work_files.names_file.view', {}, ['GLOBAL', 'BRANCH', 'ASSIGNED']),
    (error: unknown) => error instanceof ReportingError && error.status === 403,
  );

  const branch = {
    ...missing,
    grants: [{ permission: 'reports.work_files.names_file.view', scope: 'BRANCH' as const }],
  };
  assert.throws(
    () => resolveTabularReportAccess(branch, 'reports.work_files.names_file.view', { branchId: 9 }, ['GLOBAL', 'BRANCH', 'ASSIGNED']),
    (error: unknown) => error instanceof ReportingError && error.status === 403,
  );

  const assigned = {
    ...missing,
    grants: [{ permission: 'reports.work_files.names_file.view', scope: 'ASSIGNED' as const }],
  };
  const access = resolveTabularReportAccess(assigned, 'reports.work_files.names_file.view', {}, ['GLOBAL', 'BRANCH', 'ASSIGNED']);
  assert.equal(access.scope, 'ASSIGNED');
  assert.equal(access.userId, 42);
});

test('the request-param key list covers every field the interface declares', () => {
  // Guards the bug this list was introduced for: eleven fault and retrieval filter
  // fields existed on the interface and on the reports, but the HTTP layer never
  // forwarded them, so the user filtered and the report ignored it. A new field
  // added to the interface without a key here fails the build instead.
  const source = readFileSync(new URL('./tabularReportAccess.ts', import.meta.url), 'utf8');
  const body = source.slice(
    source.indexOf('export interface TabularReportRequestParams {'),
    source.indexOf('export const TABULAR_REQUEST_PARAM_KEYS'),
  );
  const declared = Array.from(body.matchAll(/^ {2}(\w+)\?:/gm)).map(match => match[1]);
  assert.ok(declared.length > 80, `expected the interface fields to be found, saw ${declared.length}`);
  const covered = new Set<string>(TABULAR_REQUEST_PARAM_KEYS);
  assert.deepEqual(declared.filter(field => !covered.has(field)), []);
});

test('the request reader keeps scalars and drops anything a report cannot validate', () => {
  const params = readTabularReportRequestParams({
    faultTypeId: '71', retrievalPurpose: 'maintenance', routeId: 4,
    geoIds: ['1', '2'], sortKey: { toString: () => 'x' }, unknownKey: 'dropped',
  });
  assert.deepEqual(params, { faultTypeId: '71', retrievalPurpose: 'maintenance', routeId: 4 });
});

test('the request reader survives a missing body', () => {
  assert.deepEqual(readTabularReportRequestParams(undefined), {});
});
