import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMERGENCY_MAINTENANCE_FORM_VERSION,
  validateEmergencyMaintenanceForm,
} from './emergencyMaintenanceFormSchema.js';

test('emergency maintenance v1 accepts all four administrative address levels', () => {
  const result = validateEmergencyMaintenanceForm({
    requestType: 'emergency_maintenance',
    formVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
    submissionMode: 'for_self',
    governorate: 1,
    cityOrArea: 2,
    subArea: 3,
    neighborhood: 4,
    detailedAddress: 'Building 12',
    deviceSelectionType: 'catalog_model',
    deviceModelId: 9,
    problemDescription: 'No water output',
    attachments: [{ uploadToken: '00000000-0000-4000-8000-000000000001', category: 'device_overview' }],
  });
  assert.deepEqual(result, { ok: true, issues: [], unknownFields: [] });
});

test('emergency maintenance v1 remains strict and rejects undeclared fields', () => {
  const result = validateEmergencyMaintenanceForm({
    requestType: 'emergency_maintenance',
    formVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
    hiddenAdminDecision: true,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknownFields, ['hiddenAdminDecision']);
});

test('mobile attachment envelope is capped at five images plus one video', () => {
  const result = validateEmergencyMaintenanceForm({
    attachments: Array.from({ length: 7 }, (_, index) => ({ uploadToken: String(index), category: 'device_overview' })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.field, 'attachments');
});
