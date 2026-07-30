import type { PoolClient } from 'pg';
import { isValidSyrianMobile, normalizePhone } from '../../utils/contactValidation.js';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';
import { appendAudit } from './_shared.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { createServiceRequest } from './createService.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
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

export function resolveMobileRequesterParties(input: {
  submissionMode: 'for_self' | 'for_another';
  appAccount?: AppAccountClaims;
  verifiedVisitorPhone?: string;
  beneficiaryExternal: Record<string, unknown>;
}) {
  if (!input.appAccount && !input.verifiedVisitorPhone) {
    throw new Error('verified_visitor_phone_required');
  }
  const requesterExternal: Record<string, unknown> = input.appAccount
    ? {
        partyRole: 'requester',
        primary_phone: input.appAccount.phone,
        identity_source: 'app_account',
        app_account_id: input.appAccount.appAccountId,
        client_id: input.appAccount.clientId,
      }
    : {
        partyRole: 'requester',
        primary_phone: input.verifiedVisitorPhone,
        identity_source: 'visitor_otp',
        identity_verification: 'otp',
      };
  return {
    requesterAppAccountId: input.appAccount?.appAccountId ?? null,
    requesterClientId: input.appAccount?.clientId ?? null,
    requesterExternal: input.submissionMode === 'for_self' && !input.appAccount
      ? { ...input.beneficiaryExternal, identity_source: 'visitor_otp', identity_verification: 'otp' }
      : requesterExternal,
    beneficiaryClientId: input.submissionMode === 'for_self' ? input.appAccount?.clientId ?? null : null,
    referrerClientId: input.submissionMode === 'for_another' ? input.appAccount?.clientId ?? null : null,
    referrerExternal: input.submissionMode === 'for_another' ? requesterExternal : null,
  };
}

export async function submitMobileWaterCheck(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  const appAccount = identity.kind === 'customer' ? identity.account : undefined;
  const verifiedVisitorPhone = identity.kind === 'visitor' ? identity.phone : undefined;
  const firstName = text(body, 'firstName');
  const fatherName = text(body, 'fatherName');
  const lastName = text(body, 'lastName');
  const phone = normalizePhone(text(body, 'phoneNumber', 'primaryPhone', 'phone'));
  const secondaryPhoneRaw = text(body, 'secondaryPhone', 'secondary_phone');
  const secondaryPhone = secondaryPhoneRaw ? normalizePhone(secondaryPhoneRaw) : '';
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  const notes = text(body, 'notes');
  const governorateId = positiveInt(body, 'governorateId', 'governorate');
  const regionId = positiveInt(body, 'regionId', 'region');
  const subdistrictId = positiveInt(body, 'subdistrictId', 'subdistrict');
  const neighborhoodId = positiveInt(body, 'neighborhoodId', 'neighborhood');
  const deepestGeoUnitId = neighborhoodId ?? subdistrictId ?? regionId ?? governorateId;
  const submissionMode = text(body, 'submissionMode') === 'for_another' ? 'for_another' : 'for_self';

  const missing = [
    !firstName && 'firstName',
    !lastName && 'lastName',
    !phone && 'phoneNumber',
    !governorateId && 'governorateId',
    !detailedAddress && 'detailedAddress',
  ].filter(Boolean);
  if (missing.length) throw httpError(400, 'missing_required_fields', { fields: missing });
  if (!isValidSyrianMobile(phone)) throw httpError(400, 'invalid_phone');
  if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) throw httpError(400, 'invalid_secondary_phone');

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
    primaryPhoneHasWhatsapp: bool(body, 'primaryPhoneHasWhatsapp'),
    secondary_phone: secondaryPhone || null,
    secondaryPhoneHasWhatsapp: bool(body, 'secondaryPhoneHasWhatsapp'),
    detailedAddress,
    geoUnitId: deepestGeoUnitId,
    notes: notes || null,
    clientCompatible: {
      firstName,
      fatherName: fatherName || null,
      lastName,
      mobile: phone,
      contacts: secondaryPhone ? [{ type: 'phone', value: secondaryPhone }] : [],
      governorate: governorateId,
      district: regionId,
      neighborhood: neighborhoodId,
      detailedAddress,
      gpsCoordinates: location,
    },
  };
  const serviceAddress = {
    governorate: String(governorateId),
    governorateId,
    regionId,
    subdistrictId,
    neighborhoodId,
    geo_unit_id: deepestGeoUnitId,
    detailed_address: detailedAddress,
    detailedAddress,
    mapLocation: location,
  };
  const branchResolution = await resolveBranchForServiceGeoUnit(deepestGeoUnitId, db);

  if (verifiedVisitorPhone && submissionMode === 'for_self' && verifiedVisitorPhone !== phone) {
    throw httpError(400, 'verified_phone_does_not_match_beneficiary');
  }

  const parties = resolveMobileRequesterParties({
    submissionMode,
    appAccount,
    verifiedVisitorPhone,
    beneficiaryExternal,
  });

  const result = await createServiceRequest({
      requestType: 'water_check',
      channel: 'mobile_app',
      applicationSource: 'customer_mobile_app',
      submittedPayload: {
        requestType: 'water_check',
        formVersion: 'water_check.mobile.v1',
        capturedAt: new Date().toISOString(),
        requesterAuth: appAccount ? 'app_account' : 'visitor_otp',
        data: sanitizeMobileSubmittedPayload(body),
      },
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
    reviewRequiredFlag: result.data.reviewRequiredFlag || branchResolution.status !== 'resolved',
    branchResolution,
    requesterAuth: appAccount ? 'app_account' : 'visitor_otp',
  };
}
