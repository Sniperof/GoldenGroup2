import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDENTITY_BODY_KEYS,
  REFERRER_BODY_KEYS,
  resolveMobileRequesterParties,
  sanitizeMobileSubmittedPayload,
} from './mobileWaterCheckIntake.js';

const beneficiary = { name: 'Beneficiary', primary_phone: '0999999999' };
const account = { appAccountId: 7, clientId: 42, phone: '0911111111' };

test('registered customer for self is linked as requester and beneficiary', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_self',
    appAccount: account,
    beneficiaryExternal: beneficiary,
  });
  assert.equal(result.requesterAppAccountId, 7);
  assert.equal(result.requesterClientId, 42);
  assert.equal(result.beneficiaryClientId, 42);
  assert.equal(result.referrerClientId, null);
  assert.equal(result.requesterExternal.primary_phone, account.phone);
});

test('registered customer for another is the linked referrer, not the beneficiary', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another',
    appAccount: account,
    beneficiaryExternal: beneficiary,
  });
  assert.equal(result.beneficiaryClientId, null);
  assert.equal(result.referrerClientId, 42);
  assert.equal(result.referrerExternal?.primary_phone, account.phone);
});

test('OTP visitor identity stays external and verified', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another',
    verifiedVisitorPhone: '0922222222',
    beneficiaryExternal: beneficiary,
  });
  assert.equal(result.requesterAppAccountId, null);
  assert.equal(result.requesterClientId, null);
  assert.equal(result.referrerClientId, null);
  assert.equal(result.requesterExternal.identity_verification, 'otp');
  assert.equal(result.requesterExternal.primary_phone, '0922222222');
});

const referrerName = {
  firstName: 'سالم', fatherName: 'أحمد', lastName: 'الحلبي',
  name: 'سالم أحمد الحلبي', source: 'submitted' as const,
};

test('the referrer carries a name, not just a verified phone', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another',
    verifiedVisitorPhone: '0922222222',
    beneficiaryExternal: beneficiary,
    referrerName,
  });
  assert.equal(result.referrerExternal?.name, 'سالم أحمد الحلبي');
  assert.equal(result.referrerExternal?.firstName, 'سالم');
  assert.equal(result.referrerExternal?.name_source, 'submitted');
  // The verified phone still identifies them; the name is additional.
  assert.equal(result.referrerExternal?.primary_phone, '0922222222');
});

test('the referrer party declares its own role, not the requester role', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another',
    appAccount: account,
    beneficiaryExternal: beneficiary,
    referrerName: { ...referrerName, source: 'client_record' },
  });
  assert.equal(result.referrerExternal?.partyRole, 'referrer');
  assert.equal(result.requesterExternal.partyRole, 'requester');
  assert.equal(result.referrerExternal?.name_source, 'client_record');
});

test('for_self never grows a referrer, with or without a name supplied', () => {
  for (const appAccount of [account, undefined]) {
    const result = resolveMobileRequesterParties({
      submissionMode: 'for_self',
      appAccount,
      verifiedVisitorPhone: appAccount ? undefined : '0922222222',
      beneficiaryExternal: beneficiary,
      referrerName,
    });
    assert.equal(result.referrerExternal, null);
    assert.equal(result.referrerClientId, null);
  }
});

test('an absent referrer name leaves the snapshot without name keys', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another',
    verifiedVisitorPhone: '0922222222',
    beneficiaryExternal: beneficiary,
    referrerName: null,
  });
  assert.equal(result.referrerExternal?.name, undefined);
  assert.equal(result.referrerExternal?.primary_phone, '0922222222');
});

test('referrer name keys are refusable and distinct from beneficiary keys', () => {
  for (const key of ['referrerFirstName', 'referrerFatherName', 'referrerLastName']) {
    assert.ok(REFERRER_BODY_KEYS.includes(key as any), `${key} must be listed`);
    assert.ok(!IDENTITY_BODY_KEYS.includes(key as any), `${key} must not be a beneficiary key`);
  }
});

test('every field that asserts identity is on the refusal list', () => {
  // The guard is only as good as this list: a name or phone alias missing from
  // it would be accepted from the body and silently override the record.
  for (const key of [
    'firstName', 'fatherName', 'lastName',
    'phoneNumber', 'primaryPhone', 'phone',
    'secondaryPhone', 'secondary_phone',
    'primaryPhoneHasWhatsapp', 'secondaryPhoneHasWhatsapp',
  ]) {
    assert.ok(IDENTITY_BODY_KEYS.includes(key as any), `${key} must be refused when identity is derived`);
  }
  // Address and free-text fields stay the caller's to supply.
  for (const key of ['governorateId', 'detailedAddress', 'mapLocation', 'notes', 'submissionMode']) {
    assert.ok(!IDENTITY_BODY_KEYS.includes(key as any), `${key} must remain submittable`);
  }
});

test('OTP handle is never copied to the immutable submitted payload', () => {
  assert.deepEqual(
    sanitizeMobileSubmittedPayload({ requestType: 'water_check', handle: 'secret-handle', notes: 'x' }),
    { requestType: 'water_check', notes: 'x' },
  );
});
