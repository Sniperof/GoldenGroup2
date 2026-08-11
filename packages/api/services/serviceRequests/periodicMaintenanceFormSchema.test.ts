import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERIODIC_MAINTENANCE_FORM_VERSION,
  validatePeriodicMaintenanceForm,
} from './periodicMaintenanceFormSchema.js';

test('periodic maintenance accepts one catalog device, optional serial, reason, and address', () => {
  const result = validatePeriodicMaintenanceForm({
    requestType: 'periodic_maintenance',
    formVersion: PERIODIC_MAINTENANCE_FORM_VERSION,
    submissionMode: 'for_self',
    reasonId: 4,
    deviceSelectionType: 'catalog_model',
    deviceModelId: 9,
    serialNumber: 'OPTIONAL-SERIAL',
    governorate: 1,
    cityOrArea: 2,
    detailedAddress: 'Building 12',
  });
  assert.deepEqual(result, { ok: true, issues: [], unknownFields: [] });
});

test('periodic maintenance rejects media, problem, safety, and multiple-device fields', () => {
  const result = validatePeriodicMaintenanceForm({
    attachments: [],
    problemDescription: 'not part of this contract',
    safetyIndicatorCodes: [],
    deviceModelIds: [1, 2],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknownFields.sort(), [
    'attachments',
    'deviceModelIds',
    'problemDescription',
    'safetyIndicatorCodes',
  ]);
});

test('periodic maintenance validates selector and optional serial bounds', () => {
  const selector = validatePeriodicMaintenanceForm({ deviceSelectionType: 'many_devices' });
  assert.equal(selector.ok, false);
  assert.equal(selector.issues[0]?.rule, 'out_of_range');

  const serial = validatePeriodicMaintenanceForm({ serialNumber: 'x'.repeat(101) });
  assert.equal(serial.ok, false);
  assert.equal(serial.issues[0]?.limit, 100);
});
