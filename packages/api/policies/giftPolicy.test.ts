import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canAccessGift, getGiftListAccessPlan } from './giftPolicy.js';

function context(options: {
  permission?: string;
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
  };
}

const branchGift = {
  sourceBranchId: 2,
  responsibleBranchId: 2,
  assignedUserId: null,
  beneficiaryEmployeeId: null,
  beneficiaryAssignedToCurrentUser: false,
};

test('gift list and record access deny missing permission', () => {
  assert.equal(getGiftListAccessPlan(context({}), 'contract_gifts.view').scope, 'NONE');
  assert.equal(canAccessGift(context({}), 'contract_gifts.view', branchGift), false);
});

test('gift BRANCH access enforces the subject branch', () => {
  const branchContext = context({
    permission: 'contract_gifts.manual_delivery',
    scope: 'BRANCH',
    allowedBranchIds: [2],
  });
  assert.equal(canAccessGift(branchContext, 'contract_gifts.manual_delivery', branchGift), true);
  assert.equal(canAccessGift(
    branchContext,
    'contract_gifts.manual_delivery',
    { ...branchGift, sourceBranchId: 9, responsibleBranchId: 9 },
  ), false);
});

test('gift ASSIGNED access requires an assigned subject', () => {
  const assignedContext = context({
    permission: 'contract_gifts.verify_condition',
    scope: 'ASSIGNED',
  });
  assert.equal(canAccessGift(assignedContext, 'contract_gifts.verify_condition', branchGift), false);
  assert.equal(canAccessGift(
    assignedContext,
    'contract_gifts.verify_condition',
    { ...branchGift, assignedUserId: 7 },
  ), true);
});

test('gift ASSIGNED access includes gifts on a contract linked to the current user', () => {
  // A supervisor promising a gift in a contract she created must still see it
  // after approval wipes client_assignments (OP promotion).
  const assignedContext = context({ permission: 'contract_gifts.view', scope: 'ASSIGNED' });
  assert.equal(canAccessGift(assignedContext, 'contract_gifts.view', branchGift), false);
  assert.equal(canAccessGift(
    assignedContext,
    'contract_gifts.view',
    { ...branchGift, contractLinkedToCurrentUser: true },
  ), true);
  // The contract link never widens access beyond the grant's branches.
  assert.equal(canAccessGift(
    assignedContext,
    'contract_gifts.view',
    { ...branchGift, sourceBranchId: 9, responsibleBranchId: 9, contractLinkedToCurrentUser: true },
  ), false);
});

test('manual-delivery reopening is GLOBAL-only, including against a bad BRANCH grant', () => {
  assert.equal(canAccessGift(
    context({ permission: 'contract_gifts.reopen_manual_delivery', scope: 'BRANCH' }),
    'contract_gifts.reopen_manual_delivery',
    branchGift,
  ), false);
  assert.equal(canAccessGift(
    context({ permission: 'contract_gifts.reopen_manual_delivery', scope: 'GLOBAL' }),
    'contract_gifts.reopen_manual_delivery',
    { ...branchGift, sourceBranchId: 9, responsibleBranchId: 9 },
  ), true);
  assert.equal(canAccessGift(
    context({ isSuperAdmin: true }),
    'contract_gifts.reopen_manual_delivery',
    { ...branchGift, sourceBranchId: 9, responsibleBranchId: 9 },
  ), true);
});
