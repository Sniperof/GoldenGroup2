import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { createServiceRequest } from './createService.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { buildMobileServiceAddress } from '../geo/mobileServiceAddress.js';
import { appendAudit } from './_shared.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { assertRequesterDailyQuota, assertRequesterIpQuota } from './mobileIntakeThrottle.js';
import { positiveInt, sanitizeMobileSubmittedPayload, text } from './mobileWaterCheckIntake.js';
import { resolveMobileRequestPeople } from './mobileEmergencyMaintenanceIntake.js';
import {
  GOLDEN_WARRANTY_FORM_VERSION,
  assertPayloadWithinLimit,
  validateGoldenWarrantyForm,
} from './goldenWarrantyFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

function consentConfirmed(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizePeriods(value: unknown): Array<{ months: number; label: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const months = Number(raw.months);
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    return Number.isInteger(months) && months > 0 && label ? [{ months, label }] : [];
  });
}

export async function submitMobileGoldenWarranty(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  const form = validateGoldenWarrantyForm(body);
  if (!form.ok) {
    throw httpError(400, 'invalid_form_payload', {
      issues: form.issues,
      ...(form.unknownFields.length ? { unknownFields: form.unknownFields } : {}),
      formVersion: GOLDEN_WARRANTY_FORM_VERSION,
    });
  }
  if (!consentConfirmed(body.beneficiaryContactConsentConfirmed)) {
    throw httpError(400, 'beneficiary_contact_consent_required');
  }
  const requestedMonths = positiveInt(body, 'requestedWarrantyMonths');
  if (!requestedMonths) throw httpError(400, 'requested_warranty_months_required');

  const people = await resolveMobileRequestPeople({
    body,
    identity,
    db,
    defaultReferrerModeForAnother: 'none',
    requireRequesterNameForAnother: true,
  });
  if (Object.prototype.hasOwnProperty.call(body, 'referrerMode')) {
    throw httpError(400, 'referrer_mode_not_accepted');
  }

  const installedDeviceId = positiveInt(body, 'installedDeviceId');
  const deviceModelId = positiveInt(body, 'deviceModelId');
  const serialNumber = text(body, 'serialNumber') || null;
  const governorate = positiveInt(body, 'governorateId', 'governorate');
  const cityOrArea = positiveInt(body, 'regionId', 'region', 'cityOrArea');
  const subArea = positiveInt(body, 'subdistrictId', 'subdistrict', 'subArea');
  const neighborhood = positiveInt(body, 'neighborhoodId', 'neighborhood');
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  const addressWasSupplied = [
    'governorateId', 'governorate', 'regionId', 'region', 'cityOrArea',
    'subdistrictId', 'subdistrict', 'subArea', 'neighborhoodId', 'neighborhood',
    'detailedAddress', 'detailed_address',
  ].some((key) => body[key] != null);
  let resolvedDeviceId: number | null = null;
  let resolvedModelId: number;
  let branchId: number | null = null;
  let deviceSource: 'company_device' | 'external_device' = 'external_device';
  let modelName: string;
  let registeredSerial: string | null = null;
  let periods: Array<{ months: number; label: string }>;

  if (identity.kind === 'customer' && people.submissionMode === 'for_self') {
    if (!installedDeviceId) throw httpError(400, 'installed_device_id_required');
    if (deviceModelId) throw httpError(400, 'device_model_id_not_accepted');
    if (serialNumber) throw httpError(400, 'serial_number_not_accepted_for_registered_device');
    const { rows } = await db.query<{
      id: number; device_model_id: number; branch_id: number | null; device_source: string | null;
      serial_number: string | null; model_name: string; golden_warranty_periods: unknown;
    }>(
      `SELECT d.id, d.device_model_id, d.branch_id, d.device_source, d.serial_number,
              COALESCE(dm.name_ar, dm.name_en, dm.name) AS model_name,
              dm.golden_warranty_periods
         FROM installed_devices d
         JOIN device_models dm ON dm.id = d.device_model_id
        WHERE d.id = $1
          AND d.customer_id = $2
          AND d.status = 'active'
          AND dm.is_active = TRUE
          AND dm.is_golden_warranty = TRUE
        LIMIT 1`,
      [installedDeviceId, identity.account.clientId],
    );
    if (!rows[0]) throw httpError(404, 'eligible_installed_device_not_found');
    resolvedDeviceId = Number(rows[0].id);
    resolvedModelId = Number(rows[0].device_model_id);
    branchId = rows[0].branch_id == null ? null : Number(rows[0].branch_id);
    deviceSource = rows[0].device_source === 'external' ? 'external_device' : 'company_device';
    registeredSerial = rows[0].serial_number;
    modelName = rows[0].model_name;
    periods = normalizePeriods(rows[0].golden_warranty_periods);
  } else {
    if (installedDeviceId) throw httpError(400, 'installed_device_id_not_accepted');
    if (!deviceModelId) throw httpError(400, 'device_model_id_required');
    const { rows } = await db.query<{
      id: number; model_name: string; golden_warranty_periods: unknown;
    }>(
      `SELECT id, COALESCE(name_ar, name_en, name) AS model_name, golden_warranty_periods
         FROM device_models
        WHERE id = $1 AND is_active = TRUE AND is_golden_warranty = TRUE
        LIMIT 1`,
      [deviceModelId],
    );
    if (!rows[0]) throw httpError(404, 'golden_warranty_device_model_not_found');
    resolvedModelId = Number(rows[0].id);
    modelName = rows[0].model_name;
    periods = normalizePeriods(rows[0].golden_warranty_periods);
  }

  if (resolvedDeviceId == null && (!governorate || !detailedAddress)) {
    throw httpError(400, 'missing_required_fields', {
      fields: [!governorate && 'governorate', !detailedAddress && 'detailedAddress'].filter(Boolean),
    });
  }
  if (addressWasSupplied && (!governorate || !detailedAddress)) {
    throw httpError(400, 'missing_required_fields', {
      fields: [!governorate && 'governorate', !detailedAddress && 'detailedAddress'].filter(Boolean),
    });
  }

  const resolvedAddress = governorate
    ? await resolveAndValidateAddress({ governorate, cityOrArea, subArea, neighborhood }, db)
    : null;
  const deepestGeoUnitId = resolvedAddress == null ? null
    : resolvedAddress.ids.neighborhood ?? resolvedAddress.ids.subArea
      ?? resolvedAddress.ids.cityOrArea ?? resolvedAddress.ids.governorate;
  const serviceAddress = resolvedAddress == null ? null : buildMobileServiceAddress({
    resolved: resolvedAddress,
    deepestGeoUnitId: deepestGeoUnitId!,
    detailedAddress,
    location: null,
  });
  const geoBranch = await resolveBranchForServiceGeoUnit(deepestGeoUnitId, db);
  const registeredDeviceBranchId = branchId;
  if (branchId == null) branchId = geoBranch.branchId;

  const period = periods.find((item) => item.months === requestedMonths);
  if (!period) throw httpError(400, 'requested_warranty_period_not_supported');
  const periodSnapshot = { months: period.months, label: period.label };
  const reportedDeviceSnapshot = {
    selection: resolvedDeviceId == null ? 'catalog_model' : 'registered_device',
    installedDeviceId: resolvedDeviceId,
    modelId: resolvedModelId,
    modelName,
    serialNumber: resolvedDeviceId == null ? serialNumber : registeredSerial,
    source: resolvedDeviceId == null ? 'submitted_catalog_selection' : 'server_record',
    goldenWarrantyPeriods: periods,
  };

  await assertRequesterDailyQuota({ db, requestType: 'golden_warranty', identity });
  await assertRequesterIpQuota({ db, requestType: 'golden_warranty', identity });
  const submittedPayload = {
    requestType: 'golden_warranty',
    formVersion: GOLDEN_WARRANTY_FORM_VERSION,
    capturedAt: new Date().toISOString(),
    requesterAuth: identity.kind === 'customer' ? 'app_account'
      : identity.kind === 'visitor' ? 'visitor_otp' : 'device',
    requestedWarrantyPeriod: periodSnapshot,
    reportedDevice: reportedDeviceSnapshot,
    beneficiaryContactConsentConfirmed: true,
    data: sanitizeMobileSubmittedPayload(body),
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });

  const result = await createServiceRequest({
    requestType: 'golden_warranty',
    channel: 'mobile_app',
    applicationSource: 'customer_mobile_app',
    submittedPayload,
    requesterAppAccountId: people.parties.requesterAppAccountId,
    requesterClientId: people.parties.requesterClientId,
    requesterExternal: people.parties.requesterExternal,
    beneficiaryClientId: people.parties.beneficiaryClientId,
    beneficiaryExternal: resolvedAddress == null ? people.beneficiaryExternal : {
      ...(people.beneficiaryExternal ?? {}),
      detailedAddress,
      geoUnitId: deepestGeoUnitId,
      governorateId: resolvedAddress.ids.governorate,
      regionId: resolvedAddress.ids.cityOrArea,
      subdistrictId: resolvedAddress.ids.subArea,
      neighborhoodId: resolvedAddress.ids.neighborhood,
      addressLabels: resolvedAddress.labels,
    },
    referrerClientId: null,
    referrerExternal: null,
    submissionType: people.submissionMode === 'for_another' ? 'refer_a_candidate' : 'apply',
    submitterTier: identity.kind,
    deviceSource,
    installedDeviceId: resolvedDeviceId,
    reportedDeviceSelection: resolvedDeviceId == null ? 'catalog_model' : 'registered_device',
    reportedDeviceModelId: resolvedModelId,
    reportedDeviceSnapshot,
    problemDescription: text(body, 'notes'),
    attachments: [],
    safetyIndicatorCodes: [],
    serviceAddress,
    priority: null,
    branchId,
    branchResolutionStatus: branchId == null ? geoBranch.status : 'resolved',
    branchResolutionReason: registeredDeviceBranchId != null
      ? 'registered_device_branch'
      : geoBranch.reason,
    branchResolutionGeoUnitId: deepestGeoUnitId,
    actorUserId: null,
    actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);

  const requiresReview = identity.kind === 'unverified' || branchId == null;
  await db.query(
    `UPDATE service_requests
        SET requested_warranty_months = $2,
            requested_warranty_period_snapshot = $3::jsonb,
            beneficiary_contact_consent_confirmed = TRUE,
            review_required_flag = review_required_flag OR $4,
            updated_at = NOW()
      WHERE id = $1`,
    [result.data.id, requestedMonths, JSON.stringify(periodSnapshot), requiresReview],
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
          ...(branchId == null ? [resolvedDeviceId == null ? 'branch_resolution_required' : 'installed_device_link_required'] : []),
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
