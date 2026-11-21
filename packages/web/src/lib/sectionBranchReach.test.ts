import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionBranchLimit, viewPermissionForPath } from './sectionBranchReach.js';
import { useBranchContextStore } from '../hooks/useBranchContextStore.js';

const GLOBAL_CLIENTS = { permission: 'clients.view_list', scope: 'GLOBAL' as const };
const BRANCH_TASKS = { permission: 'tasks.maintenance.view', scope: 'BRANCH' as const };
const mixedUser = { isSuperAdmin: false, branchId: 1002, allowedBranchIds: [1002, 1003] };

test('a section resolves to its view permission on segment boundaries (longest prefix wins)', () => {
  assert.equal(viewPermissionForPath('/clients'), 'clients.view_list');
  assert.equal(viewPermissionForPath('/clients/42'), 'clients.view_list');
  assert.equal(viewPermissionForPath('/clientsX'), null);
  assert.equal(viewPermissionForPath('/tasks/group/maintenance/7'), 'tasks.maintenance.view');
  assert.equal(viewPermissionForPath('/planning/overview'), null);
});

test('a GLOBAL section offers every branch; a BRANCH section only the assignments', () => {
  const grants = [GLOBAL_CLIENTS, BRANCH_TASKS];
  assert.equal(sectionBranchLimit('/clients', mixedUser, grants), null);
  assert.deepEqual(sectionBranchLimit('/tasks/group/maintenance', mixedUser, grants), [1002, 1003]);
  // Unknown section keeps today's behaviour.
  assert.equal(sectionBranchLimit('/planning/overview', mixedUser, grants), null);
});

test('no limit for users without a switcher, and for super admins', () => {
  assert.equal(sectionBranchLimit('/tasks/group/maintenance', mixedUser, [BRANCH_TASKS]), null);
  assert.equal(sectionBranchLimit('/tasks/group/maintenance', { ...mixedUser, isSuperAdmin: true }, [BRANCH_TASKS]), null);
});

test('old sessions without allowedBranchIds fall back to the home branch', () => {
  const legacy = { isSuperAdmin: false, branchId: 1002 };
  assert.deepEqual(sectionBranchLimit('/tasks/group/maintenance', legacy, [GLOBAL_CLIENTS, BRANCH_TASKS]), [1002]);
});

test('the store keeps the choice but sends only what the section reaches, then restores it', () => {
  const store = useBranchContextStore.getState();
  store.clear();
  store.setBranchId(1004);                     // chosen in a GLOBAL section
  assert.equal(useBranchContextStore.getState().branchId, 1004);

  store.setSectionBranchIds([1002, 1003]);     // enter a BRANCH section
  assert.equal(useBranchContextStore.getState().branchId, null);
  assert.equal(useBranchContextStore.getState().preferredBranchId, 1004);

  store.setSectionBranchIds([1002, 1004]);     // a section that does reach it
  assert.equal(useBranchContextStore.getState().branchId, 1004);

  store.setSectionBranchIds(null);             // back to GLOBAL
  assert.equal(useBranchContextStore.getState().branchId, 1004);
  store.clear();
});
