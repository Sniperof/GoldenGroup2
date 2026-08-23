import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNameNominationForm } from './nameNominationFormSchema.js';

const valid={requestType:'name_nomination',formVersion:'name_nomination.mobile.v2',requesterFirstName:'سارة',requesterPhone:'0999999999',names:[{
  firstName:'أحمد',lastName:'خالد',governorate:1,cityOrArea:2,subArea:3,occupation:'تاجر',primaryPhone:'0988888888',primaryPhoneHasWhatsapp:true,
}]};
test('accepts only the declared requester and per-name fields',()=>assert.equal(validateNameNominationForm(valid).ok,true));
test('rejects submissionMode because name nomination is always personal intake',()=>{
  const result=validateNameNominationForm({...valid,submissionMode:'for_another'});
  assert.equal(result.ok,false);assert.deepEqual(result.unknownFields,['submissionMode']);
});
test('rejects undeclared fields inside a nominated name',()=>{
  const result=validateNameNominationForm({...valid,names:[{...valid.names[0],notes:'editable'}]});
  assert.equal(result.ok,false);assert.deepEqual(result.unknownFields,['names.0.notes']);
});
test('secondary WhatsApp shape remains nullable at schema level',()=>{
  const result=validateNameNominationForm({...valid,names:[{...valid.names[0],secondaryPhone:null,secondaryPhoneHasWhatsapp:null}]});
  assert.equal(result.ok,true);
});
test('rejects the retired v1-only requester and geography keys',()=>{
  const result=validateNameNominationForm({
    ...valid,
    requesterPhone:undefined,
    requesterPrimaryPhone:'0999999999',
    requesterPrimaryPhoneHasWhatsapp:true,
    names:[{...valid.names[0],cityOrArea:undefined,subArea:undefined,region:2,subdistrict:3}],
  });
  assert.equal(result.ok,false);
  assert.deepEqual(result.unknownFields,[
    'requesterPrimaryPhone','requesterPrimaryPhoneHasWhatsapp',
    'names.0.region','names.0.subdistrict',
  ]);
});
