import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canCreateTelemarketingServiceTask } from './telemarketingServiceTaskPolicy.js';

function context(options: {
  scope?: ScopeType;
  allowedBranchIds?: number[];
  isSuperAdmin?: boolean;
}): AuthContext {
  return {
    userId: 8,
    roleId: 2,
    isSuperAdmin: options.isSuperAdmin === true,
    actingBranchId: 3,
    allowedBranchIds: options.allowedBranchIds ?? [3],
    grants: options.scope
      ? [{ permission: 'telemarketing.calls.create', scope: options.scope }]
      : [],
  } as AuthContext;
}

test('denies missing permission, wrong branch and an unassigned subject', () => {
  assert.equal(
    canCreateTelemarketingServiceTask(context({}), { branchId: 3, assignedUserIds: [8] }).allowed,
    false,
  );
  assert.equal(
    canCreateTelemarketingServiceTask(
      context({ scope: 'BRANCH', allowedBranchIds: [3] }),
      { branchId: 5, assignedUserIds: [8] },
    ).allowed,
    false,
  );
  assert.equal(
    canCreateTelemarketingServiceTask(
      context({ scope: 'ASSIGNED', allowedBranchIds: [3] }),
      { branchId: 3, assignedUserIds: [] },
    ).allowed,
    false,
  );
});

test('allows GLOBAL, matching BRANCH, assigned ASSIGNED and super-admin access', () => {
  assert.equal(
    canCreateTelemarketingServiceTask(context({ scope: 'GLOBAL' }), { branchId: 9, assignedUserIds: [] }).allowed,
    true,
  );
  assert.equal(
    canCreateTelemarketingServiceTask(
      context({ scope: 'BRANCH', allowedBranchIds: [3] }),
      { branchId: 3, assignedUserIds: [] },
    ).allowed,
    true,
  );
  assert.equal(
    canCreateTelemarketingServiceTask(
      context({ scope: 'ASSIGNED', allowedBranchIds: [3] }),
      { branchId: 3, assignedUserIds: [8] },
    ).allowed,
    true,
  );
  assert.equal(
    canCreateTelemarketingServiceTask(context({ isSuperAdmin: true }), { branchId: 99, assignedUserIds: [] }).allowed,
    true,
  );
});
