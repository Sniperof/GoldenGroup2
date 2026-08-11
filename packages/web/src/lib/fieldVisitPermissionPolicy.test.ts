import assert from 'node:assert/strict';
import test from 'node:test';
import { canSeeFieldVisitManagementSurface } from './fieldVisitPermissionPolicy.js';

test('visit-management navigation accepts only GLOBAL/BRANCH grants', () => {
  assert.equal(canSeeFieldVisitManagementSurface({
    isSuperAdmin: false,
    grants: [{ permission: 'field_visits.view', scope: 'GLOBAL' }],
  }), true);
  assert.equal(canSeeFieldVisitManagementSurface({
    isSuperAdmin: false,
    grants: [{ permission: 'field_visits.view', scope: 'BRANCH' }],
  }), true);
  assert.equal(canSeeFieldVisitManagementSurface({
    isSuperAdmin: false,
    grants: [{ permission: 'field_visits.view', scope: 'ASSIGNED' }],
  }), false);
});

test('my-visits grant does not reveal management navigation', () => {
  assert.equal(canSeeFieldVisitManagementSurface({
    isSuperAdmin: false,
    grants: [{ permission: 'field_visits.my_visits.view', scope: 'ASSIGNED' }],
  }), false);
  assert.equal(canSeeFieldVisitManagementSurface({
    isSuperAdmin: true,
    grants: [],
  }), true);
});
