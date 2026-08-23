import type { FormValidationIssue, FormValidationResult } from './waterCheckFormSchema.js';

export const DEVICE_REQUEST_FORM_VERSION = 'device_request.mobile.v2';

const STRING_LIMITS: Record<string, number> = {
  submissionMode: 20,
  referrerMode: 30,
  firstName: 60,
  fatherName: 60,
  lastName: 60,
  phoneNumber: 20,
  primaryPhone: 20,
  phone: 20,
  secondaryPhone: 20,
  secondary_phone: 20,
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
  detailedAddress: 500,
  detailed_address: 500,
  notes: 2000,
};
const ENVELOPE_KEYS = new Set(['requestType', 'formVersion', 'handle']);
const BOOLEAN_KEYS = new Set([
  'primaryPhoneHasWhatsapp', 'secondaryPhoneHasWhatsapp',
  'requesterPhoneHasWhatsapp', 'requesterSecondaryPhoneHasWhatsapp',
  'referrerPhoneHasWhatsapp', 'referrerSecondaryPhoneHasWhatsapp',
]);
const NUMBER_KEYS = new Set([
  'purposeId', 'governorateId', 'governorate', 'regionId', 'region', 'cityOrArea',
  'subdistrictId', 'subdistrict', 'subArea', 'neighborhoodId', 'neighborhood',
  'referrerGovernorate', 'referrerCityOrArea', 'referrerSubArea', 'referrerNeighborhood',
]);

function issueFor(key: string, value: unknown): FormValidationIssue | null {
  if (value == null) return null;
  if (key === 'submissionMode') {
    return value === 'for_self' || value === 'for_another' ? null : { field: key, rule: 'out_of_range' };
  }
  if (key === 'referrerMode') {
    return value === 'none' || value === 'requester' || value === 'separate_person'
      ? null : { field: key, rule: 'out_of_range' };
  }
  if (Object.prototype.hasOwnProperty.call(STRING_LIMITS, key)) {
    if (typeof value !== 'string') return { field: key, rule: 'wrong_type' };
    const limit = STRING_LIMITS[key];
    return value.length <= limit ? null : { field: key, rule: 'too_long', limit };
  }
  if (BOOLEAN_KEYS.has(key)) {
    return typeof value === 'boolean' || ['true', 'false', '1', '0'].includes(String(value))
      ? null : { field: key, rule: 'wrong_type' };
  }
  if (NUMBER_KEYS.has(key)) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && number <= 2_147_483_647
      ? null : { field: key, rule: 'out_of_range' };
  }
  if (key === 'deviceModelIds') {
    if (!Array.isArray(value)) return { field: key, rule: 'wrong_type' };
    const ids = value.map(Number);
    return ids.length <= 20
      && new Set(ids).size === ids.length
      && ids.every((id) => Number.isInteger(id) && id > 0)
      ? null : { field: key, rule: 'out_of_range' };
  }
  if (key === 'mapLocation' || key === 'map_location' || key === 'location' || key === 'referrerMapLocation') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { field: key, rule: 'wrong_type' };
    const location = value as Record<string, unknown>;
    const extras = Object.keys(location).filter((part) => part !== 'lat' && part !== 'lng');
    const lat = Number(location.lat);
    const lng = Number(location.lng);
    return extras.length === 0 && Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      ? null : { field: key, rule: 'out_of_range' };
  }
  return { field: key, rule: 'unknown_field' };
}

export function validateDeviceRequestForm(body: Record<string, unknown>): FormValidationResult {
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
