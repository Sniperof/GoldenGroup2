import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { buildMobileServiceAddress } from '../geo/mobileServiceAddress.js';
import { resolveCustomerIdentitySnapshot } from '../customerIdentity/identitySnapshot.js';
import { isValidSyrianMobile, normalizePhone } from '../../utils/contactValidation.js';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';
import { appendAudit } from './_shared.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { createServiceRequest } from './createService.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import {
  assertNoOpenRequestForRequester,
  assertRequesterDailyQuota,
  assertRequesterIpQuota,
} from './mobileIntakeThrottle.js';
import {
  WATER_CHECK_FORM_VERSION,
  assertPayloadWithinLimit,
  validateWaterCheckForm,
} from './waterCheckFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

/**
 * Body keys that assert WHO the beneficiary is. Refused when the server derives
 * identity from the account. The secondary phone is intentionally absent: it
 * is a request-level override and never mutates the client record.
 */
export const IDENTITY_BODY_KEYS = [
  'firstName', 'fatherName', 'lastName',
  'phoneNumber', 'primaryPhone', 'phone',
  'primaryPhoneHasWhatsapp',
] as const;

export const REQUESTER_BODY_KEYS = [
  'requesterFirstName', 'requesterFatherName', 'requesterLastName',
  'requesterPhone', 'requesterPhoneHasWhatsapp',
  'requesterSecondaryPhone', 'requesterSecondaryPhoneHasWhatsapp',
] as const;

/**
 * The referrer's own name (v2). Submitted only by a VISITOR sending
 * `for_another` — the one case where the sender is a distinct person with no
 * record to derive from. Refused everywhere else:
 *   - a logged-in customer's name comes from their client record,
 *   - `for_self` has no referrer at all, so the field would be meaningless.
 */
export const REFERRER_BODY_KEYS = [
  'referrerFirstName', 'referrerFatherName', 'referrerLastName', 'referrerPhone',
  'referrerPhoneHasWhatsapp', 'referrerSecondaryPhone', 'referrerSecondaryPhoneHasWhatsapp',
] as const;

export type WaterCheckReferrerMode = 'none' | 'requester' | 'separate_person';

export interface PersonSnapshot {
  firstName: string;
  fatherName: string | null;
  lastName: string;
  name: string;
  primaryPhone: string;
  primaryPhoneHasWhatsapp: boolean;
  secondaryPhone: string | null;
  secondaryPhoneHasWhatsapp: boolean;
  source: 'client_record' | 'submitted';
}

function text(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function positiveInt(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function bool(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  return value === true || value === 'true' || value === '1';
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function hasProvidedValue(source: Record<string, unknown>, key: string): boolean {
  return hasOwn(source, key) && source[key] !== undefined && source[key] !== null;
}

function suppliedKeys(source: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => source[key] !== undefined && source[key] !== null);
}

function personFieldNames(role: 'beneficiary' | 'requester' | 'referrer') {
  if (role === 'beneficiary') {
    return {
      first: 'firstName', father: 'fatherName', last: 'lastName',
      phone: 'phoneNumber', phoneAliases: ['phoneNumber', 'primaryPhone', 'phone'],
      phoneWhatsapp: 'primaryPhoneHasWhatsapp',
      secondary: 'secondaryPhone', secondaryAliases: ['secondaryPhone', 'secondary_phone'],
      secondaryWhatsapp: 'secondaryPhoneHasWhatsapp',
    };
  }
  const prefix = role === 'requester' ? 'requester' : 'referrer';
  return {
    first: `${prefix}FirstName`, father: `${prefix}FatherName`, last: `${prefix}LastName`,
    phone: `${prefix}Phone`, phoneAliases: [`${prefix}Phone`],
    phoneWhatsapp: `${prefix}PhoneHasWhatsapp`,
    secondary: `${prefix}SecondaryPhone`, secondaryAliases: [`${prefix}SecondaryPhone`],
    secondaryWhatsapp: `${prefix}SecondaryPhoneHasWhatsapp`,
  };
}

export function buildSubmittedPerson(input: {
  body: Record<string, unknown>;
  role: 'beneficiary' | 'requester' | 'referrer';
  verifiedPrimaryPhone?: string;
}): PersonSnapshot {
  const fields = personFieldNames(input.role);
  const firstName = text(input.body, fields.first);
  const fatherName = text(input.body, fields.father) || null;
  const lastName = text(input.body, fields.last);
  const submittedPrimary = normalizePhone(text(input.body, ...fields.phoneAliases));
  const primaryPhone = input.verifiedPrimaryPhone
    ? normalizePhone(input.verifiedPrimaryPhone)
    : submittedPrimary;
  const missing = [
    !firstName && fields.first,
    !lastName && fields.last,
    !primaryPhone && fields.phone,
    !hasProvidedValue(input.body, fields.phoneWhatsapp) && fields.phoneWhatsapp,
  ].filter(Boolean) as string[];
  if (missing.length) {
    throw httpError(400, 'missing_person_fields', { role: input.role, fields: missing });
  }
  if (input.verifiedPrimaryPhone && submittedPrimary && submittedPrimary !== primaryPhone) {
    throw httpError(400, 'verified_phone_does_not_match_requester');
  }
  if (!isValidSyrianMobile(primaryPhone)) {
    throw httpError(400, `invalid_${input.role}_phone`);
  }

  const secondaryRaw = text(input.body, ...fields.secondaryAliases);
  const secondaryPhone = secondaryRaw ? normalizePhone(secondaryRaw) : null;
  if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) {
    throw httpError(400, `invalid_${input.role}_secondary_phone`);
  }
  if (secondaryPhone === primaryPhone) {
    throw httpError(400, `duplicate_${input.role}_phone`);
  }
  if (secondaryPhone && !hasProvidedValue(input.body, fields.secondaryWhatsapp)) {
    throw httpError(400, 'missing_person_fields', {
      role: input.role,
      fields: [fields.secondaryWhatsapp],
    });
  }
  if (!secondaryPhone && bool(input.body, fields.secondaryWhatsapp)) {
    throw httpError(400, `secondary_whatsapp_without_${input.role}_phone`);
  }

  return {
    firstName,
    fatherName,
    lastName,
    name: [firstName, fatherName, lastName].filter(Boolean).join(' '),
    primaryPhone,
    primaryPhoneHasWhatsapp: bool(input.body, fields.phoneWhatsapp),
    secondaryPhone,
    secondaryPhoneHasWhatsapp: secondaryPhone ? bool(input.body, fields.secondaryWhatsapp) : false,
    source: 'submitted',
  };
}

function personFromCustomerSnapshot(
  snapshot: Awaited<ReturnType<typeof resolveCustomerIdentitySnapshot>>,
): PersonSnapshot {
  return {
    firstName: snapshot.firstName,
    fatherName: snapshot.fatherName,
    lastName: snapshot.lastName,
    name: snapshot.name,
    primaryPhone: snapshot.primaryPhone,
    primaryPhoneHasWhatsapp: snapshot.primaryPhoneHasWhatsapp,
    secondaryPhone: snapshot.secondaryPhone,
    secondaryPhoneHasWhatsapp: snapshot.secondaryPhoneHasWhatsapp,
    source: 'client_record',
  };
}

export function withSecondaryContactOverride(input: {
  person: PersonSnapshot;
  body: Record<string, unknown>;
  phoneField: 'secondaryPhone' | 'requesterSecondaryPhone';
  whatsappField: 'secondaryPhoneHasWhatsapp' | 'requesterSecondaryPhoneHasWhatsapp';
}): PersonSnapshot {
  const phoneFields = input.phoneField === 'secondaryPhone'
    ? ['secondaryPhone', 'secondary_phone']
    : [input.phoneField];
  const phoneSupplied = phoneFields.some((field) => hasOwn(input.body, field));
  const whatsappSupplied = hasProvidedValue(input.body, input.whatsappField);
  if (!phoneSupplied && !whatsappSupplied) return input.person;

  const rawPhone = text(input.body, ...phoneFields);
  const secondaryPhone = phoneSupplied
    ? (rawPhone ? normalizePhone(rawPhone) : null)
    : input.person.secondaryPhone;
  if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) {
    throw httpError(400, 'invalid_secondary_phone');
  }
  if (secondaryPhone === input.person.primaryPhone) {
    throw httpError(400, 'secondary_phone_matches_primary');
  }
  if (secondaryPhone && phoneSupplied && !whatsappSupplied) {
    throw httpError(400, 'secondary_phone_whatsapp_required', { field: input.whatsappField });
  }
  if (!secondaryPhone && bool(input.body, input.whatsappField)) {
    throw httpError(400, 'secondary_whatsapp_without_phone');
  }
  return {
    ...input.person,
    secondaryPhone,
    secondaryPhoneHasWhatsapp: secondaryPhone
      ? (whatsappSupplied ? bool(input.body, input.whatsappField) : input.person.secondaryPhoneHasWhatsapp)
      : false,
  };
}

function mapLocation(source: Record<string, unknown>): { lat: number; lng: number } | null {
  const raw = source.mapLocation ?? source.map_location ?? source.location;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const lat = typeof value.lat === 'number' ? value.lat : Number(value.lat);
  const lng = typeof value.lng === 'number' ? value.lng : Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

export function sanitizeMobileSubmittedPayload(body: Record<string, unknown>): Record<string, unknown> {
  const { handle: _handle, ...safe } = body;
  return safe;
}

/** The unverified tier's only identifier, carried onto the stored snapshot. */
export interface UnverifiedDevice {
  deviceId: string;
  ip: string | null;
}

export function resolveMobileRequesterParties(input: {
  submissionMode: 'for_self' | 'for_another';
  referrerMode: WaterCheckReferrerMode;
  appAccount?: AppAccountClaims;
  verifiedVisitorPhone?: string;
  /** Set only for the `unverified` tier — mutually exclusive with the two above. */
  unverifiedDevice?: UnverifiedDevice;
  requesterPerson: PersonSnapshot;
  beneficiaryExternal: Record<string, unknown>;
  referrerPerson?: PersonSnapshot | null;
}) {
  if (!input.appAccount && !input.verifiedVisitorPhone && !input.unverifiedDevice) {
    throw new Error('requester_identity_required');
  }
  if (input.submissionMode === 'for_self' && input.referrerMode !== 'none') {
    throw new Error('for_self_referrer_forbidden');
  }
  if (input.appAccount && input.referrerMode === 'separate_person') {
    throw new Error('registered_requester_separate_referrer_forbidden');
  }
  const resolvedReferrerPerson = input.referrerMode === 'requester'
    ? input.requesterPerson
    : input.referrerPerson;
  if (input.referrerMode !== 'none' && !resolvedReferrerPerson) {
    throw new Error('referrer_person_required');
  }
  // Three shapes, one field that tells them apart forever: `identity_source`.
  // A reviewer reading a stored row must be able to say what was proven at
  // submit time, and `identity_verification: 'none'` says it plainly rather
  // than leaving the absence of proof to be inferred from a missing key.
  const senderIdentity: Record<string, unknown> = input.appAccount
    ? {
        identity_source: 'app_account',
        identity_verification: 'app_account',
        app_account_id: input.appAccount.appAccountId,
        client_id: input.appAccount.clientId,
      }
    : input.verifiedVisitorPhone
      ? {
          identity_source: 'visitor_otp',
          identity_verification: 'otp',
        }
      : {
          identity_source: 'unverified_device',
          identity_verification: 'none',
          device_id: input.unverifiedDevice!.deviceId,
          requester_ip: input.unverifiedDevice!.ip,
        };

  const requesterExternal: Record<string, unknown> = {
    partyRole: 'requester',
    snapshotSchemaVersion: 2,
    firstName: input.requesterPerson.firstName,
    fatherName: input.requesterPerson.fatherName,
    lastName: input.requesterPerson.lastName,
    name: input.requesterPerson.name,
    primary_phone: input.requesterPerson.primaryPhone,
    primaryPhoneHasWhatsapp: input.requesterPerson.primaryPhoneHasWhatsapp,
    secondary_phone: input.requesterPerson.secondaryPhone,
    secondaryPhoneHasWhatsapp: input.requesterPerson.secondaryPhoneHasWhatsapp,
    name_source: input.requesterPerson.source,
    ...senderIdentity,
  };
  const requesterForSelf = {
    ...input.beneficiaryExternal,
    ...requesterExternal,
    partyRole: 'requester',
  };
  const referrerExternal = input.referrerMode === 'none'
    ? null
    : {
        partyRole: 'referrer',
        snapshotSchemaVersion: 2,
        firstName: resolvedReferrerPerson!.firstName,
        fatherName: resolvedReferrerPerson!.fatherName,
        lastName: resolvedReferrerPerson!.lastName,
        name: resolvedReferrerPerson!.name,
        primary_phone: resolvedReferrerPerson!.primaryPhone,
        primaryPhoneHasWhatsapp: resolvedReferrerPerson!.primaryPhoneHasWhatsapp,
        secondary_phone: resolvedReferrerPerson!.secondaryPhone,
        secondaryPhoneHasWhatsapp: resolvedReferrerPerson!.secondaryPhoneHasWhatsapp,
        name_source: resolvedReferrerPerson!.source,
        referrer_mode: input.referrerMode,
        same_as_requester: input.referrerMode === 'requester',
      };
  return {
    requesterAppAccountId: input.appAccount?.appAccountId ?? null,
    requesterClientId: input.appAccount?.clientId ?? null,
    requesterExternal: input.submissionMode === 'for_self' ? requesterForSelf : requesterExternal,
    beneficiaryClientId: input.submissionMode === 'for_self' ? input.appAccount?.clientId ?? null : null,
    referrerClientId: input.referrerMode === 'requester' ? input.appAccount?.clientId ?? null : null,
    referrerExternal: referrerExternal as Record<string, unknown> | null,
  };
}

export async function submitMobileWaterCheck(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  // Declared-form gate (template §17.4/2) BEFORE anything is read or stored:
  // the submitted payload is immutable, so an undeclared key would be permanent.
  const formCheck = validateWaterCheckForm(body);
  if (!formCheck.ok) {
    throw httpError(400, 'invalid_form_payload', {
      issues: formCheck.issues,
      ...(formCheck.unknownFields.length ? { unknownFields: formCheck.unknownFields } : {}),
      formVersion: WATER_CHECK_FORM_VERSION,
    });
  }

  const appAccount = identity.kind === 'customer' ? identity.account : undefined;
  const verifiedVisitorPhone = identity.kind === 'visitor' ? identity.phone : undefined;
  const unverifiedDevice = identity.kind === 'unverified'
    ? { deviceId: identity.deviceId, ip: identity.ip }
    : undefined;
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  const notes = text(body, 'notes');
  const governorateId = positiveInt(body, 'governorateId', 'governorate');
  const regionId = positiveInt(body, 'regionId', 'region');
  const subdistrictId = positiveInt(body, 'subdistrictId', 'subdistrict');
  const neighborhoodId = positiveInt(body, 'neighborhoodId', 'neighborhood');
  const rawSubmissionMode = text(body, 'submissionMode');
  if (!rawSubmissionMode) throw httpError(400, 'submission_mode_required');
  const submissionMode = rawSubmissionMode === 'for_another' ? 'for_another' : 'for_self';

  let referrerMode: WaterCheckReferrerMode = 'none';
  if (submissionMode === 'for_self') {
    if (hasOwn(body, 'referrerMode')) {
      throw httpError(400, 'referrer_mode_not_accepted', { reason: 'for_self_has_no_referrer' });
    }
    const partyFields = [...suppliedKeys(body, REQUESTER_BODY_KEYS), ...suppliedKeys(body, REFERRER_BODY_KEYS)];
    if (partyFields.length) {
      throw httpError(400, 'party_fields_not_accepted', {
        fields: partyFields,
        reason: 'for_self_requester_is_beneficiary',
      });
    }
  } else {
    const rawMode = text(body, 'referrerMode');
    if (!rawMode) throw httpError(400, 'referrer_mode_required');
    referrerMode = rawMode as WaterCheckReferrerMode;
    if (appAccount && referrerMode === 'separate_person') {
      throw httpError(400, 'registered_requester_separate_referrer_forbidden');
    }
  }

  const registeredPerson = appAccount
    ? personFromCustomerSnapshot(await resolveCustomerIdentitySnapshot(appAccount, db))
    : null;
  let beneficiaryPerson: PersonSnapshot;
  let requesterPerson: PersonSnapshot;

  if (appAccount && submissionMode === 'for_self') {
    const immutable = suppliedKeys(body, IDENTITY_BODY_KEYS);
    if (immutable.length) {
      throw httpError(400, 'identity_fields_not_accepted', {
        fields: immutable,
        reason: 'for_self_customer_identity_is_derived_from_profile',
      });
    }
    beneficiaryPerson = withSecondaryContactOverride({
      person: registeredPerson!,
      body,
      phoneField: 'secondaryPhone',
      whatsappField: 'secondaryPhoneHasWhatsapp',
    });
    requesterPerson = beneficiaryPerson;
  } else {
    beneficiaryPerson = buildSubmittedPerson({
      body,
      role: 'beneficiary',
      ...(verifiedVisitorPhone && submissionMode === 'for_self'
        ? { verifiedPrimaryPhone: verifiedVisitorPhone }
        : {}),
    });
    if (appAccount) {
      const immutableRequesterKeys = REQUESTER_BODY_KEYS.filter(
        (key) => key !== 'requesterSecondaryPhone' && key !== 'requesterSecondaryPhoneHasWhatsapp',
      );
      const immutable = suppliedKeys(body, immutableRequesterKeys);
      if (immutable.length) {
        throw httpError(400, 'requester_fields_not_accepted', {
          fields: immutable,
          reason: 'registered_requester_identity_is_derived_from_profile',
        });
      }
      requesterPerson = withSecondaryContactOverride({
        person: registeredPerson!,
        body,
        phoneField: 'requesterSecondaryPhone',
        whatsappField: 'requesterSecondaryPhoneHasWhatsapp',
      });
    } else if (submissionMode === 'for_self') {
      requesterPerson = beneficiaryPerson;
    } else {
      requesterPerson = buildSubmittedPerson({
        body,
        role: 'requester',
        ...(verifiedVisitorPhone ? { verifiedPrimaryPhone: verifiedVisitorPhone } : {}),
      });
    }
  }

  let referrerPerson: PersonSnapshot | null = null;
  const submittedReferrerFields = suppliedKeys(body, REFERRER_BODY_KEYS);
  if (referrerMode === 'none') {
    if (submittedReferrerFields.length) {
      throw httpError(400, 'referrer_fields_not_accepted', {
        fields: submittedReferrerFields,
        reason: 'referrer_mode_none',
      });
    }
  } else if (referrerMode === 'requester') {
    if (submittedReferrerFields.length) {
      throw httpError(400, 'referrer_fields_not_accepted', {
        fields: submittedReferrerFields,
        reason: 'referrer_is_requester',
      });
    }
    referrerPerson = requesterPerson;
  } else {
    referrerPerson = buildSubmittedPerson({ body, role: 'referrer' });
  }

  const missing = [!governorateId && 'governorateId', !detailedAddress && 'detailedAddress'].filter(Boolean);
  if (missing.length) throw httpError(400, 'missing_required_fields', { fields: missing });

  // The address is validated by THE shared validator — the same one
  // account_creation uses. Before this, water_check accepted any positive
  // integer as a geo id: a non-existent unit, a neighbourhood under a different
  // governorate, or a governorate id in the neighbourhood slot all passed, and
  // branch resolution then routed on whatever the deepest number happened to be.
  const resolvedAddress = await resolveAndValidateAddress({
    governorate: governorateId,
    cityOrArea: regionId,
    subArea: subdistrictId,
    neighborhood: neighborhoodId,
  }, db);
  const deepestGeoUnitId = resolvedAddress.ids.neighborhood
    ?? resolvedAddress.ids.subArea
    ?? resolvedAddress.ids.cityOrArea
    ?? resolvedAddress.ids.governorate;

  const location = mapLocation(body);
  const beneficiaryExternal: Record<string, unknown> = {
    snapshotSchemaVersion: 2,
    partyRole: 'beneficiary',
    firstName: beneficiaryPerson.firstName,
    fatherName: beneficiaryPerson.fatherName,
    lastName: beneficiaryPerson.lastName,
    name: beneficiaryPerson.name,
    primary_phone: beneficiaryPerson.primaryPhone,
    primaryPhoneHasWhatsapp: beneficiaryPerson.primaryPhoneHasWhatsapp,
    secondary_phone: beneficiaryPerson.secondaryPhone,
    secondaryPhoneHasWhatsapp: beneficiaryPerson.secondaryPhoneHasWhatsapp,
    // Provenance of the name/phones above: `client_record` means they were
    // derived from the linked record at submit time and were never accepted
    // from the request body. Kept on the snapshot so a reviewer can tell a
    // vouched-for identity from a self-declared one.
    identity_source: beneficiaryPerson.source,
    detailedAddress,
    geoUnitId: deepestGeoUnitId,
    // Legacy alias keys the admin review panel reads to render the geo path.
    governorateId: resolvedAddress.ids.governorate,
    regionId: resolvedAddress.ids.cityOrArea,
    subdistrictId: resolvedAddress.ids.subArea,
    neighborhoodId: resolvedAddress.ids.neighborhood,
    addressLabels: resolvedAddress.labels,
    notes: notes || null,
    clientCompatible: {
      firstName: beneficiaryPerson.firstName,
      fatherName: beneficiaryPerson.fatherName,
      lastName: beneficiaryPerson.lastName,
      mobile: beneficiaryPerson.primaryPhone,
      contacts: [
        {
          id: 'water-check-primary',
          type: 'mobile',
          number: beneficiaryPerson.primaryPhone,
          hasWhatsApp: beneficiaryPerson.primaryPhoneHasWhatsapp,
          isPrimary: true,
          status: 'active',
        },
        ...(beneficiaryPerson.secondaryPhone ? [{
          id: 'water-check-secondary',
          type: 'mobile',
          number: beneficiaryPerson.secondaryPhone,
          hasWhatsApp: beneficiaryPerson.secondaryPhoneHasWhatsapp,
          isPrimary: false,
          status: 'active',
        }] : []),
      ],
      governorate: resolvedAddress.ids.governorate,
      district: resolvedAddress.ids.cityOrArea,
      neighborhood: resolvedAddress.ids.neighborhood,
      detailedAddress,
      gpsCoordinates: location,
    },
  };
  const serviceAddress = buildMobileServiceAddress({
    resolved: resolvedAddress,
    deepestGeoUnitId,
    detailedAddress,
    location,
  });
  const branchResolution = await resolveBranchForServiceGeoUnit(deepestGeoUnitId, db);

  // Identity-level caps. Checked after validation so a malformed body never
  // consumes quota, and inside the intake transaction so they cannot be raced.
  // All three key on the SUBMITTER: a beneficiary-keyed rule would let anyone
  // lock a real customer out now that the number is unproven (DEC-016 D-WC4).
  await assertNoOpenRequestForRequester({ db, requestType: 'water_check', identity });
  await assertRequesterDailyQuota({ db, requestType: 'water_check', identity });
  await assertRequesterIpQuota({ db, requestType: 'water_check', identity });

  const parties = resolveMobileRequesterParties({
    submissionMode,
    referrerMode,
    appAccount,
    verifiedVisitorPhone,
    unverifiedDevice,
    requesterPerson,
    beneficiaryExternal,
    referrerPerson,
  });

  const requesterAuth = appAccount ? 'app_account' : verifiedVisitorPhone ? 'visitor_otp' : 'device';
  const submitterTier = appAccount ? 'customer' : verifiedVisitorPhone ? 'visitor' : 'unverified';

  const submittedPayload = {
    requestType: 'water_check',
    formVersion: WATER_CHECK_FORM_VERSION,
    capturedAt: new Date().toISOString(),
    requesterAuth,
    beneficiaryIdentitySource: beneficiaryPerson.source,
    requesterIdentitySource: requesterPerson.source,
    referrerMode,
    data: sanitizeMobileSubmittedPayload(body),
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) {
    throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });
  }

  const result = await createServiceRequest({
      requestType: 'water_check',
      channel: 'mobile_app',
      applicationSource: 'customer_mobile_app',
      submittedPayload,
      requesterAppAccountId: parties.requesterAppAccountId,
      requesterClientId: parties.requesterClientId,
      requesterExternal: parties.requesterExternal,
      beneficiaryClientId: parties.beneficiaryClientId,
      beneficiaryExternal,
      referrerClientId: parties.referrerClientId,
      referrerExternal: parties.referrerExternal,
      submissionType: submissionMode === 'for_another' ? 'refer_a_candidate' : 'apply',
      submitterTier,
      problemDescription: notes ? `طلب فحص مياه - ${notes}` : 'طلب فحص مياه',
      attachments: [],
      serviceAddress,
      priority: 'Normal',
      branchId: branchResolution.branchId,
      branchResolutionStatus: branchResolution.status,
      branchResolutionReason: branchResolution.reason,
      branchResolutionGeoUnitId: branchResolution.geoUnitId,
      actorUserId: null,
      actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);

  if (branchResolution.status !== 'resolved') {
      await db.query(
        `UPDATE service_requests SET review_required_flag = TRUE, updated_at = NOW() WHERE id = $1`,
        [result.data.id],
      );
      await appendAudit(db, {
        serviceRequestId: result.data.id,
        eventType: 'review_required_flag_set',
        actorUserId: null,
        actorRole: 'customer',
        payload: {
          reason: 'branch_resolution_required',
          auto: true,
          branch_resolution_status: branchResolution.status,
          branch_resolution_reason: branchResolution.reason,
          branch_candidates: branchResolution.candidates,
        },
      });
  }

  // DEC-016 D-WC9: an unverified-device submission is accepted as an intake
  // record only. Human review (not a confirmation call) decides whether the
  // request is suitable for linking and handoff.
  if (submitterTier === 'unverified') {
      await db.query(
        `UPDATE service_requests SET review_required_flag = TRUE, updated_at = NOW() WHERE id = $1`,
        [result.data.id],
      );
      await appendAudit(db, {
        serviceRequestId: result.data.id,
        eventType: 'review_required_flag_set',
        actorUserId: null,
        actorRole: 'customer',
        payload: { reason: 'submitter_unverified', auto: true, requester_auth: requesterAuth },
      });
  }

  return {
    ...result.data,
    // `service_requests.id` is BIGINT — node-pg hands it back as a string, which
    // would reach the mobile client as `"84"` where the contract says integer.
    // Same boundary coercion the account paths already apply (DEC-013 §11.8).
    id: Number(result.data.id),
    reviewRequiredFlag: result.data.reviewRequiredFlag
      || branchResolution.status !== 'resolved'
      || submitterTier === 'unverified',
    branchResolution,
    requesterAuth,
  };
}
