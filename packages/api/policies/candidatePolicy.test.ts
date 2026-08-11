import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canViewCandidate } from './candidatePolicy.js';

function context(options: {
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
    grants: options.scope
      ? [{ permission: 'candidates.view_list', scope: options.scope }]
      : [],
  } as AuthContext;
}

test('candidate detail denies missing permission, wrong branch and unassigned subject', () => {
  assert.equal(canViewCandidate(context({}), { branchId: 2, assignedUserIds: [7] }).allowed, false);
  assert.equal(
    canViewCandidate(context({ scope: 'BRANCH', allowedBranchIds: [2] }), {
      branchId: 9,
      assignedUserIds: [7],
    }).allowed,
    false,
  );
  assert.equal(
    canViewCandidate(context({ scope: 'ASSIGNED', allowedBranchIds: [2] }), {
      branchId: 2,
      assignedUserIds: [18],
    }).allowed,
    false,
  );
});

test('candidate detail allows matching ASSIGNED, BRANCH, GLOBAL and super-admin paths', () => {
  assert.equal(
    canViewCandidate(context({ scope: 'ASSIGNED', allowedBranchIds: [2] }), {
      branchId: 2,
      assignedUserIds: [7],
    }).allowed,
    true,
  );
  assert.equal(
    canViewCandidate(context({ scope: 'BRANCH', allowedBranchIds: [2] }), {
      branchId: 2,
      assignedUserIds: [],
    }).allowed,
    true,
  );
  assert.equal(
    canViewCandidate(context({ scope: 'GLOBAL' }), {
      branchId: 9,
      assignedUserIds: [],
    }).allowed,
    true,
  );
  assert.equal(
    canViewCandidate(context({ isSuperAdmin: true }), {
      branchId: 9,
      assignedUserIds: [],
    }).allowed,
    true,
  );
});
