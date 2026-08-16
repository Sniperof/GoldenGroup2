import type { FormValidationIssue, FormValidationResult } from './waterCheckFormSchema.js';

export const NAME_NOMINATION_FORM_VERSION = 'name_nomination.mobile.v2';

const ENVELOPE_KEYS = new Set([
  'requestType', 'formVersion', 'handle',
  'requesterFirstName', 'requesterLastName', 'requesterPhone',
  'requesterPhoneHasWhatsapp', 'requesterSecondaryPhone',
  'requesterSecondaryPhoneHasWhatsapp', 'names',
]);
const ITEM_KEYS = new Set([
  'firstName', 'lastName', 'governorate', 'cityOrArea', 'subArea', 'neighborhood',
  'occupation', 'primaryPhone', 'primaryPhoneHasWhatsapp',
  'secondaryPhone', 'secondaryPhoneHasWhatsapp',
]);

export function validateNameNominationForm(body: Record<string, unknown>): FormValidationResult {
  const issues: FormValidationIssue[] = [];
  const unknownFields: string[] = [];
  for (const key of Object.keys(body)) {
    if (!ENVELOPE_KEYS.has(key)) {
      issues.push({ field: key, rule: 'unknown_field' });
      unknownFields.push(key);
    }
  }
  if (!Array.isArray(body.names)) {
    issues.push({ field: 'names', rule: 'wrong_type' });
  } else {
    body.names.forEach((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ field: `names.${index}`, rule: 'wrong_type' });
        return;
      }
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const field = `names.${index}.${key}`;
        if (!ITEM_KEYS.has(key)) {
          issues.push({ field, rule: 'unknown_field' });
          unknownFields.push(field);
          continue;
        }
        if (['firstName','lastName','occupation','primaryPhone','secondaryPhone'].includes(key)
          && item != null && typeof item !== 'string') issues.push({ field, rule: 'wrong_type' });
        if (['firstName','lastName','occupation'].includes(key)
          && typeof item === 'string' && item.length > 100) issues.push({ field, rule: 'too_long', limit: 100 });
        if (['primaryPhone','secondaryPhone'].includes(key)
          && typeof item === 'string' && item.length > 30) issues.push({ field, rule: 'too_long', limit: 30 });
        if (['governorate','cityOrArea','subArea','neighborhood'].includes(key) && item != null) {
          const n = Number(item);
          if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) issues.push({ field, rule: 'out_of_range' });
        }
        if (['primaryPhoneHasWhatsapp','secondaryPhoneHasWhatsapp'].includes(key)
          && item != null && typeof item !== 'boolean') issues.push({ field, rule: 'wrong_type' });
      }
    });
  }
  return { ok: issues.length === 0, issues, unknownFields };
}
