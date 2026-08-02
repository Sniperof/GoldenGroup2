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
  assertNoOpenRequestForPhone,
  assertRequesterDailyQuota,
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
 * identity from the account. The WhatsApp flags are absent on purpose: they are
 * properties of the derived numbers and are read from the client record too.
 */
export const IDENTITY_BODY_KEYS = [
  'firstName', 'fatherName', 'lastName',
  'phoneNumber', 'primaryPhone', 'phone',
  'secondaryPhone', 'secondary_phone',
  'primaryPhoneHasWhatsapp', 'secondaryPhoneHasWhatsapp',
] as const;

/**
 * The referrer's own name (v2). Submitted only by a VISITOR sending
 * `for_another` — the one case where the sender is a distinct person with no
 * record to derive from. Refused everywhere else:
 *   - a logged-in customer's name comes from their client record,
 *   - `for_self` has no referrer at all, so the field would be meaningless.
 */
export const REFERRER_BODY_KEYS = [
  'referrerFirstName', 'referrerFatherName', 'referrerLastName',
] as const;

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

/** The sender's own name in `for_another` — derived or submitted, never both. */
export interface ReferrerName {
  firstName: string;
  fatherName: string | null;
  lastName: string;
  name: string;
  source: 'client_record' | 'submitted';
}

export function resolveMobileRequesterParties(input: {
  submissionMode: 'for_self' | 'for_another';
  appAccount?: AppAccountClaims;
  verifiedVisitorPhone?: string;
  beneficiaryExternal: Record<string, unknown>;
  /** Required in `for_another`; ignored in `for_self` (no referrer exists). */
  referrerName?: ReferrerName | null;
}) {
  if (!input.appAccount && !input.verifiedVisitorPhone) {
    throw new Error('verified_visitor_phone_required');
  }
  const senderIdentity: Record<string, unknown> = input.appAccount
    ? {
        primary_phone: input.appAccount.phone,
        identity_source: 'app_account',
        app_account_id: input.appAccount.appAccountId,
        client_id: input.appAccount.clientId,
      }
    : {
        primary_phone: input.verifiedVisitorPhone,
        identity_source: 'visitor_otp',
        identity_verification: 'otp',
      };

  // v2: the sender is no longer an anonymous phone number in `for_another`.
  // A reviewer could previously see only a verified number in the referrer
  // slot, with no way to say who vouched for the beneficiary.
  const senderName = input.submissionMode === 'for_another' && input.referrerName
    ? {
        firstName: input.referrerName.firstName,
        fatherName: input.referrerName.fatherName,
        lastName: input.referrerName.lastName,
        name: input.referrerName.name,
        name_source: input.referrerName.source,
      }
    : {};

  const requesterExternal: Record<string, unknown> = {
    partyRole: 'requester',
    ...senderIdentity,
    ...senderName,
  };
  return {
    requesterAppAccountId: input.appAccount?.appAccountId ?? null,
    requesterClientId: input.appAccount?.clientId ?? null,
    requesterExternal: input.submissionMode === 'for_self' && !input.appAccount
      ? { ...input.beneficiaryExternal, identity_source: 'visitor_otp', identity_verification: 'otp' }
      : requesterExternal,
    beneficiaryClientId: input.submissionMode === 'for_self' ? input.appAccount?.clientId ?? null : null,
    referrerClientId: input.submissionMode === 'for_another' ? input.appAccount?.clientId ?? null : null,
    // Its own object with the correct role — it used to be the requester
    // snapshot verbatim, so the referrer party claimed `partyRole: 'requester'`.
    referrerExternal: (input.submissionMode === 'for_another'
      ? { ...requesterExternal, partyRole: 'referrer' }
      : null) as Record<string, unknown> | null,
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
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  const notes = text(body, 'notes');
  const governorateId = positiveInt(body, 'governorateId', 'governorate');
  const regionId = positiveInt(body, 'regionId', 'region');
  const subdistrictId = positiveInt(body, 'subdistrictId', 'subdistrict');
  const neighborhoodId = positiveInt(body, 'neighborhoodId', 'neighborhood');
  const submissionMode = text(body, 'submissionMode') === 'for_another' ? 'for_another' : 'for_self';

  // A logged-in customer submitting for themselves IS the beneficiary, so the
  // beneficiary's identity comes from their record — never from the body. The
  // body's identity fields are refused rather than ignored (see
  // customerIdentity/identitySnapshot.ts for the full reasoning).
  const derivesIdentity = !!appAccount && submissionMode === 'for_self';

  // The referrer's name follows the same rule as the beneficiary's: derived
  // when a record exists, submitted only when one does not.
  let referrerName: ReferrerName | null = null;
  if (submissionMode === 'for_another') {
    if (appAccount) {
      const sent = REFERRER_BODY_KEYS.filter((k) => body[k] !== undefined && body[k] !== null);
      if (sent.length) {
        throw httpError(400, 'referrer_fields_not_accepted', {
          fields: sent,
          reason: 'referrer_identity_is_derived_from_profile',
        });
      }
      const snapshot = await resolveCustomerIdentitySnapshot(appAccount, db);
      referrerName = {
        firstName: snapshot.firstName,
        fatherName: snapshot.fatherName,
        lastName: snapshot.lastName,
        name: snapshot.name,
        source: 'client_record',
      };
    } else {
      const rFirst = text(body, 'referrerFirstName');
      const rFather = text(body, 'referrerFatherName');
      const rLast = text(body, 'referrerLastName');
      const missingReferrer = [
        !rFirst && 'referrerFirstName',
        !rLast && 'referrerLastName',
      ].filter(Boolean);
      if (missingReferrer.length) {
        throw httpError(400, 'missing_referrer_name', { fields: missingReferrer });
      }
      referrerName = {
        firstName: rFirst,
        fatherName: rFather || null,
        lastName: rLast,
        name: [rFirst, rFather, rLast].filter(Boolean).join(' '),
        source: 'submitted',
      };
    }
  } else {
    // No referrer exists in `for_self`, so the fields would be meaningless —
    // refuse rather than store a party the request does not have.
    const sent = REFERRER_BODY_KEYS.filter((k) => body[k] !== undefined && body[k] !== null);
    if (sent.length) {
      throw httpError(400, 'referrer_fields_not_accepted', {
        fields: sent,
        reason: 'for_self_has_no_referrer',
      });
    }
  }
  let firstName: string;
  let fatherName: string;
  let lastName: string;
  let phone: string;
  let secondaryPhone: string;
  let primaryPhoneHasWhatsapp: boolean;
  let secondaryPhoneHasWhatsapp: boolean;
  let identitySource: 'client_record' | 'submitted';

  if (derivesIdentity) {
    const sent = IDENTITY_BODY_KEYS.filter((key) => body[key] !== undefined && body[key] !== null);
    if (sent.length) {
      throw httpError(400, 'identity_fields_not_accepted', {
        fields: sent,
        reason: 'for_self_customer_identity_is_derived_from_profile',
      });
    }
    const snapshot = await resolveCustomerIdentitySnapshot(appAccount!, db);
    firstName = snapshot.firstName;
    fatherName = snapshot.fatherName ?? '';
    lastName = snapshot.lastName;
    phone = snapshot.primaryPhone;
    secondaryPhone = snapshot.secondaryPhone ?? '';
    primaryPhoneHasWhatsapp = snapshot.primaryPhoneHasWhatsapp;
    secondaryPhoneHasWhatsapp = snapshot.secondaryPhoneHasWhatsapp;
    identitySource = 'client_record';
  } else {
    firstName = text(body, 'firstName');
    fatherName = text(body, 'fatherName');
    lastName = text(body, 'lastName');
    phone = normalizePhone(text(body, 'phoneNumber', 'primaryPhone', 'phone'));
    const secondaryPhoneRaw = text(body, 'secondaryPhone', 'secondary_phone');
    secondaryPhone = secondaryPhoneRaw ? normalizePhone(secondaryPhoneRaw) : '';
    primaryPhoneHasWhatsapp = bool(body, 'primaryPhoneHasWhatsapp');
    secondaryPhoneHasWhatsapp = bool(body, 'secondaryPhoneHasWhatsapp');
    identitySource = 'submitted';
  }

  const missing = [
    // Only asked for when they are the caller's to supply; a derived identity
    // is already complete or resolveCustomerIdentitySnapshot refused it.
    ...(derivesIdentity ? [] : [
      !firstName && 'firstName',
      !lastName && 'lastName',
      !phone && 'phoneNumber',
    ]),
    !governorateId && 'governorateId',
    !detailedAddress && 'detailedAddress',
  ].filter(Boolean);
  if (missing.length) throw httpError(400, 'missing_required_fields', { fields: missing });
  if (!isValidSyrianMobile(phone)) throw httpError(400, 'invalid_phone');
  if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) throw httpError(400, 'invalid_secondary_phone');

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
  const name = [firstName, fatherName, lastName].filter(Boolean).join(' ');
  const beneficiaryExternal: Record<string, unknown> = {
    snapshotSchemaVersion: 1,
    partyRole: 'beneficiary',
    firstName,
    fatherName: fatherName || null,
    lastName,
    name,
    primary_phone: phone,
    primaryPhoneHasWhatsapp,
    secondary_phone: secondaryPhone || null,
    secondaryPhoneHasWhatsapp,
    // Provenance of the name/phones above: `client_record` means they were
    // derived from the linked record at submit time and were never accepted
    // from the request body. Kept on the snapshot so a reviewer can tell a
    // vouched-for identity from a self-declared one.
    identity_source: identitySource,
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
      firstName,
      fatherName: fatherName || null,
      lastName,
      mobile: phone,
      contacts: secondaryPhone ? [{ type: 'phone', value: secondaryPhone }] : [],
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

  if (verifiedVisitorPhone && submissionMode === 'for_self' && verifiedVisitorPhone !== phone) {
    throw httpError(400, 'verified_phone_does_not_match_beneficiary');
  }

  // Identity-level caps. Checked after validation so a malformed body never
  // consumes quota, and inside the intake transaction so they cannot be raced.
  await assertNoOpenRequestForPhone({
    db,
    requestType: 'water_check',
    beneficiaryPhone: phone,
  });
  await assertRequesterDailyQuota({ db, requestType: 'water_check', identity });

  const parties = resolveMobileRequesterParties({
    submissionMode,
    appAccount,
    verifiedVisitorPhone,
    beneficiaryExternal,
    referrerName,
  });

  const submittedPayload = {
    requestType: 'water_check',
    formVersion: WATER_CHECK_FORM_VERSION,
    capturedAt: new Date().toISOString(),
    requesterAuth: appAccount ? 'app_account' : 'visitor_otp',
    // `client_record` tells a reader why `data` carries no name or phone: the
    // customer never submitted them. Without it the payload looks truncated.
    identitySource,
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
      submitterTier: appAccount ? 'customer' : 'visitor',
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
  return {
    ...result.data,
    // `service_requests.id` is BIGINT — node-pg hands it back as a string, which
    // would reach the mobile client as `"84"` where the contract says integer.
    // Same boundary coercion the account paths already apply (DEC-013 §11.8).
    id: Number(result.data.id),
    reviewRequiredFlag: result.data.reviewRequiredFlag || branchResolution.status !== 'resolved',
    branchResolution,
    requesterAuth: appAccount ? 'app_account' : 'visitor_otp',
  };
}
