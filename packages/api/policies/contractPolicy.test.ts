import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canAccessContract, contractSaleOwnerSql } from './contractPolicy.js';
import { canViewContractDocument } from './contractDocumentPolicy.js';
import { appendContractScope } from '../services/reporting/reportingScope.js';

function context(scope: ScopeType | null, permission = 'contracts.view_list'): AuthContext {
  return {
    userId: 23,
    roleId: 3,
    isSuperAdmin: false,
    actingBranchId: 1001,
    allowedBranchIds: [1001],
    grants: scope ? [{ permission, scope }] : [],
  } as AuthContext;
}

test('ASSIGNED sees a contract only when the actor is its sale owner', () => {
  const ctx = context('ASSIGNED');
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1001, saleOwnerId: 77 }, 77).allowed, true);
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1001, saleOwnerId: 78 }, 77).allowed, false);
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1001, saleOwnerId: null }, 77).allowed, false);
  // No employee link on the account → nothing is "mine".
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1001, saleOwnerId: 77 }, null).allowed, false);
  // Own sale in a branch outside the actor's branches stays hidden.
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1002, saleOwnerId: 77 }, 77).allowed, false);
});

test('BRANCH ignores sale ownership', () => {
  const ctx = context('BRANCH');
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1001, saleOwnerId: 78 }, 77).allowed, true);
  assert.equal(canAccessContract(ctx, 'contracts.view_list', { branchId: 1002, saleOwnerId: 77 }, 77).allowed, false);
});

test('legal copy follows the same ASSIGNED rule', () => {
  const ctx = context('ASSIGNED');
  assert.equal(canViewContractDocument(ctx, { branchId: 1001, saleOwnerId: 77, currentEmployeeId: 77 }).allowed, true);
  assert.equal(canViewContractDocument(ctx, { branchId: 1001, saleOwnerId: 78, currentEmployeeId: 77 }).allowed, false);
});

test('reporting scope adds the sale-owner predicate only under ASSIGNED', () => {
  const base = { branchIds: [1001], userId: 23 } as any;
  const assignedParams: unknown[] = [];
  const assigned = appendContractScope({ ...base, scope: 'ASSIGNED' }, assignedParams);
  assert.ok(assigned.includes(contractSaleOwnerSql('c', '$2')));
  assert.deepEqual(assignedParams, [[1001], 23]);
  const branch = appendContractScope({ ...base, scope: 'BRANCH' }, []);
  assert.ok(!branch.includes('sale_owner_id'));
});

test('contract routes use the shared policy (no branch-only regression)', () => {
  const route = readFileSync(new URL('../routes/contracts.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /no ASSIGNED tier/);
  assert.match(route, /scope === 'ASSIGNED'\) \{\s*conditions\.push\(contractSaleOwnerSql\('c'/);
  assert.match(route, /authorizeContract\(authContext, 'contracts\.view_list', rows\[0\]\)/);
  assert.equal((route.match(/authorizeContract\(req\.authContext!, 'contracts\.edit', contract\)/g) || []).length, 3);
  assert.doesNotMatch(route, /authorize\(authContext, \{ permission: 'contracts\.(view_list|edit)'/);
});
