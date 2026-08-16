import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { buildMobileServiceAddress } from '../geo/mobileServiceAddress.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { createServiceRequest } from './createService.js';
import { appendAudit } from './_shared.js';
import { assertRequesterDailyQuota, assertRequesterIpQuota } from './mobileIntakeThrottle.js';
import { mapLocation, positiveInt, sanitizeMobileSubmittedPayload, text } from './mobileWaterCheckIntake.js';
import { resolveMobileRequestPeople } from './mobileEmergencyMaintenanceIntake.js';
import { assertPayloadWithinLimit } from './waterCheckFormSchema.js';
import { DEVICE_REQUEST_FORM_VERSION, validateDeviceRequestForm } from './deviceRequestFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

export async function submitMobileDeviceRequest(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  const form = validateDeviceRequestForm(body);
  if (!form.ok) {
    throw httpError(400, 'invalid_form_payload', {
      issues: form.issues,
      ...(form.unknownFields.length ? { unknownFields: form.unknownFields } : {}),
      formVersion: DEVICE_REQUEST_FORM_VERSION,
    });
  }

  const purposeId = positiveInt(body, 'purposeId');
  if (!purposeId) throw httpError(400, 'purpose_id_required');
  const { rows: purposeRows } = await db.query<{ id: number; value: string; metadata: Record<string, unknown> }>(
    `SELECT id, value, metadata
       FROM system_lists
      WHERE id = $1 AND category = 'device_request_purpose' AND is_active = TRUE
      LIMIT 1`,
    [purposeId],
  );
  const purpose = purposeRows[0];
  if (!purpose) throw httpError(404, 'device_request_purpose_not_found');
  const purposeSnapshot = {
    id: Number(purpose.id),
    code: String(purpose.metadata?.code ?? purpose.value),
    label: purpose.value,
  };

  const deviceModelIds = Array.isArray(body.deviceModelIds)
    ? [...new Set(body.deviceModelIds.map(Number))]
    : [];
  const { rows: deviceRows } = deviceModelIds.length === 0 ? { rows: [] as Array<{ id: number; name: string; is_active: boolean }> }
    : await db.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, COALESCE(name_ar, name_en, name) AS name, is_active
         FROM device_models
        WHERE id = ANY($1::int[])`,
      [deviceModelIds],
    );
  if (deviceRows.length !== deviceModelIds.length || deviceRows.some((row) => row.is_active !== true)) {
    throw httpError(400, 'invalid_or_inactive_device_model_ids');
  }
  const rowById = new Map(deviceRows.map((row) => [Number(row.id), row]));
  const deviceSnapshots = deviceModelIds.map((id) => ({ id, name: rowById.get(id)!.name }));
  const notes = text(body, 'notes');
  if ((deviceModelIds.length === 0 || purposeSnapshot.code === 'other') && !notes) {
    throw httpError(400, 'device_request_notes_required');
  }

  const people = await resolveMobileRequestPeople({ body, identity, db });
  let branchId: number | null = null;
  if (people.parties.beneficiaryClientId != null) {
    const { rows } = await db.query<{ branch_id: number | null }>(
      'SELECT branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL',
      [people.parties.beneficiaryClientId],
    );
    branchId = rows[0]?.branch_id == null ? null : Number(rows[0].branch_id);
  }

  const governorate = positiveInt(body, 'governorateId', 'governorate');
  const cityOrArea = positiveInt(body, 'regionId', 'region', 'cityOrArea');
  const subArea = positiveInt(body, 'subdistrictId', 'subdistrict', 'subArea');
  const neighborhood = positiveInt(body, 'neighborhoodId', 'neighborhood');
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  let serviceAddress: Record<string, unknown> | null = null;
  let deepestGeoUnitId: number | null = null;
  if (governorate) {
    const resolved = await resolveAndValidateAddress({ governorate, cityOrArea, subArea, neighborhood }, db);
    deepestGeoUnitId = resolved.ids.neighborhood ?? resolved.ids.subArea ?? resolved.ids.cityOrArea ?? resolved.ids.governorate;
    serviceAddress = buildMobileServiceAddress({
      resolved,
      deepestGeoUnitId,
      detailedAddress: detailedAddress || '',
      location: mapLocation(body),
    });
  } else if (cityOrArea || subArea || neighborhood || detailedAddress) {
    throw httpError(400, 'governorate_required_when_address_supplied');
  }

  await assertRequesterDailyQuota({ db, requestType: 'device_request', identity });
  await assertRequesterIpQuota({ db, requestType: 'device_request', identity });

  const submittedPayload = {
    requestType: 'device_request',
    formVersion: DEVICE_REQUEST_FORM_VERSION,
    capturedAt: new Date().toISOString(),
    purpose: purposeSnapshot,
    devices: deviceSnapshots,
    referrerMode: people.referrerMode,
    data: sanitizeMobileSubmittedPayload(body),
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });

  const result = await createServiceRequest({
    requestType: 'device_request',
    channel: 'mobile_app',
    applicationSource: 'customer_mobile_app',
    submittedPayload,
    requesterAppAccountId: people.parties.requesterAppAccountId,
    requesterClientId: people.parties.requesterClientId,
    requesterExternal: people.parties.requesterExternal,
    beneficiaryClientId: people.parties.beneficiaryClientId,
    beneficiaryExternal: people.beneficiaryExternal,
    referrerClientId: people.parties.referrerClientId,
    referrerExternal: people.parties.referrerExternal,
    submissionType: people.submissionMode === 'for_another' ? 'refer_a_candidate' : 'apply',
    submitterTier: identity.kind,
    problemDescription: notes || purpose.value,
    serviceAddress,
    priority: null,
    branchId,
    branchResolutionStatus: branchId == null ? 'not_applicable' : 'resolved',
    branchResolutionReason: branchId == null ? 'beneficiary_not_linked' : 'beneficiary_client_branch',
    branchResolutionGeoUnitId: deepestGeoUnitId,
    actorUserId: null,
    actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);

  await db.query(
    `UPDATE service_requests
        SET device_request_purpose_id = $2,
            device_request_purpose_snapshot = $3::jsonb,
            review_required_flag = review_required_flag OR $4,
            updated_at = NOW()
      WHERE id = $1`,
    [result.data.id, purposeId, JSON.stringify(purposeSnapshot), identity.kind === 'unverified'],
  );
  for (const [index, snapshot] of deviceSnapshots.entries()) {
    await db.query(
      `INSERT INTO service_request_device_interests
         (service_request_id, device_model_id, device_snapshot, selection_order)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [result.data.id, snapshot.id, JSON.stringify(snapshot), index],
    );
  }
  if (identity.kind === 'unverified') {
    await appendAudit(db, {
      serviceRequestId: result.data.id,
      eventType: 'review_required_flag_set',
      actorUserId: null,
      actorRole: 'customer',
      payload: { reasons: ['submitter_unverified'], auto: true },
    });
  }

  return {
    publicRefNumber: result.data.publicRefNumber,
    status: result.data.status,
    reviewRequired: result.data.reviewRequiredFlag || identity.kind === 'unverified',
    possibleDuplicate: result.data.duplicateFlag,
  };
}
