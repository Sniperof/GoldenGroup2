import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { hasCrossBranchReach } from '@golden-crm/shared';
import { authorize, defaultWriteBranchId, resolveActingBranch } from './authorizationService.js';

const GLOBAL_LIST = { permission: 'clients.view_list', scope: 'GLOBAL' as const };

function ctx(over: Partial<AuthContext>): AuthContext {
  return {
    userId: 15,
    roleId: 20,
    isSuperAdmin: false,
    grants: [],
    allowedBranchIds: [1002],
    actingBranchId: 1002,
    ...over,
  } as AuthContext;
}

test('reach = super admin or a GLOBAL *.view_list; GLOBAL lookups do not count', () => {
  assert.equal(hasCrossBranchReach(true, []), true);
  assert.equal(hasCrossBranchReach(false, [GLOBAL_LIST]), true);
  assert.equal(hasCrossBranchReach(false, [{ permission: 'reference_data.lookup', scope: 'GLOBAL' }]), false);
  assert.equal(hasCrossBranchReach(false, [{ permission: 'clients.view_list', scope: 'BRANCH' }]), false);
});

test('"all branches": a cross-branch actor has NO acting branch; a single-branch actor keeps theirs', () => {
  assert.equal(resolveActingBranch({ headerBranchId: null, primaryBranchId: 1002, allowedBranchIds: [1002], canReachAnyBranch: true }), null);
  assert.equal(resolveActingBranch({ headerBranchId: null, primaryBranchId: 1002, allowedBranchIds: [1002] }), 1002);
});

test('a selected branch: reach accepts any branch, single-branch actors only their assignments', () => {
  assert.equal(resolveActingBranch({ headerBranchId: '1004', primaryBranchId: 1002, allowedBranchIds: [1002], canReachAnyBranch: true }), 1004);
  assert.equal(resolveActingBranch({ headerBranchId: '1004', primaryBranchId: 1002, allowedBranchIds: [1002] }), null);
  assert.equal(resolveActingBranch({ headerBranchId: '1002', primaryBranchId: 1002, allowedBranchIds: [1002] }), 1002);
});

test('a write with no branch named never lands in a cross-branch actor\'s home branch', () => {
  assert.equal(defaultWriteBranchId(ctx({ grants: [GLOBAL_LIST], actingBranchId: null })), null);
  assert.equal(defaultWriteBranchId(ctx({ grants: [GLOBAL_LIST], actingBranchId: 1004 })), 1004);
  assert.equal(defaultWriteBranchId(ctx({ isSuperAdmin: true, actingBranchId: null })), null);
  // Single-branch actor: their own branch, as before.
  assert.equal(defaultWriteBranchId(ctx({ grants: [], actingBranchId: null, allowedBranchIds: [1001] })), 1001);
});

test('on "all branches" a cross-branch actor may open BRANCH/ASSIGNED endpoints (scoped there), never a foreign record', () => {
  const allBranches = ctx({
    grants: [GLOBAL_LIST, { permission: 'field_visits.my_visits.view', scope: 'ASSIGNED' }, { permission: 'planning.manage', scope: 'BRANCH' }],
    actingBranchId: null,
  });
  assert.equal(authorize(allBranches, { permission: 'field_visits.my_visits.view' }).allowed, true);
  assert.equal(authorize(allBranches, { permission: 'planning.manage' }).allowed, true);
  // A concrete record outside the assignments is still refused.
  assert.equal(authorize(allBranches, { permission: 'planning.manage', branchId: 1004 }).allowed, false);
  // And selecting a foreign branch does not stand in for a BRANCH grant there.
  assert.equal(authorize(ctx({ grants: allBranches.grants, actingBranchId: 1004 }), { permission: 'planning.manage' }).allowed, false);
});

test('a personal (ASSIGNED) surface follows a cross-branch actor into an unassigned branch; its records do not', () => {
  const inHoms = ctx({
    grants: [GLOBAL_LIST, { permission: 'field_visits.my_visits.view', scope: 'ASSIGNED' }],
    actingBranchId: 1004,
  });
  assert.equal(authorize(inHoms, { permission: 'field_visits.my_visits.view' }).allowed, true);
  assert.equal(authorize(inHoms, { permission: 'field_visits.my_visits.view', branchId: 1004 }).allowed, false);
  // A single-branch actor is unchanged.
  const single = ctx({ grants: [{ permission: 'field_visits.my_visits.view', scope: 'ASSIGNED' }], actingBranchId: 1004 });
  assert.equal(authorize(single, { permission: 'field_visits.my_visits.view' }).allowed, false);
});

test('a single-branch actor without any acting branch is still refused', () => {
  const noBranch = ctx({ grants: [{ permission: 'planning.manage', scope: 'BRANCH' }], actingBranchId: null, allowedBranchIds: [] });
  assert.equal(authorize(noBranch, { permission: 'planning.manage' }).reason, 'MISSING_BRANCH_CONTEXT');
});
