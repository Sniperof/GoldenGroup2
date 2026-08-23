import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMobileIntakeAvailability } from './mobileIntakeRegistry.js';
import { WATER_CHECK_FORM_VERSION } from './waterCheckFormSchema.js';
import { EMERGENCY_MAINTENANCE_FORM_VERSION } from './emergencyMaintenanceFormSchema.js';
import { DEVICE_REQUEST_FORM_VERSION } from './deviceRequestFormSchema.js';
import { PERIODIC_MAINTENANCE_FORM_VERSION } from './periodicMaintenanceFormSchema.js';
import { GOLDEN_WARRANTY_FORM_VERSION } from './goldenWarrantyFormSchema.js';
import { NAME_NOMINATION_FORM_VERSION } from './nameNominationFormSchema.js';
import { AGENT_LICENSE_FORM_VERSION } from './agentLicenseFormSchema.js';
import type { ServiceRequestTypeDefinition } from './serviceRequestTypeRegistry.js';

function definition(overrides: Partial<ServiceRequestTypeDefinition> = {}): ServiceRequestTypeDefinition {
  return {
    requestType: 'water_check',
    labelAr: 'طلب فحص المياه',
    descriptionAr: '',
    isActive: true,
    displayOrder: 10,
    defaultFormVersion: WATER_CHECK_FORM_VERSION,
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
    submittedFormVersion: WATER_CHECK_FORM_VERSION,
    submittedMode: 'for_self',
  });
  assert.equal(result.ok, true);
});

test('registry and installed handler jointly enable emergency maintenance', () => {
  const result = evaluateMobileIntakeAvailability({
    definition: definition({
      requestType: 'emergency_maintenance',
      defaultFormVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
    }),
    requestType: 'emergency_maintenance',
    isAuthenticatedCustomer: false,
    submittedFormVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
  });
  assert.equal(result.ok, true);
});

test('registry and installed handler jointly enable device request', () => {
  const result = evaluateMobileIntakeAvailability({
    definition: definition({
      requestType: 'device_request',
      defaultFormVersion: DEVICE_REQUEST_FORM_VERSION,
      submitterTiers: ['staff', 'unverified', 'visitor', 'customer'],
    }),
    requestType: 'device_request',
    isAuthenticatedCustomer: false,
    submittedFormVersion: DEVICE_REQUEST_FORM_VERSION,
    submittedMode: 'for_another',
  });
  assert.equal(result.ok, true);
});

test('registry and installed handler jointly enable periodic maintenance for visitors and customers', () => {
  for (const isAuthenticatedCustomer of [false, true]) {
    const result = evaluateMobileIntakeAvailability({
      definition: definition({
        requestType: 'periodic_maintenance',
        defaultFormVersion: PERIODIC_MAINTENANCE_FORM_VERSION,
        submitterTiers: ['staff', 'unverified', 'visitor', 'customer'],
      }),
      requestType: 'periodic_maintenance',
      isAuthenticatedCustomer,
      submittedFormVersion: PERIODIC_MAINTENANCE_FORM_VERSION,
      submittedMode: 'for_self',
    });
    assert.equal(result.ok, true);
  }
});

test('registry and installed handler jointly enable golden warranty for every public tier and both modes', () => {
  for (const isAuthenticatedCustomer of [false, true]) {
    for (const submittedMode of ['for_self', 'for_another'] as const) {
      const result = evaluateMobileIntakeAvailability({
        definition: definition({
          requestType: 'golden_warranty',
          defaultFormVersion: GOLDEN_WARRANTY_FORM_VERSION,
          submitterTiers: ['staff', 'unverified', 'visitor', 'customer'],
        }),
        requestType: 'golden_warranty',
        isAuthenticatedCustomer,
        submittedFormVersion: GOLDEN_WARRANTY_FORM_VERSION,
        submittedMode,
      });
      assert.equal(result.ok, true);
    }
  }
});

test('name nomination derives its sole nomination mode and accepts every public tier', () => {
  for (const isAuthenticatedCustomer of [false,true]) {
    const result=evaluateMobileIntakeAvailability({
      definition:definition({requestType:'name_nomination',defaultFormVersion:NAME_NOMINATION_FORM_VERSION,
        submitterTiers:['unverified','visitor','customer'],submissionModes:['nomination']}),
      requestType:'name_nomination',isAuthenticatedCustomer,submittedFormVersion:NAME_NOMINATION_FORM_VERSION,
    });
    assert.equal(result.ok,true);
    if(result.ok) assert.equal(result.submissionMode,'nomination');
  }
});

test('agent license derives self_only and accepts every public tier', () => {
  for (const isAuthenticatedCustomer of [false, true]) {
    const result = evaluateMobileIntakeAvailability({
      definition: definition({ requestType: 'agent_license', defaultFormVersion: AGENT_LICENSE_FORM_VERSION,
        submitterTiers: ['unverified','visitor','customer'], submissionModes: ['self_only'] }),
      requestType: 'agent_license', isAuthenticatedCustomer, submittedFormVersion: AGENT_LICENSE_FORM_VERSION,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.submissionMode, 'self_only');
  }
});

test('an active database row without a code handler remains fail-closed', () => {
  const result = evaluateMobileIntakeAvailability({
    definition: definition({ requestType: 'future_request' }),
    requestType: 'future_request',
    isAuthenticatedCustomer: false,
  });
  assert.deepEqual(result, { ok: false, status: 501, code: 'request_type_not_implemented' });
});

test('a form-version drift between registry and code disables intake', () => {
  const result = evaluateMobileIntakeAvailability({
    // Derived from the live constant rather than hardcoded: this test used to
    // name the next real version, so shipping that version silently turned the
    // drift case into the matching case and the assertion stopped testing.
    definition: definition({ defaultFormVersion: `${WATER_CHECK_FORM_VERSION}.drifted` }),
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
