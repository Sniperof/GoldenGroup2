import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVICE_REQUEST_FORM_VERSION, validateDeviceRequestForm } from './deviceRequestFormSchema.js';

test('device request v2 accepts purpose, zero or many models, parties, and optional full address', () => {
  const result = validateDeviceRequestForm({
    requestType: 'device_request',
    formVersion: DEVICE_REQUEST_FORM_VERSION,
    submissionMode: 'for_another',
    referrerMode: 'none',
    firstName: 'Beneficiary',
    lastName: 'Person',
    primaryPhone: '0999999999',
    primaryPhoneHasWhatsapp: true,
    purposeId: 10,
    deviceModelIds: [2, 3],
    notes: 'Needs a comparison',
    governorate: 1,
    cityOrArea: 2,
    subArea: 3,
    neighborhood: 4,
    detailedAddress: 'Optional context',
  });
  assert.deepEqual(result, { ok: true, issues: [], unknownFields: [] });
});

test('device request rejects attachments, quantities, and branch selection', () => {
  const result = validateDeviceRequestForm({
    attachments: [],
    quantity: 2,
    branchId: 3,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknownFields.sort(), ['attachments', 'branchId', 'quantity']);
});

test('device request caps unique transport selection payload to twenty model ids', () => {
  const result = validateDeviceRequestForm({ deviceModelIds: Array.from({ length: 21 }, (_, index) => index + 1) });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.field, 'deviceModelIds');
});

test('device request rejects repeated model ids instead of silently changing the submitted statement', () => {
  const result = validateDeviceRequestForm({ deviceModelIds: [4, 4] });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.field, 'deviceModelIds');
});
