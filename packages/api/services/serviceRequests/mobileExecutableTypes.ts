// ============================================================
// mobileExecutableTypes.ts
// ============================================================
// Single source of truth for "which request types can the mobile app actually
// open a form for right now". It is the intersection of the DB registry
// (service_request_type_config) and the code-side handler registry.
//
// Two callers depend on it and must never drift apart:
//   GET /api/app/service-requests/types  — the app's own type list
//   GET /api/app/home/banners            — drops banners whose target type is
//                                          no longer executable, so a tap can
//                                          never land on a dead form.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import {
  listActiveServiceRequestTypeDefinitions,
  type ServiceRequestTypeDefinition,
} from './serviceRequestTypeRegistry.js';
import { getMobileIntakeHandler, type MobileIntakeHandler } from './mobileIntakeRegistry.js';

export interface ExecutableMobileRequestType {
  definition: ServiceRequestTypeDefinition;
  handler: MobileIntakeHandler;
}

export async function listExecutableMobileRequestTypes(
  db?: Pool | PoolClient,
): Promise<ExecutableMobileRequestType[]> {
  const definitions = await listActiveServiceRequestTypeDefinitions(db);
  return definitions.flatMap((definition) => {
    const handler = getMobileIntakeHandler(definition.requestType);
    if (
      !handler ||
      !definition.channels.includes('mobile_app') ||
      handler.formVersion !== definition.defaultFormVersion ||
      definition.submissionModes.length === 0
    ) return [];
    return [{ definition, handler }];
  });
}

/** Arabic label per executable request type, for label-only consumers. */
export async function getExecutableMobileRequestTypeLabels(
  db?: Pool | PoolClient,
): Promise<Map<string, string>> {
  const executable = await listExecutableMobileRequestTypes(db);
  return new Map(executable.map(({ definition }) => [definition.requestType, definition.labelAr]));
}
