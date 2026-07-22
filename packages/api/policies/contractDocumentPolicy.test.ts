import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canFreezeContractDocument, canViewContractDocument } from './contractDocumentPolicy.js';

function context(options: {
  permission?: 'contracts.view_list' | 'contracts.edit';
  scope?: ScopeType;
  allowedBranchIds?: number[];
  isSuperAdmin?: boolean;
}): AuthContext {
  return {
    userId: 7,
    roleId: 3,
    isSuperAdmin: options.isSuperAdmin === true,
    actingBranchId: 2,
    allowedBranchIds: options.allowedBranchIds ?? [2],
    grants: options.permission && options.scope
      ? [{ permission: options.permission, scope: options.scope }]
      : [],
  } as AuthContext;
}

test('contract legal copy denies missing permission and a contract in another branch', () => {
  assert.equal(canViewContractDocument(context({}), { branchId: 2 }).allowed, false);
  assert.equal(
    canViewContractDocument(
      context({ permission: 'contracts.view_list', scope: 'BRANCH', allowedBranchIds: [2] }),
      { branchId: 9 },
    ).allowed,
    false,
  );
});

test('contract legal copy allows matching BRANCH, GLOBAL and super-admin access', () => {
  assert.equal(
    canViewContractDocument(
      context({ permission: 'contracts.view_list', scope: 'BRANCH', allowedBranchIds: [2] }),
      { branchId: 2 },
    ).allowed,
    true,
  );
  assert.equal(
    canViewContractDocument(
      context({ permission: 'contracts.view_list', scope: 'GLOBAL' }),
      { branchId: 9 },
    ).allowed,
    true,
  );
  assert.equal(canViewContractDocument(context({ isSuperAdmin: true }), { branchId: 9 }).allowed, true);
});

test('freezing uses contracts.edit against the contract branch', () => {
  assert.equal(
    canFreezeContractDocument(
      context({ permission: 'contracts.edit', scope: 'BRANCH', allowedBranchIds: [2] }),
      { branchId: 2 },
    ).allowed,
    true,
  );
  assert.equal(
    canFreezeContractDocument(
      context({ permission: 'contracts.edit', scope: 'BRANCH', allowedBranchIds: [2] }),
      { branchId: 8 },
    ).allowed,
    false,
  );
});
