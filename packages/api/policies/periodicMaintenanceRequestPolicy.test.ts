import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canLinkServiceRequestParty } from './serviceRequestPartyLinkPolicy.js';

const permission = 'periodic_maintenance.review';

function context(scope?: ScopeType, options: {
  userId?: number; branches?: number[]; superAdmin?: boolean;
} = {}): AuthContext {
  return {
    userId: options.userId ?? 8,
    roleId: 2,
    isSuperAdmin: options.superAdmin === true,
    actingBranchId: 3,
    allowedBranchIds: options.branches ?? [3],
    grants: scope ? [{ permission, scope }] : [],
  } as AuthContext;
}

const subject = { permission, branchId: 3, reviewedByUserId: 8 };

test('periodic review denies missing permission, wrong branch, and an unassigned reviewer', () => {
  assert.equal(canLinkServiceRequestParty(context(), subject).allowed, false);
  assert.equal(canLinkServiceRequestParty(context('BRANCH', { branches: [9] }), subject).allowed, false);
  assert.equal(canLinkServiceRequestParty(context('ASSIGNED', { userId: 4 }), subject).allowed, false);
});

test('periodic review allows every declared scope and the explicit super-admin path', () => {
  assert.equal(canLinkServiceRequestParty(context('ASSIGNED'), subject).allowed, true);
  assert.equal(canLinkServiceRequestParty(context('BRANCH'), subject).allowed, true);
  assert.equal(canLinkServiceRequestParty(context('GLOBAL'), { ...subject, branchId: 99 }).allowed, true);
  assert.equal(
    canLinkServiceRequestParty(context(undefined, { superAdmin: true }), { ...subject, branchId: 99 }).allowed,
    true,
  );
});
