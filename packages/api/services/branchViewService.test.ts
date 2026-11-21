import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { readRequestedBranchId, resolveBranchView, resolveBranchViewAny } from './branchViewService.js';

function ctx(scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED' | null, allowedBranchIds: number[], isSuperAdmin = false): AuthContext {
  return {
    userId: 7,
    roleId: 1,
    isSuperAdmin,
    grants: scope ? [{ permission: 'clients.view_list', scope }] : [],
    allowedBranchIds,
    actingBranchId: allowedBranchIds[0] ?? null,
  } as AuthContext;
}

test('GLOBAL viewer sees every branch, or exactly the selected one even outside their assignments', () => {
  assert.deepEqual(resolveBranchView(ctx('GLOBAL', [1002]), 'clients.view_list', null),
    { ok: true, scope: 'GLOBAL', branchIds: null, selectedBranchId: null, userId: 7 });
  assert.deepEqual(resolveBranchView(ctx('GLOBAL', [1002]), 'clients.view_list', 1004),
    { ok: true, scope: 'GLOBAL', branchIds: [1004], selectedBranchId: 1004, userId: 7 });
});

test('GLOBAL viewer is not blocked for having no assigned branch', () => {
  const view = resolveBranchView(ctx('GLOBAL', []), 'clients.view_list', null);
  assert.equal(view.ok, true);
});

test('super admin behaves as GLOBAL', () => {
  const view = resolveBranchView(ctx(null, [], true), 'clients.view_list', 1006);
  assert.deepEqual(view, { ok: true, scope: 'GLOBAL', branchIds: [1006], selectedBranchId: 1006, userId: 7 });
});

test('BRANCH viewer is confined to the assignments and refused a foreign selection', () => {
  assert.deepEqual(resolveBranchView(ctx('BRANCH', [1001, 1003]), 'clients.view_list', null),
    { ok: true, scope: 'BRANCH', branchIds: [1001, 1003], selectedBranchId: null, userId: 7 });
  assert.deepEqual(resolveBranchView(ctx('BRANCH', [1001, 1003]), 'clients.view_list', 1003),
    { ok: true, scope: 'BRANCH', branchIds: [1003], selectedBranchId: 1003, userId: 7 });
  assert.deepEqual(resolveBranchView(ctx('BRANCH', [1001]), 'clients.view_list', 1004),
    { ok: false, reason: 'BRANCH_FORBIDDEN' });
});

test('ASSIGNED viewer gets the same branch bound (ownership predicate is added by the route)', () => {
  assert.deepEqual(resolveBranchView(ctx('ASSIGNED', [1001]), 'clients.view_list', null),
    { ok: true, scope: 'ASSIGNED', branchIds: [1001], selectedBranchId: null, userId: 7 });
});

test('non-GLOBAL viewer without assignments and a viewer without the grant are refused', () => {
  assert.deepEqual(resolveBranchView(ctx('BRANCH', []), 'clients.view_list', null), { ok: false, reason: 'NO_BRANCH' });
  assert.deepEqual(resolveBranchView(ctx(null, [1001]), 'clients.view_list', null), { ok: false, reason: 'MISSING_PERMISSION' });
});

test('the selection parser accepts only positive integers', () => {
  assert.equal(readRequestedBranchId('1004'), 1004);
  assert.equal(readRequestedBranchId(' 1004 '), 1004);
  assert.equal(readRequestedBranchId(''), null);
  assert.equal(readRequestedBranchId(undefined), null);
  assert.equal(readRequestedBranchId('abc'), null);
  assert.equal(readRequestedBranchId('-3'), null);
  assert.equal(readRequestedBranchId('1.5'), null);
});

test('any-of views: the widest grant wins, BRANCH views union their bounds', () => {
  const both = {
    ...ctx('BRANCH', [1002]),
    grants: [{ permission: 'clients.view_list', scope: 'BRANCH' }, { permission: 'contracts.view_list', scope: 'GLOBAL' }],
  } as AuthContext;
  assert.deepEqual(resolveBranchViewAny(both, ['clients.view_list', 'contracts.view_list'], null),
    { ok: true, scope: 'GLOBAL', branchIds: null, selectedBranchId: null, userId: 7 });
  const branchOnly = ctx('BRANCH', [1002, 1004]);
  const view = resolveBranchViewAny(branchOnly, ['clients.view_list', 'contracts.view_list'], null);
  assert.equal(view.ok, true);
  assert.deepEqual((view as any).branchIds, [1002, 1004]);
  assert.deepEqual(resolveBranchViewAny(branchOnly, ['clients.view_list'], 1001), { ok: false, reason: 'BRANCH_FORBIDDEN' });
});
