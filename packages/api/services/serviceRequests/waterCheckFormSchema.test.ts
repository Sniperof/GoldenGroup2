import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WATER_CHECK_FORM_VERSION,
  assertPayloadWithinLimit,
  validateWaterCheckForm,
} from './waterCheckFormSchema.js';

const valid = {
  requestType: 'water_check',
  formVersion: WATER_CHECK_FORM_VERSION,
  handle: 'a-uuid',
  submissionMode: 'for_self',
  firstName: 'أحمد',
  lastName: 'العلي',
  phoneNumber: '0912345678',
  governorateId: 3,
  detailedAddress: 'شارع الحمرا، بناء 5',
  mapLocation: { lat: 33.5, lng: 36.3 },
  primaryPhoneHasWhatsapp: true,
  notes: 'الماء عكر',
};

test('the declared form passes and envelope keys are not treated as fields', () => {
  const result = validateWaterCheckForm(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('an undeclared key is rejected, not silently stored', () => {
  const result = validateWaterCheckForm({ ...valid, injectedBlob: 'x'.repeat(50) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknownFields, ['injectedBlob']);
  assert.equal(result.issues[0].rule, 'unknown_field');
});

test('an over-long declared field is rejected with its limit', () => {
  const result = validateWaterCheckForm({ ...valid, notes: 'ن'.repeat(1001) });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].field, 'notes');
  assert.equal(result.issues[0].rule, 'too_long');
  assert.equal(result.issues[0].limit, 1000);
});

test('geo ids must be positive integers within INTEGER range', () => {
  assert.equal(validateWaterCheckForm({ ...valid, governorateId: 0 }).ok, false);
  assert.equal(validateWaterCheckForm({ ...valid, governorateId: -3 }).ok, false);
  assert.equal(validateWaterCheckForm({ ...valid, governorateId: 3.5 }).ok, false);
  assert.equal(validateWaterCheckForm({ ...valid, governorateId: 9_999_999_999 }).ok, false);
  // Numeric strings stay accepted — the handler already coerced them.
  assert.equal(validateWaterCheckForm({ ...valid, governorateId: '3' }).ok, true);
});

test('the shared SmartGeo address vocabulary accepts all four administrative levels', () => {
  const result = validateWaterCheckForm({
    ...valid,
    governorateId: undefined,
    governorate: 1,
    cityOrArea: 2,
    subArea: 3,
    neighborhood: 4,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('coordinates are bounded and carry no extra keys', () => {
  assert.equal(validateWaterCheckForm({ ...valid, mapLocation: { lat: 91, lng: 0 } }).ok, false);
  assert.equal(validateWaterCheckForm({ ...valid, mapLocation: { lat: 0, lng: 181 } }).ok, false);
  assert.equal(
    validateWaterCheckForm({ ...valid, mapLocation: { lat: 33, lng: 36, payload: 'x' } }).ok,
    false,
  );
});

test('submissionMode only accepts the declared vocabulary', () => {
  assert.equal(validateWaterCheckForm({ ...valid, submissionMode: 'self' }).ok, false);
  assert.equal(validateWaterCheckForm({ ...valid, submissionMode: 'for_another' }).ok, true);
});

test('v4 declares the independent requester and mediator vocabulary', () => {
  assert.equal(validateWaterCheckForm({ ...valid, referrerMode: 'none' }).ok, true);
  assert.equal(validateWaterCheckForm({ ...valid, referrerMode: 'requester' }).ok, true);
  assert.equal(validateWaterCheckForm({ ...valid, referrerMode: 'separate_person' }).ok, true);
  assert.equal(validateWaterCheckForm({ ...valid, referrerMode: 'sender' }).ok, false);
  assert.equal(validateWaterCheckForm({
    ...valid,
    requesterFirstName: 'سالم', requesterPhone: '0911111111', requesterPhoneHasWhatsapp: true,
    referrerFirstName: 'نور', referrerPhone: '0922222222', referrerPhoneHasWhatsapp: false,
  }).ok, true);
});

test('null and absent optional fields are accepted', () => {
  const result = validateWaterCheckForm({ ...valid, fatherName: null, notes: undefined });
  assert.equal(result.ok, true);
});

test('payload size guard trips above the configured ceiling', () => {
  assert.equal(assertPayloadWithinLimit({ a: 'x'.repeat(100) }, 8000).ok, true);
  const big = assertPayloadWithinLimit({ a: 'x'.repeat(9000) }, 8000);
  assert.equal(big.ok, false);
  assert.equal(big.limit, 8000);
  assert.ok(big.size > 8000);
  // 0 disables the guard.
  assert.equal(assertPayloadWithinLimit({ a: 'x'.repeat(9000) }, 0).ok, true);
});
