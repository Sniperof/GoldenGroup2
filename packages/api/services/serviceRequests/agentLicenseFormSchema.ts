import type { FormValidationIssue, FormValidationResult } from './waterCheckFormSchema.js';

export const AGENT_LICENSE_FORM_VERSION = 'agent_license.mobile.v1';

const ENVELOPE_KEYS = new Set(['requestType', 'formVersion', 'handle']);
const STRING_LIMITS: Record<string, number> = {
  firstName: 60, middleName: 60, lastName: 60, idNumber: 40, birthDate: 10,
  primaryMobileNumber: 20, secondaryMobileNumber: 20, commercialRegistrationNumber: 80,
  businessActivityType: 160, previousExperience: 2_000, currentJobDescription: 2_000,
  detailedAddress: 500, additionalNotes: 2_000,
};
const BOOLEAN_FIELDS = new Set(['primaryMobileHasWhatsapp', 'secondaryMobileHasWhatsapp', 'hasCommercialRegistration']);
const INTEGER_FIELDS = new Set(['yearsOfExperience']);
const GEO_FIELDS = new Set(['governorate', 'region', 'subdistrict', 'neighborhood']);

function issue(field: string, rule: FormValidationIssue['rule'], limit?: number): FormValidationIssue {
  return { field, rule, ...(limit == null ? {} : { limit }) };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateAgentLicenseForm(body: Record<string, unknown>): FormValidationResult {
  const issues: FormValidationIssue[] = [];
  const unknownFields: string[] = [];
  const allowed = new Set([...ENVELOPE_KEYS, ...Object.keys(STRING_LIMITS), ...BOOLEAN_FIELDS,
    ...INTEGER_FIELDS, ...GEO_FIELDS, 'locationCoordinates', 'attachments']);
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) {
      unknownFields.push(key); issues.push(issue(key, 'unknown_field')); continue;
    }
    if (value == null || ENVELOPE_KEYS.has(key)) continue;
    if (key in STRING_LIMITS) {
      if (typeof value !== 'string') issues.push(issue(key, 'wrong_type'));
      else if (value.length > STRING_LIMITS[key]) issues.push(issue(key, 'too_long', STRING_LIMITS[key]));
    } else if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== 'boolean') issues.push(issue(key, 'wrong_type'));
    } else if (INTEGER_FIELDS.has(key)) {
      if (!Number.isInteger(value)) issues.push(issue(key, 'wrong_type'));
      else if ((value as number) < 0 || (value as number) > 100) issues.push(issue(key, 'out_of_range'));
    } else if (GEO_FIELDS.has(key)) {
      if (!Number.isInteger(value)) issues.push(issue(key, 'wrong_type'));
      else if ((value as number) <= 0 || (value as number) > 2_147_483_647) issues.push(issue(key, 'out_of_range'));
    } else if (key === 'locationCoordinates') {
      if (!object(value) || Object.keys(value).some((part) => part !== 'lat' && part !== 'lng')) {
        issues.push(issue(key, 'wrong_type'));
      } else if (typeof value.lat !== 'number' || typeof value.lng !== 'number') {
        issues.push(issue(key, 'wrong_type'));
      } else if (!Number.isFinite(value.lat) || !Number.isFinite(value.lng)
        || value.lat < -90 || value.lat > 90 || value.lng < -180 || value.lng > 180) {
        issues.push(issue(key, 'out_of_range'));
      }
    } else if (key === 'attachments') {
      if (!Array.isArray(value)) { issues.push(issue(key, 'wrong_type')); continue; }
      if (value.length > 10) issues.push(issue(key, 'out_of_range', 10));
      value.forEach((raw, index) => {
        if (!object(raw)) { issues.push(issue(`attachments.${index}`, 'wrong_type')); return; }
        const extras = Object.keys(raw).filter((part) => part !== 'uploadToken' && part !== 'category');
        if (extras.length || typeof raw.uploadToken !== 'string'
          || (raw.category !== 'photo' && raw.category !== 'document')) {
          issues.push(issue(`attachments.${index}`, 'wrong_type'));
        }
      });
    }
  }
  return { ok: issues.length === 0, issues, unknownFields };
}
