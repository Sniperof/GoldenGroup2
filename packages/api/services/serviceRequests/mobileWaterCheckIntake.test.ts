import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDENTITY_BODY_KEYS,
  REFERRER_BODY_KEYS,
  REQUESTER_BODY_KEYS,
  buildSubmittedPerson,
  resolveMobileRequesterParties,
  readWaterCheckAddressIds,
  sanitizeMobileSubmittedPayload,
  type PersonSnapshot,
  withSecondaryContactOverride,
} from './mobileWaterCheckIntake.js';

test('SmartGeo account-style address keys map to every water-check level', () => {
  assert.deepEqual(readWaterCheckAddressIds({
    governorate: 1,
    cityOrArea: 2,
    subArea: 3,
    neighborhood: 4,
  }), {
    governorateId: 1,
    regionId: 2,
    subdistrictId: 3,
    neighborhoodId: 4,
  });
});

const beneficiary = { name: 'Beneficiary', primary_phone: '0999999999' };
const account = { appAccountId: 7, clientId: 42, phone: '0911111111' };
const requester: PersonSnapshot = {
  firstName: 'سالم', fatherName: 'أحمد', lastName: 'الحلبي', name: 'سالم أحمد الحلبي',
  primaryPhone: '0911111111', primaryPhoneHasWhatsapp: true,
  secondaryPhone: '0922222222', secondaryPhoneHasWhatsapp: false,
  source: 'client_record',
};
const separateReferrer: PersonSnapshot = {
  firstName: 'ليلى', fatherName: null, lastName: 'الخطيب', name: 'ليلى الخطيب',
  primaryPhone: '0933333333', primaryPhoneHasWhatsapp: false,
  secondaryPhone: null, secondaryPhoneHasWhatsapp: false,
  source: 'submitted',
};

test('registered self links requester and beneficiary and never creates a mediator', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_self', referrerMode: 'none', appAccount: account,
    requesterPerson: requester, beneficiaryExternal: beneficiary,
  });
  assert.equal(result.requesterClientId, 42);
  assert.equal(result.beneficiaryClientId, 42);
  assert.equal(result.referrerClientId, null);
  assert.equal(result.referrerExternal, null);
  assert.equal((result.requesterExternal as Record<string, unknown>).primary_phone, requester.primaryPhone);
});

test('registered for another supports no mediator', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another', referrerMode: 'none', appAccount: account,
    requesterPerson: requester, beneficiaryExternal: beneficiary,
  });
  assert.equal(result.requesterClientId, 42);
  assert.equal(result.beneficiaryClientId, null);
  assert.equal(result.referrerClientId, null);
  assert.equal(result.referrerExternal, null);
});

test('registered for another can make the immutable requester the mediator', () => {
  const result = resolveMobileRequesterParties({
    submissionMode: 'for_another', referrerMode: 'requester', appAccount: account,
    requesterPerson: requester, beneficiaryExternal: beneficiary, referrerPerson: requester,
  });
  assert.equal(result.requesterClientId, 42);
  assert.equal(result.referrerClientId, 42);
  assert.equal(result.referrerExternal?.same_as_requester, true);
  assert.equal(result.referrerExternal?.primary_phone, requester.primaryPhone);
});

test('registered customer cannot introduce a separate mediator', () => {
  assert.throws(() => resolveMobileRequesterParties({
    submissionMode: 'for_another', referrerMode: 'separate_person', appAccount: account,
    requesterPerson: requester, beneficiaryExternal: beneficiary, referrerPerson: separateReferrer,
  }), /registered_requester_separate_referrer_forbidden/);
});

for (const identity of [
  { verifiedVisitorPhone: requester.primaryPhone },
  { unverifiedDevice: { deviceId: 'device-1', ip: '127.0.0.1' } },
]) {
  const tier = 'verifiedVisitorPhone' in identity ? 'OTP visitor' : 'unverified device';
  test(`${tier} for another supports none, requester, and separate mediator`, () => {
    for (const mode of ['none', 'requester', 'separate_person'] as const) {
      const result = resolveMobileRequesterParties({
        submissionMode: 'for_another', referrerMode: mode, ...identity,
        requesterPerson: { ...requester, source: 'submitted' },
        beneficiaryExternal: beneficiary,
        referrerPerson: mode === 'separate_person'
          ? separateReferrer
          : mode === 'requester' ? { ...requester, source: 'submitted' } : null,
      });
      assert.equal(result.requesterClientId, null);
      assert.equal(result.beneficiaryClientId, null);
      assert.equal(result.referrerExternal == null, mode === 'none');
      if (mode !== 'none') {
        assert.equal(result.referrerExternal?.same_as_requester, mode === 'requester');
      }
    }
  });
}

test('for self rejects every mediator mode other than none', () => {
  assert.throws(() => resolveMobileRequesterParties({
    submissionMode: 'for_self', referrerMode: 'requester', appAccount: account,
    requesterPerson: requester, beneficiaryExternal: beneficiary, referrerPerson: requester,
  }), /for_self_referrer_forbidden/);
});

test('submitted requester requires WhatsApp facts and binds OTP to primary phone', () => {
  const body = {
    requesterFirstName: 'سالم', requesterLastName: 'الحلبي', requesterPhone: '0911111111',
    requesterPhoneHasWhatsapp: true,
  };
  assert.equal(buildSubmittedPerson({ body, role: 'requester', verifiedPrimaryPhone: '0911111111' }).primaryPhone, '0911111111');
  assert.throws(
    () => buildSubmittedPerson({ body, role: 'requester', verifiedPrimaryPhone: '0922222222' }),
    (error: any) => error?.message === 'verified_phone_does_not_match_requester',
  );
  const { requesterPhoneHasWhatsapp: _omitted, ...withoutWhatsapp } = body;
  assert.throws(
    () => buildSubmittedPerson({ body: withoutWhatsapp, role: 'requester' }),
    (error: any) => error?.message === 'missing_person_fields',
  );
});

test('registered person keeps immutable identity but may override or clear secondary contact', () => {
  const changed = withSecondaryContactOverride({
    person: requester,
    body: { requesterSecondaryPhone: '0944444444', requesterSecondaryPhoneHasWhatsapp: true },
    phoneField: 'requesterSecondaryPhone', whatsappField: 'requesterSecondaryPhoneHasWhatsapp',
  });
  assert.equal(changed.name, requester.name);
  assert.equal(changed.primaryPhone, requester.primaryPhone);
  assert.equal(changed.secondaryPhone, '0944444444');
  assert.equal(changed.secondaryPhoneHasWhatsapp, true);

  const cleared = withSecondaryContactOverride({
    person: requester,
    body: { secondaryPhone: '', secondaryPhoneHasWhatsapp: false },
    phoneField: 'secondaryPhone', whatsappField: 'secondaryPhoneHasWhatsapp',
  });
  assert.equal(cleared.secondaryPhone, null);
  assert.equal(cleared.secondaryPhoneHasWhatsapp, false);
});

test('identity key groups remain separate and registered immutable fields are explicit', () => {
  for (const key of ['requesterFirstName', 'requesterPhone', 'requesterSecondaryPhone']) {
    assert.ok(REQUESTER_BODY_KEYS.includes(key as any));
    assert.ok(!IDENTITY_BODY_KEYS.includes(key as any));
  }
  for (const key of ['referrerFirstName', 'referrerPhone', 'referrerSecondaryPhone']) {
    assert.ok(REFERRER_BODY_KEYS.includes(key as any));
    assert.ok(!IDENTITY_BODY_KEYS.includes(key as any));
  }
  for (const key of ['firstName', 'fatherName', 'lastName', 'phoneNumber', 'primaryPhone', 'phone', 'primaryPhoneHasWhatsapp']) {
    assert.ok(IDENTITY_BODY_KEYS.includes(key as any), `${key} must be immutable for registered self`);
  }
  for (const key of ['secondaryPhone', 'secondaryPhoneHasWhatsapp', 'governorateId', 'detailedAddress']) {
    assert.ok(!IDENTITY_BODY_KEYS.includes(key as any), `${key} remains request-editable`);
  }
});

test('OTP handle is never copied to the immutable submitted payload', () => {
  assert.deepEqual(
    sanitizeMobileSubmittedPayload({ requestType: 'water_check', handle: 'secret', notes: 'x' }),
    { requestType: 'water_check', notes: 'x' },
  );
});
