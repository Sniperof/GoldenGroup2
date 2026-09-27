import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { supervisorAlertAccessPlan } from './supervisorAlertPolicy.js';

function context(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 7,
    roleId: 2,
    isSuperAdmin: false,
    grants: [{ permission: 'tasks.supervisor_alerts.view', scope: 'BRANCH' }],
    allowedBranchIds: [6],
    actingBranchId: 6,
    ...overrides,
  };
}

test('alerts require the capability and a selected branch', () => {
  assert.equal(supervisorAlertAccessPlan(context({ grants: [] })), null);
  assert.deepEqual(supervisorAlertAccessPlan(context({ grants: [{ permission: 'tasks.supervisor_alerts.view', scope: 'ASSIGNED' }] })), { branchId: 6, scope: 'ASSIGNED', userId: 7 });
  assert.equal(supervisorAlertAccessPlan(context({ actingBranchId: null })), null);
  assert.deepEqual(supervisorAlertAccessPlan(context({ actingBranchId: 6 })), { branchId: 6, scope: 'BRANCH', userId: 7 });
});

test('branch scope rejects an unassigned branch, including multi-branch users', () => {
  assert.equal(supervisorAlertAccessPlan(context({ actingBranchId: 9 })), null);
  assert.deepEqual(supervisorAlertAccessPlan(context({ allowedBranchIds: [6, 9], actingBranchId: 9 })), { branchId: 9, scope: 'BRANCH', userId: 7 });
  assert.equal(supervisorAlertAccessPlan(context({ grants: [{ permission: 'tasks.supervisor_alerts.view', scope: 'ASSIGNED' }], actingBranchId: 9 })), null);
});

test('global and super-admin paths use only the chosen branch', () => {
  assert.deepEqual(supervisorAlertAccessPlan(context({ grants: [{ permission: 'tasks.supervisor_alerts.view', scope: 'GLOBAL' }], actingBranchId: 9 })), { branchId: 9, scope: 'GLOBAL', userId: 7 });
  assert.deepEqual(supervisorAlertAccessPlan(context({ isSuperAdmin: true, grants: [], actingBranchId: 9 })), { branchId: 9, scope: 'GLOBAL', userId: 7 });
});
