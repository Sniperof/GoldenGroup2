import { APP_WATER_CHECK_DAILY_PER_REQUESTER } from '../../config/env.js';
import { getSystemSettingNumber } from '../systemSettings.js';

export const DAILY_IDENTITY_SETTING_BY_REQUEST_TYPE = {
  water_check: 'water_check_daily_per_identity',
  emergency_maintenance: 'emergency_maintenance_daily_per_identity',
  device_request: 'device_request_daily_per_identity',
  periodic_maintenance: 'periodic_maintenance_daily_per_identity',
  golden_warranty: 'golden_warranty_daily_per_identity',
  name_nomination: 'name_nomination_daily_per_identity',
  agent_license: 'agent_license_daily_per_identity',
} as const;

// Preserve the former deployment-level value as a safe fallback until the
// migration has installed the per-type settings.
export const DEFAULT_DAILY_REQUESTS_PER_IDENTITY = APP_WATER_CHECK_DAILY_PER_REQUESTER;

export async function getDailyRequestsPerIdentity(requestType: string): Promise<number> {
  const key = DAILY_IDENTITY_SETTING_BY_REQUEST_TYPE[
    requestType as keyof typeof DAILY_IDENTITY_SETTING_BY_REQUEST_TYPE
  ];
  if (!key) return DEFAULT_DAILY_REQUESTS_PER_IDENTITY;
  const configured = await getSystemSettingNumber(key, DEFAULT_DAILY_REQUESTS_PER_IDENTITY);
  return Math.max(0, Math.floor(configured));
}
