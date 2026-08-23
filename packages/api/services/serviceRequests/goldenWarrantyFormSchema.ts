import type { FormValidationIssue, FormValidationResult } from './waterCheckFormSchema.js';
export { assertPayloadWithinLimit } from './waterCheckFormSchema.js';

export const GOLDEN_WARRANTY_FORM_VERSION = 'golden_warranty.mobile.v1';

const ENVELOPE_KEYS = new Set(['requestType', 'formVersion', 'handle']);
const STRING_LIMITS: Record<string, number> = {
  submissionMode: 20,
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
  serialNumber: 100,
  detailedAddress: 500,
  detailed_address: 500,
  notes: 1000,
};
const BOOLEAN_KEYS = new Set([
  'primaryPhoneHasWhatsapp', 'secondaryPhoneHasWhatsapp',
  'requesterPhoneHasWhatsapp', 'requesterSecondaryPhoneHasWhatsapp',
  'beneficiaryContactConsentConfirmed',
]);
const NUMBER_KEYS = new Set([
  'installedDeviceId', 'deviceModelId', 'requestedWarrantyMonths',
  'governorateId', 'governorate',
  'regionId', 'region', 'cityOrArea',
  'subdistrictId', 'subdistrict', 'subArea',
  'neighborhoodId', 'neighborhood',
]);

function issueFor(key: string, value: unknown): FormValidationIssue | null {
  if (value == null) return null;
  if (key === 'submissionMode') {
    return value === 'for_self' || value === 'for_another' ? null : { field: key, rule: 'out_of_range' };
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
  return { field: key, rule: 'unknown_field' };
}

export function validateGoldenWarrantyForm(body: Record<string, unknown>): FormValidationResult {
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
