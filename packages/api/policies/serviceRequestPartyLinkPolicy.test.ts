import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canLinkServiceRequestParty } from './serviceRequestPartyLinkPolicy.js';

const permission = 'water_check.review';

function context(scope?: ScopeType, options: { branches?: number[]; superAdmin?: boolean } = {}): AuthContext {
  return {
    userId: 8, roleId: 2, isSuperAdmin: options.superAdmin === true,
    actingBranchId: 3, allowedBranchIds: options.branches ?? [3],
    grants: scope ? [{ permission, scope }] : [],
  } as AuthContext;
}

test('party linking denies missing permission, wrong branch, and unassigned subject', () => {
  assert.equal(canLinkServiceRequestParty(context(), { permission, branchId: 3, reviewedByUserId: 8 }).allowed, false);
  assert.equal(canLinkServiceRequestParty(context('BRANCH'), { permission, branchId: 9, reviewedByUserId: 8 }).allowed, false);
  assert.equal(canLinkServiceRequestParty(context('ASSIGNED'), { permission, branchId: 3, reviewedByUserId: 4 }).allowed, false);
});

test('party linking allows GLOBAL, matching BRANCH, assigned reviewer, and super admin', () => {
  assert.equal(canLinkServiceRequestParty(context('GLOBAL'), { permission, branchId: 9, reviewedByUserId: null }).allowed, true);
  assert.equal(canLinkServiceRequestParty(context('BRANCH'), { permission, branchId: 3, reviewedByUserId: null }).allowed, true);
  assert.equal(canLinkServiceRequestParty(context('ASSIGNED'), { permission, branchId: 3, reviewedByUserId: 8 }).allowed, true);
  assert.equal(canLinkServiceRequestParty(context(undefined, { superAdmin: true }), { permission, branchId: 99, reviewedByUserId: null }).allowed, true);
});
