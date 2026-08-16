import { assertPayloadWithinLimit, type FormValidationIssue, type FormValidationResult } from './waterCheckFormSchema.js';

export { assertPayloadWithinLimit };

export const EMERGENCY_MAINTENANCE_FORM_VERSION = 'emergency_maintenance.mobile.v2';

const ENVELOPE_KEYS = new Set(['requestType', 'formVersion', 'handle']);
const STRING_LIMITS: Record<string, number> = {
  submissionMode: 20,
  referrerMode: 30,
  firstName: 60,
  fatherName: 60,
  lastName: 60,
  requesterFirstName: 60,
  requesterFatherName: 60,
  requesterLastName: 60,
  requesterPhone: 20,
  requesterSecondaryPhone: 20,
  referrerFirstName: 60,
  referrerFatherName: 60,
  referrerLastName: 60,
  referrerPhone: 20,
  referrerSecondaryPhone: 20,
  referrerDetailedAddress: 500,
  phoneNumber: 20,
  primaryPhone: 20,
  phone: 20,
  secondaryPhone: 20,
  secondary_phone: 20,
  detailedAddress: 500,
  detailed_address: 500,
  deviceSelectionType: 32,
  deviceName: 255,
  serialNumber: 100,
  problemDescription: 2000,
};
const BOOLEAN_KEYS = new Set([
  'requesterPhoneHasWhatsapp', 'requesterSecondaryPhoneHasWhatsapp',
  'referrerPhoneHasWhatsapp', 'referrerSecondaryPhoneHasWhatsapp',
  'primaryPhoneHasWhatsapp', 'secondaryPhoneHasWhatsapp',
]);
const GEO_KEYS = new Set([
  'governorateId', 'governorate', 'regionId', 'region', 'cityOrArea',
  'subdistrictId', 'subdistrict', 'subArea', 'neighborhoodId', 'neighborhood',
  'installedDeviceId', 'deviceModelId',
  'referrerGovernorate', 'referrerCityOrArea', 'referrerSubArea', 'referrerNeighborhood',
]);
const LOCATION_KEYS = new Set(['mapLocation', 'map_location', 'location', 'referrerMapLocation']);
const ARRAY_KEYS = new Set(['safetyIndicatorCodes', 'attachments']);

function issueFor(key: string, value: unknown): FormValidationIssue | null {
  if (value == null) return null;
  if (key === 'submissionMode') {
    return value === 'for_self' || value === 'for_another' ? null : { field: key, rule: 'out_of_range' };
  }
  if (key === 'referrerMode') {
    return value === 'none' || value === 'requester' || value === 'separate_person'
      ? null : { field: key, rule: 'out_of_range' };
  }
  if (key === 'deviceSelectionType') {
    return value === 'registered_device' || value === 'catalog_model' || value === 'other'
      ? null : { field: key, rule: 'out_of_range' };
  }
  if (Object.prototype.hasOwnProperty.call(STRING_LIMITS, key)) {
    if (typeof value !== 'string') return { field: key, rule: 'wrong_type' };
    const limit = STRING_LIMITS[key];
    return value.length > limit ? { field: key, rule: 'too_long', limit } : null;
  }
  if (BOOLEAN_KEYS.has(key)) {
    return typeof value === 'boolean' || value === 'true' || value === 'false' || value === '1' || value === '0'
      ? null : { field: key, rule: 'wrong_type' };
  }
  if (GEO_KEYS.has(key)) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n)) return { field: key, rule: 'wrong_type' };
    return n > 0 && n <= 2_147_483_647 ? null : { field: key, rule: 'out_of_range' };
  }
  if (LOCATION_KEYS.has(key)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { field: key, rule: 'wrong_type' };
    const location = value as Record<string, unknown>;
    const extras = Object.keys(location).filter((part) => part !== 'lat' && part !== 'lng');
    const lat = Number(location.lat);
    const lng = Number(location.lng);
    return extras.length === 0 && Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      ? null : { field: key, rule: 'out_of_range' };
  }
  if (ARRAY_KEYS.has(key)) {
    if (!Array.isArray(value)) return { field: key, rule: 'wrong_type' };
    if (key === 'safetyIndicatorCodes') {
      return value.length <= 20 && value.every((item) => typeof item === 'string' && item.length <= 80)
        ? null : { field: key, rule: 'out_of_range' };
    }
    if (key === 'attachments') {
      return value.length <= 6 && value.every((item) => !!item && typeof item === 'object' && !Array.isArray(item))
        ? null : { field: key, rule: 'out_of_range' };
    }
  }
  return { field: key, rule: 'unknown_field' };
}

export function validateEmergencyMaintenanceForm(body: Record<string, unknown>): FormValidationResult {
  const issues: FormValidationIssue[] = [];
  const unknownFields: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    const issue = issueFor(key, value);
    if (!issue) continue;
    issues.push(issue);
    if (issue.rule === 'unknown_field') unknownFields.push(key);
  }
  return { ok: issues.length === 0, issues, unknownFields };
}
