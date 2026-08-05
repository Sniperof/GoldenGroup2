// ============================================================
// serviceRequests/waterCheckFormSchema.ts
// ============================================================
// Declared field contract for the mobile water-check form (see
// WATER_CHECK_FORM_VERSION below for the active version).
//
// Unified template §17.4/2 requires "a validator that checks submitted payloads
// against the registry and form version". Version equality alone is not that
// validator: it agrees on a label while accepting any content. The submitted
// payload is IMMUTABLE (§6.2) and stored forever, so whatever passes here is
// permanent — an undeclared key is not a harmless extra, it is unreviewable
// data the section contract never promised a reviewer would understand.
//
// Fail-closed on purpose: unknown keys are rejected rather than dropped, so a
// mobile build that starts sending a new field learns immediately instead of
// silently losing it.
// ============================================================

/**
 * The active form version. Single source of truth: the handler registry, the
 * stored payload envelope, and the error details all read it from here, and the
 * registry row in the DB must equal it or the gateway refuses the type with
 * `request_type_configuration_mismatch` (fail-closed by design).
 *
 * v3 is the first unreleased contract that separates the three parties:
 * requester, beneficiary, and optional referrer/mediator. `submissionMode`
 * says who benefits; `referrerMode` independently says whether a mediator
 * exists. Because v3 has not reached an app or approved environment, its
 * contract is corrected in place rather than creating a misleading v4.
 */
export const WATER_CHECK_FORM_VERSION = 'water_check.mobile.v3';

/**
 * Envelope keys the gateway itself consumes — never part of the form.
 * `handle` stays declared through the OTP migration window (D-WC10): app
 * builds that still verify keep working instead of failing on an unknown key.
 */
export const WATER_CHECK_ENVELOPE_KEYS = ['requestType', 'formVersion', 'handle'] as const;

type FieldKind = 'string' | 'phone' | 'boolean' | 'geoId' | 'location' | 'mode' | 'referrerMode';

interface FieldSpec {
  kind: FieldKind;
  maxLength?: number;
}

/**
 * The declared form. Aliases the handler already accepted are kept so this
 * change validates the existing contract instead of narrowing it silently.
 */
export const WATER_CHECK_FIELDS: Record<string, FieldSpec> = {
  submissionMode: { kind: 'mode' },
  referrerMode: { kind: 'referrerMode' },

  // ── The beneficiary: who the water check is for ──
  firstName: { kind: 'string', maxLength: 60 },
  fatherName: { kind: 'string', maxLength: 60 },
  lastName: { kind: 'string', maxLength: 60 },

  // ── The requester: required separately for an external for_another ──
  requesterFirstName: { kind: 'string', maxLength: 60 },
  requesterFatherName: { kind: 'string', maxLength: 60 },
  requesterLastName: { kind: 'string', maxLength: 60 },
  requesterPhone: { kind: 'phone', maxLength: 20 },
  requesterPhoneHasWhatsapp: { kind: 'boolean' },
  requesterSecondaryPhone: { kind: 'phone', maxLength: 20 },
  requesterSecondaryPhoneHasWhatsapp: { kind: 'boolean' },

  // ── Optional separate mediator (`referrerMode=separate_person`) ──
  referrerFirstName: { kind: 'string', maxLength: 60 },
  referrerFatherName: { kind: 'string', maxLength: 60 },
  referrerLastName: { kind: 'string', maxLength: 60 },
  referrerPhone: { kind: 'phone', maxLength: 20 },
  referrerPhoneHasWhatsapp: { kind: 'boolean' },
  referrerSecondaryPhone: { kind: 'phone', maxLength: 20 },
  referrerSecondaryPhoneHasWhatsapp: { kind: 'boolean' },

  phoneNumber: { kind: 'phone', maxLength: 20 },
  primaryPhone: { kind: 'phone', maxLength: 20 },
  phone: { kind: 'phone', maxLength: 20 },
  secondaryPhone: { kind: 'phone', maxLength: 20 },
  secondary_phone: { kind: 'phone', maxLength: 20 },
  primaryPhoneHasWhatsapp: { kind: 'boolean' },
  secondaryPhoneHasWhatsapp: { kind: 'boolean' },

  governorateId: { kind: 'geoId' },
  governorate: { kind: 'geoId' },
  regionId: { kind: 'geoId' },
  region: { kind: 'geoId' },
  subdistrictId: { kind: 'geoId' },
  subdistrict: { kind: 'geoId' },
  neighborhoodId: { kind: 'geoId' },
  neighborhood: { kind: 'geoId' },

  detailedAddress: { kind: 'string', maxLength: 500 },
  detailed_address: { kind: 'string', maxLength: 500 },

  mapLocation: { kind: 'location' },
  map_location: { kind: 'location' },
  location: { kind: 'location' },

  notes: { kind: 'string', maxLength: 1000 },
};

export interface FormValidationIssue {
  field: string;
  rule: 'unknown_field' | 'wrong_type' | 'too_long' | 'out_of_range';
  limit?: number;
}

export interface FormValidationResult {
  ok: boolean;
  issues: FormValidationIssue[];
  unknownFields: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function checkValue(field: string, spec: FieldSpec, value: unknown): FormValidationIssue | null {
  if (value === null || value === undefined) return null;

  switch (spec.kind) {
    case 'string':
    case 'phone': {
      if (typeof value !== 'string') return { field, rule: 'wrong_type' };
      if (spec.maxLength && value.length > spec.maxLength) {
        return { field, rule: 'too_long', limit: spec.maxLength };
      }
      return null;
    }
    case 'mode': {
      if (typeof value !== 'string') return { field, rule: 'wrong_type' };
      if (value !== 'for_self' && value !== 'for_another') {
        return { field, rule: 'out_of_range' };
      }
      return null;
    }
    case 'referrerMode': {
      if (typeof value !== 'string') return { field, rule: 'wrong_type' };
      if (value !== 'none' && value !== 'requester' && value !== 'separate_person') {
        return { field, rule: 'out_of_range' };
      }
      return null;
    }
    case 'boolean': {
      const ok = typeof value === 'boolean'
        || value === 'true' || value === 'false' || value === '1' || value === '0';
      return ok ? null : { field, rule: 'wrong_type' };
    }
    case 'geoId': {
      const numeric = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value)
        : NaN;
      if (!Number.isInteger(numeric)) return { field, rule: 'wrong_type' };
      // Upper bound keeps the value inside INTEGER and out of overflow paths.
      if (numeric <= 0 || numeric > 2_147_483_647) return { field, rule: 'out_of_range' };
      return null;
    }
    case 'location': {
      if (!isPlainObject(value)) return { field, rule: 'wrong_type' };
      const extras = Object.keys(value).filter((k) => k !== 'lat' && k !== 'lng');
      if (extras.length > 0) return { field, rule: 'wrong_type' };
      const lat = typeof value.lat === 'number' ? value.lat : Number(value.lat);
      const lng = typeof value.lng === 'number' ? value.lng : Number(value.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { field, rule: 'wrong_type' };
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { field, rule: 'out_of_range' };
      }
      return null;
    }
    default:
      return { field, rule: 'unknown_field' };
  }
}

/**
 * Validates a submitted mobile body against the declared form. The envelope
 * keys are ignored here — the gateway has already consumed them.
 */
export function validateWaterCheckForm(body: Record<string, unknown>): FormValidationResult {
  const issues: FormValidationIssue[] = [];
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if ((WATER_CHECK_ENVELOPE_KEYS as readonly string[]).includes(key)) continue;
    const spec = WATER_CHECK_FIELDS[key];
    if (!spec) {
      unknownFields.push(key);
      issues.push({ field: key, rule: 'unknown_field' });
      continue;
    }
    const issue = checkValue(key, spec, value);
    if (issue) issues.push(issue);
  }

  return { ok: issues.length === 0, issues, unknownFields };
}

/**
 * Guards the size of the immutable payload before it is persisted. The Express
 * body limit is 10MB; nothing between it and the INSERT looked at the size, so
 * one call could bury megabytes of filler in a row that is never editable.
 */
export function assertPayloadWithinLimit(
  payload: unknown,
  maxChars: number,
): { ok: boolean; size: number; limit: number } {
  if (maxChars <= 0) return { ok: true, size: 0, limit: maxChars };
  const size = JSON.stringify(payload ?? null).length;
  return { ok: size <= maxChars, size, limit: maxChars };
}
