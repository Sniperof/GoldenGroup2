import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canEditCandidate } from './candidatePolicy.js';
import { canEditReferralSheet } from './referralSheetPolicy.js';

function context(permission: string | null, scope: ScopeType = 'ASSIGNED', options?: {
  branchIds?: number[];
  superAdmin?: boolean;
}): AuthContext {
  return {
    userId: 7,
    roleId: 3,
    isSuperAdmin: options?.superAdmin === true,
    actingBranchId: 2,
    allowedBranchIds: options?.branchIds ?? [2],
    grants: permission ? [{ permission, scope }] : [],
  } as AuthContext;
}

test('candidate-source promise edit denies missing permission, wrong branch and unassigned subject', () => {
  assert.equal(canEditCandidate(context(null), { branchId: 2, assignedUserIds: [7] }).allowed, false);
  assert.equal(canEditCandidate(context('candidates.edit', 'BRANCH'), { branchId: 9, assignedUserIds: [7] }).allowed, false);
  assert.equal(canEditCandidate(context('candidates.edit'), { branchId: 2, assignedUserIds: [18] }).allowed, false);
});

test('candidate-source promise edit allows every supported scope and super-admin', () => {
  assert.equal(canEditCandidate(context('candidates.edit'), { branchId: 2, assignedUserIds: [7] }).allowed, true);
  assert.equal(canEditCandidate(context('candidates.edit', 'BRANCH'), { branchId: 2, assignedUserIds: [] }).allowed, true);
  assert.equal(canEditCandidate(context('candidates.edit', 'GLOBAL'), { branchId: 9, assignedUserIds: [] }).allowed, true);
  assert.equal(canEditCandidate(context(null, 'ASSIGNED', { superAdmin: true }), { branchId: 9, assignedUserIds: [] }).allowed, true);
});

test('name-list-source promise edit uses the list assignee as its subject', () => {
  const subject = { branchId: 2, ownerUserId: 99, assignedHrUserId: 7 };
  assert.equal(canEditReferralSheet(context(null), subject).allowed, false);
  assert.equal(canEditReferralSheet(context('candidates.name_lists.edit'), subject).allowed, true);
  assert.equal(canEditReferralSheet(context('candidates.name_lists.edit'), { ...subject, assignedHrUserId: 18 }).allowed, false);
  assert.equal(canEditReferralSheet(context('candidates.name_lists.edit', 'BRANCH'), { ...subject, branchId: 9 }).allowed, false);
  assert.equal(canEditReferralSheet(context('candidates.name_lists.edit', 'BRANCH'), subject).allowed, true);
  assert.equal(canEditReferralSheet(context('candidates.name_lists.edit', 'GLOBAL'), { ...subject, branchId: 9 }).allowed, true);
  assert.equal(canEditReferralSheet(context(null, 'ASSIGNED', { superAdmin: true }), { ...subject, branchId: 9 }).allowed, true);
});
