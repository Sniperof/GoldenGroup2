import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import {
  canAccessTrainingCourse,
  getTrainingCourseListAccessPlan,
  type TrainingCoursePermission,
} from './trainingCoursePolicy.js';

function context(options: {
  permission?: TrainingCoursePermission;
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

test('training list denies missing and unsupported ASSIGNED access', () => {
  assert.equal(getTrainingCourseListAccessPlan(context({})).scope, 'NONE');
  assert.equal(
    getTrainingCourseListAccessPlan(context({
      permission: 'jobs.training.view_list',
      scope: 'ASSIGNED',
    })).scope,
    'NONE',
  );
});

test('training list preserves BRANCH assignments and GLOBAL access', () => {
  const branchPlan = getTrainingCourseListAccessPlan(context({
    permission: 'jobs.training.view_list',
    scope: 'BRANCH',
    allowedBranchIds: [2, 4],
  }));
  assert.equal(branchPlan.scope, 'BRANCH');
  assert.deepEqual(branchPlan.allowedBranchIds, [2, 4]);

  assert.equal(getTrainingCourseListAccessPlan(context({
    permission: 'jobs.training.view_list',
    scope: 'GLOBAL',
  })).scope, 'GLOBAL');
  assert.equal(getTrainingCourseListAccessPlan(context({ isSuperAdmin: true })).scope, 'GLOBAL');
});

test('training record access requires the record branch for BRANCH grants', () => {
  const branchContext = context({
    permission: 'jobs.training.view_detail',
    scope: 'BRANCH',
    allowedBranchIds: [2],
  });
  assert.equal(canAccessTrainingCourse(branchContext, 'jobs.training.view_detail', { branchId: 2 }).allowed, true);
  assert.equal(canAccessTrainingCourse(branchContext, 'jobs.training.view_detail', { branchId: 9 }).allowed, false);
  assert.equal(canAccessTrainingCourse(context({}), 'jobs.training.view_detail', { branchId: 2 }).allowed, false);
});

test('training record access allows GLOBAL and super-admin but denies unassigned ASSIGNED grants', () => {
  assert.equal(canAccessTrainingCourse(
    context({ permission: 'jobs.training.start', scope: 'GLOBAL' }),
    'jobs.training.start',
    { branchId: 9 },
  ).allowed, true);
  assert.equal(canAccessTrainingCourse(
    context({ isSuperAdmin: true }),
    'jobs.training.start',
    { branchId: 9 },
  ).allowed, true);
  assert.equal(canAccessTrainingCourse(
    context({ permission: 'jobs.training.start', scope: 'ASSIGNED' }),
    'jobs.training.start',
    { branchId: 2 },
  ).allowed, false);
});
