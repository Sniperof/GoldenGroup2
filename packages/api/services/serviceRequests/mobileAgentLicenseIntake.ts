import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import { isValidSyrianMobile, normalizePhone } from '../../utils/contactValidation.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { buildMobileServiceAddress } from '../geo/mobileServiceAddress.js';
import { appendAudit } from './_shared.js';
import { AGENT_LICENSE_FORM_VERSION, validateAgentLicenseForm } from './agentLicenseFormSchema.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { createServiceRequest } from './createService.js';
import { resolveAgentLicenseAttachments } from './mobileAttachmentIntake.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { assertRequesterDailyQuota, assertRequesterIpQuota } from './mobileIntakeThrottle.js';
import { assertPayloadWithinLimit } from './waterCheckFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function required(body: Record<string, unknown>, key: string): string {
  const value = text(body[key]);
  if (!value) throw httpError(400, 'missing_required_fields', { fields: [key] });
  return value;
}

export async function submitMobileAgentLicense(body: Record<string, unknown>, identity: MobileIntakeIdentity, db: PoolClient) {
  const form = validateAgentLicenseForm(body);
  if (!form.ok) throw httpError(400, 'invalid_form_payload', { issues: form.issues, unknownFields: form.unknownFields });
  const firstName = required(body, 'firstName');
  const middleName = text(body.middleName) || null;
  const lastName = required(body, 'lastName');
  const idNumber = text(body.idNumber) || null;
  const birthDate = required(body, 'birthDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(`${birthDate}T00:00:00Z`))
    || birthDate >= new Date().toISOString().slice(0, 10)) throw httpError(400, 'invalid_birth_date');
  const primaryMobileNumber = normalizePhone(required(body, 'primaryMobileNumber'));
  if (!isValidSyrianMobile(primaryMobileNumber)) throw httpError(400, 'invalid_primary_mobile_number');
  const verifiedPhone = identity.kind === 'customer' ? normalizePhone(identity.account.phone)
    : identity.kind === 'visitor' ? normalizePhone(identity.phone) : null;
  if (verifiedPhone && verifiedPhone !== primaryMobileNumber) throw httpError(400, 'verified_phone_does_not_match_applicant');
  const secondaryMobileNumber = text(body.secondaryMobileNumber) ? normalizePhone(body.secondaryMobileNumber) : null;
  if (secondaryMobileNumber && !isValidSyrianMobile(secondaryMobileNumber)) throw httpError(400, 'invalid_secondary_mobile_number');
  if (secondaryMobileNumber === primaryMobileNumber) throw httpError(400, 'duplicate_applicant_mobile_number');
  if (!secondaryMobileNumber && body.secondaryMobileHasWhatsapp != null) throw httpError(400, 'secondary_whatsapp_without_phone');
  if (typeof body.hasCommercialRegistration !== 'boolean') throw httpError(400, 'missing_required_fields', { fields: ['hasCommercialRegistration'] });
  const commercialRegistrationNumber = text(body.commercialRegistrationNumber) || null;
  if (body.hasCommercialRegistration && !commercialRegistrationNumber) throw httpError(400, 'commercial_registration_number_required');
  if (!body.hasCommercialRegistration && commercialRegistrationNumber) throw httpError(400, 'commercial_registration_number_not_accepted');
  const businessActivityType = required(body, 'businessActivityType');
  if (!Number.isInteger(body.yearsOfExperience)) throw httpError(400, 'missing_required_fields', { fields: ['yearsOfExperience'] });
  const governorate = body.governorate as number;
  if (!governorate) throw httpError(400, 'missing_required_fields', { fields: ['governorate'] });
  const resolved = await resolveAndValidateAddress({ governorate, cityOrArea: body.region as number | undefined,
    subArea: body.subdistrict as number | undefined, neighborhood: body.neighborhood as number | undefined }, db);
  const deepest = resolved.ids.neighborhood ?? resolved.ids.subArea ?? resolved.ids.cityOrArea ?? resolved.ids.governorate;
  const location = body.locationCoordinates as { lat: number; lng: number } | undefined;
  const detailedAddress = text(body.detailedAddress) || null;
  const serviceAddress = buildMobileServiceAddress({ resolved, deepestGeoUnitId: deepest,
    detailedAddress: detailedAddress ?? '', location: location ?? null });
  const branch = await resolveBranchForServiceGeoUnit(deepest, db);
  const media = await resolveAgentLicenseAttachments(body, identity, db);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent_license:${primaryMobileNumber}`]);
  const { rows: openRows } = await db.query<{ public_ref_number: string }>(
    `SELECT public_ref_number FROM service_requests
      WHERE request_type='agent_license' AND status=ANY($1)
        AND archived_at IS NULL AND requester_external->>'primary_phone'=$2
      ORDER BY created_at DESC LIMIT 1`,
    [['received', 'in_review', 'awaiting_customer_info'], primaryMobileNumber],
  );
  if (openRows[0]) throw httpError(409, 'open_request_exists', { publicRefNumber: openRows[0].public_ref_number, limit: 1 });
  await assertRequesterDailyQuota({ db, requestType: 'agent_license', identity });
  await assertRequesterIpQuota({ db, requestType: 'agent_license', identity });

  const applicant = {
    snapshotSchemaVersion: 1, partyRole: 'applicant', firstName, middleName, lastName,
    name: [firstName, middleName, lastName].filter(Boolean).join(' '), idNumber, birthDate,
    primary_phone: primaryMobileNumber,
    primaryPhoneHasWhatsapp: typeof body.primaryMobileHasWhatsapp === 'boolean' ? body.primaryMobileHasWhatsapp : null,
    secondary_phone: secondaryMobileNumber,
    secondaryPhoneHasWhatsapp: secondaryMobileNumber && typeof body.secondaryMobileHasWhatsapp === 'boolean'
      ? body.secondaryMobileHasWhatsapp : null,
    governorateId: resolved.ids.governorate, regionId: resolved.ids.cityOrArea,
    subdistrictId: resolved.ids.subArea, neighborhoodId: resolved.ids.neighborhood,
    addressLabels: resolved.labels, detailedAddress, location: location ?? null,
    identity_source: identity.kind === 'customer' ? 'app_account' : identity.kind === 'visitor' ? 'visitor_otp' : 'unverified_device',
    ...(identity.kind === 'unverified' ? { device_id: identity.deviceId, requester_ip: identity.ip } : {}),
  };
  const submittedPayload = {
    requestType: 'agent_license', formVersion: AGENT_LICENSE_FORM_VERSION,
    capturedAt: new Date().toISOString(), applicant,
    data: {
      hasCommercialRegistration: body.hasCommercialRegistration, commercialRegistrationNumber,
      businessActivityType, yearsOfExperience: body.yearsOfExperience,
      previousExperience: text(body.previousExperience) || null,
      currentJobDescription: text(body.currentJobDescription) || null,
      additionalNotes: text(body.additionalNotes) || null,
      attachments: media.attachments,
    },
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });
  const result = await createServiceRequest({
    requestType: 'agent_license', channel: 'mobile_app', applicationSource: 'customer_mobile_app',
    submittedPayload, requesterAppAccountId: identity.kind === 'customer' ? identity.account.appAccountId : null,
    requesterClientId: identity.kind === 'customer' ? identity.account.clientId : null,
    requesterExternal: applicant, submissionType: 'apply', submitterTier: identity.kind,
    problemDescription: text(body.additionalNotes) || 'طلب ترخيص وكيل', attachments: media.attachments,
    serviceAddress, branchId: branch.branchId, branchResolutionStatus: branch.status,
    branchResolutionReason: branch.reason, branchResolutionGeoUnitId: deepest,
    actorUserId: null, actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);
  if (media.uploadIds.length) await db.query(
    'UPDATE service_request_mobile_uploads SET consumed_at=NOW(),service_request_id=$2 WHERE id=ANY($1::uuid[])',
    [media.uploadIds, result.data.id],
  );
  let duplicateOfRequestId: number | null = result.data.duplicateOfRequestId;
  if (idNumber) {
    const { rows: duplicateRows } = await db.query<{ id: number }>(
      `SELECT id FROM service_requests
        WHERE request_type='agent_license' AND id<>$1
          AND requester_external->>'idNumber'=$2
        ORDER BY created_at DESC LIMIT 1`,
      [result.data.id, idNumber],
    );
    if (duplicateRows[0]) {
      duplicateOfRequestId = Number(duplicateRows[0].id);
      await db.query(
        `UPDATE service_requests SET duplicate_flag=TRUE,
          duplicate_of_request_id=COALESCE(duplicate_of_request_id,$2),updated_at=NOW() WHERE id=$1`,
        [result.data.id, duplicateOfRequestId],
      );
      await appendAudit(db, { serviceRequestId: result.data.id, eventType: 'duplicate_flag_set',
        actorUserId: null, actorRole: 'customer', payload: { reason: 'agent_license_id_number_match', auto: true } });
    }
  }
  const reviewRequired = true;
  await db.query('UPDATE service_requests SET review_required_flag=TRUE,updated_at=NOW() WHERE id=$1', [result.data.id]);
  await appendAudit(db, { serviceRequestId: result.data.id, eventType: 'review_required_flag_set',
    actorUserId: null, actorRole: 'customer', payload: { reason: identity.kind === 'unverified'
      ? 'submitter_unverified' : branch.status !== 'resolved'
        ? 'branch_resolution_required' : 'agent_license_human_decision_required', auto: true } });
  return { publicRefNumber: result.data.publicRefNumber, status: result.data.status,
    reviewRequired, possibleDuplicate: result.data.duplicateFlag || duplicateOfRequestId != null, branchResolution: branch };
}
