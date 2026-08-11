import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { buildMobileServiceAddress } from '../geo/mobileServiceAddress.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { createServiceRequest } from './createService.js';
import { appendAudit } from './_shared.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { assertRequesterDailyQuota, assertRequesterIpQuota } from './mobileIntakeThrottle.js';
import {
  mapLocation,
  positiveInt,
  sanitizeMobileSubmittedPayload,
  text,
} from './mobileWaterCheckIntake.js';
import {
  resolveMobileRequestPeople,
  resolveReportedDevice,
} from './mobileEmergencyMaintenanceIntake.js';
import {
  PERIODIC_MAINTENANCE_FORM_VERSION,
  assertPayloadWithinLimit,
  validatePeriodicMaintenanceForm,
} from './periodicMaintenanceFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

export async function submitMobilePeriodicMaintenance(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  const form = validatePeriodicMaintenanceForm(body);
  if (!form.ok) {
    throw httpError(400, 'invalid_form_payload', {
      issues: form.issues,
      ...(form.unknownFields.length ? { unknownFields: form.unknownFields } : {}),
      formVersion: PERIODIC_MAINTENANCE_FORM_VERSION,
    });
  }

  const reasonId = positiveInt(body, 'reasonId');
  if (!reasonId) throw httpError(400, 'periodic_maintenance_reason_required');
  const { rows: reasonRows } = await db.query<{
    id: number; value: string; metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, value, metadata
       FROM system_lists
      WHERE id = $1
        AND category = 'periodic_maintenance_request_reasons'
        AND is_active = TRUE
      LIMIT 1`,
    [reasonId],
  );
  const reason = reasonRows[0];
  if (!reason) throw httpError(404, 'periodic_maintenance_reason_not_found');
  const reasonSnapshot = {
    id: Number(reason.id),
    code: String(reason.metadata?.code ?? reason.value),
    label: reason.value,
  };

  const governorate = positiveInt(body, 'governorateId', 'governorate');
  const cityOrArea = positiveInt(body, 'regionId', 'region', 'cityOrArea');
  const subArea = positiveInt(body, 'subdistrictId', 'subdistrict', 'subArea');
  const neighborhood = positiveInt(body, 'neighborhoodId', 'neighborhood');
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  if (!governorate || !detailedAddress) {
    throw httpError(400, 'missing_required_fields', {
      fields: [!governorate && 'governorate', !detailedAddress && 'detailedAddress'].filter(Boolean),
    });
  }

  const people = await resolveMobileRequestPeople({ body, identity, db });
  const reportedDevice = await resolveReportedDevice({
    body,
    identity,
    submissionMode: people.submissionMode,
    db,
    rejectRegisteredSerial: true,
  });
  const resolvedAddress = await resolveAndValidateAddress({
    governorate, cityOrArea, subArea, neighborhood,
  }, db);
  const deepestGeoUnitId = resolvedAddress.ids.neighborhood ?? resolvedAddress.ids.subArea
    ?? resolvedAddress.ids.cityOrArea ?? resolvedAddress.ids.governorate;
  const serviceAddress = buildMobileServiceAddress({
    resolved: resolvedAddress,
    deepestGeoUnitId,
    detailedAddress,
    location: mapLocation(body),
  });

  let beneficiaryBranchId: number | null = null;
  if (people.parties.beneficiaryClientId != null) {
    const { rows } = await db.query<{ branch_id: number | null }>(
      'SELECT branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL',
      [people.parties.beneficiaryClientId],
    );
    beneficiaryBranchId = rows[0]?.branch_id == null ? null : Number(rows[0].branch_id);
  }
  const geoBranch = await resolveBranchForServiceGeoUnit(deepestGeoUnitId, db);
  const branchId = reportedDevice.branchId ?? beneficiaryBranchId ?? geoBranch.branchId;
  const branchResolutionStatus = branchId == null ? geoBranch.status : 'resolved';
  const branchResolutionReason = reportedDevice.branchId != null
    ? 'registered_device_branch'
    : beneficiaryBranchId != null
      ? 'beneficiary_client_branch'
      : geoBranch.reason;

  if (reportedDevice.installedDeviceId != null) {
    await db.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [7314, reportedDevice.installedDeviceId]);
    const { rows } = await db.query<{
      public_ref_number: string; status: string; review_required_flag: boolean;
    }>(
      `SELECT public_ref_number, status, review_required_flag
         FROM service_requests
        WHERE request_type = 'periodic_maintenance'
          AND installed_device_id = $1
          AND status IN ('received', 'in_review')
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [reportedDevice.installedDeviceId],
    );
    if (rows[0]) {
      return {
        publicRefNumber: rows[0].public_ref_number,
        status: rows[0].status,
        reviewRequired: rows[0].review_required_flag,
        activeRequestExists: true,
      };
    }
  }

  await assertRequesterDailyQuota({ db, requestType: 'periodic_maintenance', identity });
  await assertRequesterIpQuota({ db, requestType: 'periodic_maintenance', identity });

  const submittedPayload = {
    requestType: 'periodic_maintenance',
    formVersion: PERIODIC_MAINTENANCE_FORM_VERSION,
    capturedAt: new Date().toISOString(),
    requesterAuth: identity.kind === 'customer' ? 'app_account'
      : identity.kind === 'visitor' ? 'visitor_otp' : 'device',
    referrerMode: people.referrerMode,
    reportedDevice: reportedDevice.snapshot,
    requestReason: reasonSnapshot,
    data: sanitizeMobileSubmittedPayload(body),
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });

  const beneficiaryExternal = {
    ...people.beneficiaryExternal,
    detailedAddress,
    geoUnitId: deepestGeoUnitId,
    addressLabels: resolvedAddress.labels,
  };
  const result = await createServiceRequest({
    requestType: 'periodic_maintenance',
    channel: 'mobile_app',
    applicationSource: 'customer_mobile_app',
    submittedPayload,
    requesterAppAccountId: people.parties.requesterAppAccountId,
    requesterClientId: people.parties.requesterClientId,
    requesterExternal: people.parties.requesterExternal,
    beneficiaryClientId: people.parties.beneficiaryClientId,
    beneficiaryExternal,
    referrerClientId: people.parties.referrerClientId,
    referrerExternal: people.parties.referrerExternal,
    submissionType: people.submissionMode === 'for_another' ? 'refer_a_candidate' : 'apply',
    submitterTier: identity.kind,
    deviceSource: reportedDevice.deviceSource,
    installedDeviceId: reportedDevice.installedDeviceId,
    reportedDeviceSelection: reportedDevice.selection,
    reportedDeviceModelId: reportedDevice.modelId,
    reportedDeviceSnapshot: reportedDevice.snapshot,
    problemDescription: reason.value,
    attachments: [],
    safetyIndicatorCodes: [],
    serviceAddress,
    priority: null,
    branchId,
    branchResolutionStatus,
    branchResolutionReason,
    branchResolutionGeoUnitId: deepestGeoUnitId,
    actorUserId: null,
    actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);

  const requiresReview = identity.kind === 'unverified' || branchId == null;
  await db.query(
    `UPDATE service_requests
        SET periodic_maintenance_reason_id = $2,
            periodic_maintenance_reason_snapshot = $3::jsonb,
            review_required_flag = review_required_flag OR $4,
            updated_at = NOW()
      WHERE id = $1`,
    [result.data.id, reasonId, JSON.stringify(reasonSnapshot), requiresReview],
  );
  if (requiresReview) {
    await appendAudit(db, {
      serviceRequestId: result.data.id,
      eventType: 'review_required_flag_set',
      actorUserId: null,
      actorRole: 'customer',
      payload: {
        reasons: [
          ...(identity.kind === 'unverified' ? ['submitter_unverified'] : []),
          ...(branchId == null ? ['branch_resolution_required'] : []),
        ],
        auto: true,
      },
    });
  }

  return {
    publicRefNumber: result.data.publicRefNumber,
    status: result.data.status,
    reviewRequired: result.data.reviewRequiredFlag || requiresReview,
    possibleDuplicate: result.data.duplicateFlag,
  };
}
