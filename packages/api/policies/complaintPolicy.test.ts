import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthContext } from '@golden-crm/shared';
import { canAccessComplaint, getComplaintListAccessPlan } from './complaintPolicy.js';

const context = (scope: 'GLOBAL'|'BRANCH'|'ASSIGNED', userId=7): AuthContext => ({
  userId, roleId: 2, isSuperAdmin: false, actingBranchId: 10, allowedBranchIds: [10],
  grants: [
    { permission:'complaints.view_list', scope },
    { permission:'complaints.view_details', scope },
  ],
});

test('branch complaint visibility is based on handling branch', () => {
  assert.equal(canAccessComplaint(context('BRANCH'),'complaints.view_details',{handlingBranchId:10,assignedUserId:null}).allowed,true);
  assert.equal(canAccessComplaint(context('BRANCH'),'complaints.view_details',{handlingBranchId:11,assignedUserId:null}).allowed,false);
  assert.equal(canAccessComplaint(context('BRANCH'),'complaints.view_details',{handlingBranchId:null,assignedUserId:null}).allowed,false);
});

test('assigned scope requires both matching handler and allowed handling branch', () => {
  const ctx=context('ASSIGNED');
  assert.equal(canAccessComplaint(ctx,'complaints.view_details',{handlingBranchId:10,assignedUserId:7}).allowed,true);
  assert.equal(canAccessComplaint(ctx,'complaints.view_details',{handlingBranchId:10,assignedUserId:8}).allowed,false);
  assert.equal(canAccessComplaint(ctx,'complaints.view_details',{handlingBranchId:11,assignedUserId:7}).allowed,false);
  assert.equal(canAccessComplaint(ctx,'complaints.view_details',{handlingBranchId:null,assignedUserId:7}).allowed,false);
  assert.equal(canAccessComplaint(ctx,'complaints.view_details',{handlingBranchId:10,assignedUserId:null}).allowed,false);
});

test('list plan preserves configured scope', () => {
  assert.equal(getComplaintListAccessPlan(context('GLOBAL')).scope,'GLOBAL');
  assert.equal(getComplaintListAccessPlan(context('BRANCH')).scope,'BRANCH');
  assert.equal(getComplaintListAccessPlan(context('ASSIGNED')).scope,'ASSIGNED');
});
