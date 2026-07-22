import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMobileIntakeAvailability } from './mobileIntakeRegistry.js';
import type { ServiceRequestTypeDefinition } from './serviceRequestTypeRegistry.js';

function definition(overrides: Partial<ServiceRequestTypeDefinition> = {}): ServiceRequestTypeDefinition {
  return {
    requestType: 'water_check',
    labelAr: 'طلب فحص المياه',
    descriptionAr: '',
    isActive: true,
    displayOrder: 10,
    defaultFormVersion: 'water_check.mobile.v1',
    formSource: 'code_seeded',
    channels: ['mobile_app'],
    submitterTiers: ['visitor', 'customer'],
    submissionModes: ['for_self', 'for_another'],
    externalPartyPolicy: {},
    mismatchPolicy: {},
    linkagePolicy: {},
    permissionPolicy: {},
    auditPolicy: {},
    ...overrides,
  };
}

test('registry and installed handler jointly enable water check', () => {
  const result = evaluateMobileIntakeAvailability({
    definition: definition(),
    requestType: 'water_check',
    isAuthenticatedCustomer: false,
    submittedFormVersion: 'water_check.mobile.v1',
    submittedMode: 'for_self',
  });
  assert.equal(result.ok, true);
});

test('an active database row without a code handler remains fail-closed', () => {
  const result = evaluateMobileIntakeAvailability({
    definition: definition({ requestType: 'emergency_maintenance' }),
    requestType: 'emergency_maintenance',
    isAuthenticatedCustomer: false,
  });
  assert.deepEqual(result, { ok: false, status: 501, code: 'request_type_not_implemented' });
});

test('a form-version drift between registry and code disables intake', () => {
  const result = evaluateMobileIntakeAvailability({
    definition: definition({ defaultFormVersion: 'water_check.mobile.v2' }),
    requestType: 'water_check',
    isAuthenticatedCustomer: true,
  });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.equal(result.code, 'request_type_configuration_mismatch');
});

test('requester tier and submission mode are enforced from the registry', () => {
  const tierResult = evaluateMobileIntakeAvailability({
    definition: definition({ submitterTiers: ['visitor'] }),
    requestType: 'water_check',
    isAuthenticatedCustomer: true,
  });
  assert.equal(tierResult.ok, false);
  if (tierResult.ok === false) assert.equal(tierResult.code, 'request_type_not_available_for_requester');

  const modeResult = evaluateMobileIntakeAvailability({
    definition: definition({ submissionModes: ['for_self'] }),
    requestType: 'water_check',
    isAuthenticatedCustomer: false,
    submittedMode: 'for_another',
  });
  assert.equal(modeResult.ok, false);
  if (modeResult.ok === false) assert.equal(modeResult.code, 'unsupported_submission_mode');
});
