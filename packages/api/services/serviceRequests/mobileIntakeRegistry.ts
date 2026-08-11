import type { PoolClient } from 'pg';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { submitMobileWaterCheck } from './mobileWaterCheckIntake.js';
import { WATER_CHECK_FORM_VERSION } from './waterCheckFormSchema.js';
import { submitMobileEmergencyMaintenance } from './mobileEmergencyMaintenanceIntake.js';
import { EMERGENCY_MAINTENANCE_FORM_VERSION } from './emergencyMaintenanceFormSchema.js';
import { submitMobileDeviceRequest } from './mobileDeviceRequestIntake.js';
import { DEVICE_REQUEST_FORM_VERSION } from './deviceRequestFormSchema.js';
import { submitMobilePeriodicMaintenance } from './mobilePeriodicMaintenanceIntake.js';
import { PERIODIC_MAINTENANCE_FORM_VERSION } from './periodicMaintenanceFormSchema.js';
import { submitMobileGoldenWarranty } from './mobileGoldenWarrantyIntake.js';
import { GOLDEN_WARRANTY_FORM_VERSION } from './goldenWarrantyFormSchema.js';
import type { ServiceRequestTypeDefinition } from './serviceRequestTypeRegistry.js';

export interface MobileIntakeHandler {
  requestType: string;
  formVersion: string;
  /**
   * Accepts a submitter who proved nothing (DEC-016). Opt-in per handler and
   * absent by default, so a type added later inherits the strict behaviour
   * rather than the exception granted to water_check.
   */
  allowsUnverifiedIntake?: boolean;
  submit: (
    body: Record<string, unknown>,
    identity: MobileIntakeIdentity,
    db: PoolClient,
  ) => Promise<unknown>;
}

const handlers: Record<string, MobileIntakeHandler> = {
  water_check: {
    requestType: 'water_check',
    formVersion: WATER_CHECK_FORM_VERSION,
    allowsUnverifiedIntake: true,
    submit: submitMobileWaterCheck,
  },
  emergency_maintenance: {
    requestType: 'emergency_maintenance',
    formVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
    allowsUnverifiedIntake: true,
    submit: submitMobileEmergencyMaintenance,
  },
  device_request: {
    requestType: 'device_request',
    formVersion: DEVICE_REQUEST_FORM_VERSION,
    allowsUnverifiedIntake: true,
    submit: submitMobileDeviceRequest,
  },
  periodic_maintenance: {
    requestType: 'periodic_maintenance',
    formVersion: PERIODIC_MAINTENANCE_FORM_VERSION,
    allowsUnverifiedIntake: true,
    submit: submitMobilePeriodicMaintenance,
  },
  golden_warranty: {
    requestType: 'golden_warranty',
    formVersion: GOLDEN_WARRANTY_FORM_VERSION,
    allowsUnverifiedIntake: true,
    submit: submitMobileGoldenWarranty,
  },
};

export function getMobileIntakeHandler(requestType: string): MobileIntakeHandler | null {
  return handlers[requestType] ?? null;
}

export function listMobileIntakeHandlerCodes(): string[] {
  return Object.keys(handlers);
}

export type MobileIntakeAvailability =
  | { ok: true; handler: MobileIntakeHandler; submissionMode: 'for_self' | 'for_another' }
  | { ok: false; status: number; code: string; details?: Record<string, unknown> };

export function evaluateMobileIntakeAvailability(input: {
  definition: ServiceRequestTypeDefinition | null;
  requestType: string;
  isAuthenticatedCustomer: boolean;
  submittedFormVersion?: string | null;
  submittedMode?: string | null;
}): MobileIntakeAvailability {
  const definition = input.definition;
  if (!definition) return { ok: false, status: 404, code: 'unknown_request_type' };
  if (!definition.isActive) return { ok: false, status: 409, code: 'request_type_inactive' };
  const handler = getMobileIntakeHandler(input.requestType);
  if (!handler) return { ok: false, status: 501, code: 'request_type_not_implemented' };
  if (!definition.channels.includes('mobile_app')) {
    return { ok: false, status: 409, code: 'request_type_not_available_on_mobile' };
  }
  // An unauthenticated caller may land on either unproven tier depending on
  // whether they carry a handle, and that is only known after identity
  // resolution — so the gate here asks whether the registry accepts EITHER.
  const requesterTiers = input.isAuthenticatedCustomer
    ? ['customer']
    : handler.allowsUnverifiedIntake ? ['visitor', 'unverified'] : ['visitor'];
  if (!requesterTiers.some((tier) => definition.submitterTiers.includes(tier))) {
    return { ok: false, status: 403, code: 'request_type_not_available_for_requester' };
  }
  const submissionMode = input.submittedMode === 'for_another' ? 'for_another' : 'for_self';
  if (!definition.submissionModes.includes(submissionMode)) {
    return { ok: false, status: 400, code: 'unsupported_submission_mode' };
  }
  if (definition.defaultFormVersion !== handler.formVersion) {
    return {
      ok: false,
      status: 503,
      code: 'request_type_configuration_mismatch',
      details: { registryFormVersion: definition.defaultFormVersion, handlerFormVersion: handler.formVersion },
    };
  }
  if (input.submittedFormVersion && input.submittedFormVersion !== definition.defaultFormVersion) {
    return {
      ok: false,
      status: 409,
      code: 'unsupported_form_version',
      details: { expectedFormVersion: definition.defaultFormVersion },
    };
  }
  return { ok: true, handler, submissionMode };
}
