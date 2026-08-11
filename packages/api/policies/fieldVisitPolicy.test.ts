import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import {
  canEditFieldVisit,
  canViewFieldVisit,
  canViewFieldVisitOrOwn,
  getFieldVisitListAccessPlan,
  MY_VISITS_PERMISSION,
} from './fieldVisitPolicy.js';

function context(options: {
  permission?: string;
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
    grants: options.permission && options.scope
      ? [{ permission: options.permission, scope: options.scope }]
      : [],
  };
}

const ownVisit = {
  branch_id: 6,
  team_snapshot: {
    supervisorEmployeeId: '31',
    technicianEmployeeId: 44,
  },
  reassigned_supervisor_id: null,
  reassigned_technician_id: null,
  reassigned_trainee_id: null,
};

test('my-visits permission allows supporting reads only for an actual team member', () => {
  const assigned = context({ permission: MY_VISITS_PERMISSION, scope: 'ASSIGNED' });

  assert.equal(canViewFieldVisitOrOwn(assigned, ownVisit, 31).allowed, true);
  assert.equal(canViewFieldVisitOrOwn(assigned, ownVisit, 44).allowed, true);
  assert.deepEqual(
    canViewFieldVisitOrOwn(assigned, ownVisit, 99),
    {
      allowed: false,
      reason: 'ASSIGNMENT_FORBIDDEN',
      grant: { permission: MY_VISITS_PERMISSION, scope: 'ASSIGNED' },
    },
  );
});

test('reassignment replaces the matching snapshot team slot', () => {
  const assigned = context({ permission: MY_VISITS_PERMISSION, scope: 'ASSIGNED' });
  const reassignedVisit = { ...ownVisit, reassigned_supervisor_id: 72 };

  assert.equal(canViewFieldVisitOrOwn(assigned, reassignedVisit, 72).allowed, true);
  assert.equal(canViewFieldVisitOrOwn(assigned, reassignedVisit, 31).allowed, false);
});

test('my-visits permission still enforces the visit branch', () => {
  const assigned = context({
    permission: MY_VISITS_PERMISSION,
    scope: 'ASSIGNED',
    allowedBranchIds: [6],
  });

  assert.equal(
    canViewFieldVisitOrOwn(assigned, { ...ownVisit, branch_id: 9 }, 31).allowed,
    false,
  );
});

test('management GLOBAL, BRANCH, and super-admin paths remain explicit', () => {
  const globalView = context({ permission: 'field_visits.view', scope: 'GLOBAL' });
  const branchView = context({ permission: 'field_visits.view', scope: 'BRANCH' });
  const globalEdit = context({ permission: 'field_visits.edit', scope: 'GLOBAL' });
  const branchEdit = context({ permission: 'field_visits.edit', scope: 'BRANCH' });
  const superAdmin = context({ isSuperAdmin: true });

  assert.equal(canViewFieldVisitOrOwn(globalView, { ...ownVisit, branch_id: 9 }, null).allowed, true);
  assert.equal(canViewFieldVisitOrOwn(branchView, ownVisit, null).allowed, true);
  assert.equal(
    canViewFieldVisitOrOwn(branchView, { ...ownVisit, branch_id: 9 }, null).allowed,
    false,
  );
  assert.equal(canEditFieldVisit(globalEdit, 9, 99).allowed, true);
  assert.equal(canEditFieldVisit(branchEdit, 6, 99).allowed, true);
  assert.equal(canEditFieldVisit(branchEdit, 9, 99).allowed, false);
  assert.equal(canViewFieldVisitOrOwn(superAdmin, { ...ownVisit, branch_id: 9 }, null).allowed, true);
  assert.equal(canEditFieldVisit(superAdmin, 9, null).allowed, true);
});

test('invalid ASSIGNED management grants fail closed for records and lists', () => {
  const invalidView = context({ permission: 'field_visits.view', scope: 'ASSIGNED' });
  const invalidEdit = context({ permission: 'field_visits.edit', scope: 'ASSIGNED' });

  assert.equal(canViewFieldVisit(invalidView, 6).allowed, false);
  assert.equal(getFieldVisitListAccessPlan(invalidView).scope, 'NONE');
  assert.deepEqual(getFieldVisitListAccessPlan(invalidView).allowedBranchIds, []);
  assert.equal(canEditFieldVisit(invalidEdit, 6, invalidEdit.userId).allowed, false);
});

test('missing permissions deny both management and personal access', () => {
  const missing = context({});
  assert.equal(canViewFieldVisitOrOwn(missing, ownVisit, 31).allowed, false);
  assert.equal(getFieldVisitListAccessPlan(missing).scope, 'NONE');
});
