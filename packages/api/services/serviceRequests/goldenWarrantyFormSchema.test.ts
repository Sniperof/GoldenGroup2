import assert from 'node:assert/strict';
import test from 'node:test';
import { GOLDEN_WARRANTY_FORM_VERSION, validateGoldenWarrantyForm } from './goldenWarrantyFormSchema.js';

test('golden warranty accepts one installed device and a model-derived period', () => {
  assert.deepEqual(validateGoldenWarrantyForm({
    requestType: 'golden_warranty',
    formVersion: GOLDEN_WARRANTY_FORM_VERSION,
    submissionMode: 'for_self',
    installedDeviceId: 41,
    requestedWarrantyMonths: 24,
    beneficiaryContactConsentConfirmed: true,
  }), { ok: true, issues: [], unknownFields: [] });
});

test('golden warranty accepts another beneficiary and a catalog model without a referrer', () => {
  const result = validateGoldenWarrantyForm({
    requestType: 'golden_warranty',
    formVersion: GOLDEN_WARRANTY_FORM_VERSION,
    submissionMode: 'for_another',
    firstName: 'Beneficiary',
    lastName: 'Person',
    phoneNumber: '0930000000',
    primaryPhoneHasWhatsapp: false,
    requesterFirstName: 'Requester',
    requesterLastName: 'Person',
    requesterPhone: '0940000000',
    requesterPhoneHasWhatsapp: true,
    deviceModelId: 12,
    serialNumber: 'OPTIONAL',
    requestedWarrantyMonths: 12,
    beneficiaryContactConsentConfirmed: true,
  });
  assert.equal(result.ok, true);
});

test('golden warranty rejects price, multiple devices, and referrer semantics', () => {
  const result = validateGoldenWarrantyForm({
    price: 100,
    deviceModelIds: [1, 2],
    referrerMode: 'requester',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknownFields.sort(), ['deviceModelIds', 'price', 'referrerMode']);
});
