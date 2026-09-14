import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, PermissionGrant } from '@golden-crm/shared';
import { canCreateContractFromVisit } from './contractCreationPolicy.js';

function context(grants: PermissionGrant[], options: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 7,
    roleId: 2,
    isSuperAdmin: false,
    actingBranchId: 6,
    allowedBranchIds: [6],
    grants,
    ...options,
  };
}

const visit = {
  branch_id: 6,
  team_responsible_user_id: 7,
  team_snapshot: { supervisorEmployeeId: 31, technicianEmployeeId: 44 },
  reassigned_supervisor_id: null,
  reassigned_technician_id: null,
  reassigned_trainee_id: null,
};

test('assigned supervisor can use the visit as contract creation context', () => {
  const result = canCreateContractFromVisit(
    context([{ permission: 'contracts.create', scope: 'BRANCH' }]),
    visit,
    31,
  );
  assert.equal(result.allowed, true);
});

test('effective reassigned supervisor replaces the original supervisor', () => {
  const auth = context([{ permission: 'contracts.create', scope: 'BRANCH' }]);
  const reassigned = { ...visit, reassigned_supervisor_id: 72 };

  assert.equal(canCreateContractFromVisit(auth, reassigned, 72).allowed, true);
  assert.equal(canCreateContractFromVisit(auth, reassigned, 31).allowed, false);
});

test('visit manager can use the context without being the assigned supervisor', () => {
  const result = canCreateContractFromVisit(
    context([
      { permission: 'contracts.create', scope: 'BRANCH' },
      { permission: 'field_visits.edit', scope: 'BRANCH' },
    ]),
    visit,
    99,
  );
  assert.equal(result.allowed, true);
});

test('missing contract permission, wrong branch, and unassigned actor fail closed', () => {
  assert.equal(canCreateContractFromVisit(context([]), visit, 31).allowed, false);
  assert.equal(
    canCreateContractFromVisit(
      context([{ permission: 'contracts.create', scope: 'BRANCH' }]),
      { ...visit, branch_id: 9 },
      31,
    ).allowed,
    false,
  );
  assert.equal(
    canCreateContractFromVisit(
      context([{ permission: 'contracts.create', scope: 'BRANCH' }]),
      visit,
      99,
    ).reason,
    'ASSIGNMENT_FORBIDDEN',
  );
});

test('super admin remains an explicit bypass', () => {
  assert.equal(
    canCreateContractFromVisit(context([], { isSuperAdmin: true }), { ...visit, branch_id: 99 }, null).allowed,
    true,
  );
});
