import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthContext, ScopeType } from '@golden-crm/shared';
import { canUseComplaintClientOption } from './complaintService.js';

function context(clientScope?:ScopeType,createScope:ScopeType='BRANCH'):AuthContext{
  return{userId:7,roleId:2,isSuperAdmin:false,actingBranchId:10,allowedBranchIds:[10],grants:[
    {permission:'complaints.create_internal',scope:createScope},
    ...(clientScope?[{permission:'clients.view_list',scope:clientScope}]:[]),
  ]};
}

test('client complaint lookup requires clients.view_list',()=>{
  assert.equal(canUseComplaintClientOption(context(),{branchId:10,assignedUserIds:[7]}),false);
});

test('branch lookup rejects a client in another branch',()=>{
  assert.equal(canUseComplaintClientOption(context('BRANCH'),{branchId:11,assignedUserIds:[7]}),false);
});

test('assigned client lookup requires the current user assignment',()=>{
  assert.equal(canUseComplaintClientOption(context('ASSIGNED'),{branchId:10,assignedUserIds:[8]}),false);
  assert.equal(canUseComplaintClientOption(context('ASSIGNED'),{branchId:10,assignedUserIds:[7]}),true);
});

test('branch and global client lookups allow an in-scope client',()=>{
  assert.equal(canUseComplaintClientOption(context('BRANCH'),{branchId:10,assignedUserIds:[]}),true);
  assert.equal(canUseComplaintClientOption(context('GLOBAL'),{branchId:10,assignedUserIds:[]}),true);
});
