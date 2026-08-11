import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canViewOpenTask, getOpenTaskListAccessPlan } from './openTaskPolicy.js';

function context(options: {
  scope?: ScopeType;
  allowedBranchIds?: number[];
  isSuperAdmin?: boolean;
}): AuthContext {
  return {
    userId: 7,
    roleId: 2,
    isSuperAdmin: options.isSuperAdmin === true,
    actingBranchId: 6,
    allowedBranchIds: options.allowedBranchIds ?? [6],
    grants: options.scope
      ? [{ permission: 'open_tasks.view', scope: options.scope }]
      : [],
  };
}

test('device task history denies a missing permission and an invalid ASSIGNED grant', () => {
  const missing = context({});
  const invalidAssigned = context({ scope: 'ASSIGNED' });

  assert.equal(canViewOpenTask(missing, 6).allowed, false);
  assert.equal(getOpenTaskListAccessPlan(missing).scope, 'NONE');
  assert.equal(canViewOpenTask(invalidAssigned, 6).allowed, false);
  assert.equal(getOpenTaskListAccessPlan(invalidAssigned).scope, 'NONE');
});

test('device task history enforces the device branch for BRANCH scope', () => {
  const branchViewer = context({ scope: 'BRANCH', allowedBranchIds: [6, 8] });

  assert.equal(canViewOpenTask(branchViewer, 6).allowed, true);
  assert.equal(canViewOpenTask(branchViewer, 8).allowed, true);
  assert.equal(canViewOpenTask(branchViewer, 9).allowed, false);
  assert.deepEqual(getOpenTaskListAccessPlan(branchViewer).allowedBranchIds, [6, 8]);
});

test('device task history preserves explicit GLOBAL and super-admin paths', () => {
  const globalViewer = context({ scope: 'GLOBAL', allowedBranchIds: [6] });
  const superAdmin = context({ isSuperAdmin: true, allowedBranchIds: [] });

  assert.equal(canViewOpenTask(globalViewer, 99).allowed, true);
  assert.equal(getOpenTaskListAccessPlan(globalViewer).scope, 'GLOBAL');
  assert.equal(canViewOpenTask(superAdmin, 99).allowed, true);
  assert.equal(getOpenTaskListAccessPlan(superAdmin).scope, 'GLOBAL');
});
