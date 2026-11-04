import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canReadMaintenanceResult } from './maintenanceResultPolicy.js';

function context(grants: Array<[string, ScopeType]>, options: { allowedBranchIds?: number[]; isSuperAdmin?: boolean } = {}): AuthContext {
  return {
    userId: 7,
    roleId: 5,
    isSuperAdmin: options.isSuperAdmin === true,
    actingBranchId: 6,
    allowedBranchIds: options.allowedBranchIds ?? [6],
    grants: grants.map(([permission, scope]) => ({ permission, scope })),
  };
}

const visit = (supervisor: number, technician: number) => ({
  branch_id: 6,
  team_snapshot: { supervisorEmployeeId: supervisor, technicianEmployeeId: technician },
  reassigned_supervisor_id: null,
  reassigned_technician_id: null,
  reassigned_trainee_id: null,
});
const taskInBranch6 = { branchId: 6, visits: [visit(31, 44)] };
const taskInBranch9 = { branchId: 9, visits: [visit(31, 44)] };

// The reported case: a supervisor holding only the SAVE key could save parts
// and never read them back (staging role 5, 2026-11-04).
test('whoever can record the result can read it back', () => {
  const saveOnly = context([['marketing_visits.update_result', 'ASSIGNED']]);
  assert.equal(canReadMaintenanceResult(saveOnly, taskInBranch6, 31).allowed, true);
  const recordOnly = context([['tasks.results.record', 'ASSIGNED']]);
  assert.equal(canReadMaintenanceResult(recordOnly, taskInBranch6, 44).allowed, true);
});

test('an ASSIGNED grant reads only a task on a visit whose team includes the actor', () => {
  const assigned = context([['marketing_visits.view', 'ASSIGNED']]);
  assert.equal(canReadMaintenanceResult(assigned, taskInBranch6, 31).allowed, true);
  // Another team's task in the same branch — the old key-only check allowed it.
  assert.equal(canReadMaintenanceResult(assigned, taskInBranch6, 99).allowed, false);
  assert.equal(canReadMaintenanceResult(assigned, taskInBranch6, null).allowed, false);
  // No visit carries the task yet.
  assert.equal(canReadMaintenanceResult(assigned, { branchId: 6, visits: [] }, 31).allowed, false);
});

test('a reassigned crew member counts as the team, the replaced one does not', () => {
  const assigned = context([['tasks.results.record', 'ASSIGNED']]);
  const reassigned = { branchId: 6, visits: [{ ...visit(31, 44), reassigned_supervisor_id: 55 }] };
  assert.equal(canReadMaintenanceResult(assigned, reassigned, 55).allowed, true);
  assert.equal(canReadMaintenanceResult(assigned, reassigned, 31).allowed, false);
});

test('BRANCH and GLOBAL grants read by branch, not by team', () => {
  const branch = context([['marketing_visits.view', 'BRANCH']]);
  assert.equal(canReadMaintenanceResult(branch, taskInBranch6, 99).allowed, true);
  // Company-wide reads by id were open to every holder before.
  assert.equal(canReadMaintenanceResult(branch, taskInBranch9, 99).allowed, false);
  const global = context([['marketing_visits.view', 'GLOBAL']]);
  assert.equal(canReadMaintenanceResult(global, taskInBranch9, 99).allowed, true);
});

test('the broadest of several grants wins', () => {
  // ASSIGNED on one key, BRANCH on another: the BRANCH one opens any task of the branch.
  const mixed = context([['tasks.results.record', 'ASSIGNED'], ['marketing_visits.view', 'BRANCH']]);
  assert.equal(canReadMaintenanceResult(mixed, taskInBranch6, 99).allowed, true);
});

test('no read key, no read; super admin reads all', () => {
  assert.equal(canReadMaintenanceResult(context([['spare_parts.lookup', 'GLOBAL']]), taskInBranch6, 31).allowed, false);
  assert.equal(canReadMaintenanceResult(context([], { isSuperAdmin: true }), taskInBranch9, null).allowed, true);
});
