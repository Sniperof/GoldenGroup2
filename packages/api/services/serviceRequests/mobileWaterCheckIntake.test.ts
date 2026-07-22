import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('OTP handle is never copied to the immutable submitted payload', () => {
  assert.deepEqual(
    sanitizeMobileSubmittedPayload({ requestType: 'water_check', handle: 'secret-handle', notes: 'x' }),
    { requestType: 'water_check', notes: 'x' },
  );
});
