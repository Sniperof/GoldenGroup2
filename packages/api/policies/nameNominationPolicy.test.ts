import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthContext } from '@golden-crm/shared';
import { hasNameNominationGlobalPermission } from './nameNominationPolicy.js';

const context=(scope?:'GLOBAL'|'BRANCH'|'ASSIGNED',superAdmin=false):AuthContext=>({
  userId:7,roleId:2,isSuperAdmin:superAdmin,allowedBranchIds:[1],actingBranchId:1,
  grants:scope?[{permission:'candidates.create',scope}]:[],
});
test('candidate conversion accepts candidates.create GLOBAL',()=>assert.equal(hasNameNominationGlobalPermission(context('GLOBAL'),'candidates.create'),true));
test('candidate conversion rejects BRANCH, ASSIGNED and missing grants',()=>{
  assert.equal(hasNameNominationGlobalPermission(context('BRANCH'),'candidates.create'),false);
  assert.equal(hasNameNominationGlobalPermission(context('ASSIGNED'),'candidates.create'),false);
  assert.equal(hasNameNominationGlobalPermission(context(),'candidates.create'),false);
});
test('explicit super admin path remains allowed',()=>assert.equal(hasNameNominationGlobalPermission(context(undefined,true),'candidates.create'),true));
