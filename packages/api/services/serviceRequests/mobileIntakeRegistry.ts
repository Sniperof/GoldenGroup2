import type { PoolClient } from 'pg';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { submitMobileWaterCheck } from './mobileWaterCheckIntake.js';
import type { ServiceRequestTypeDefinition } from './serviceRequestTypeRegistry.js';

export interface MobileIntakeHandler {
  requestType: string;
  formVersion: string;
  submit: (
    body: Record<string, unknown>,
    identity: MobileIntakeIdentity,
    db: PoolClient,
  ) => Promise<unknown>;
}

const handlers: Record<string, MobileIntakeHandler> = {
  water_check: {
    requestType: 'water_check',
    formVersion: 'water_check.mobile.v1',
    submit: submitMobileWaterCheck,
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
  const requesterTier = input.isAuthenticatedCustomer ? 'customer' : 'visitor';
  if (!definition.submitterTiers.includes(requesterTier)) {
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
