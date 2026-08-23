import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { buildMobileServiceAddress } from '../geo/mobileServiceAddress.js';
import { resolveCustomerIdentitySnapshot } from '../customerIdentity/identitySnapshot.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { createServiceRequest } from './createService.js';
import { appendAudit } from './_shared.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { assertRequesterDailyQuota, assertRequesterIpQuota } from './mobileIntakeThrottle.js';
import {
  IDENTITY_BODY_KEYS,
  REQUESTER_BODY_KEYS,
  REFERRER_BODY_KEYS,
  REFERRER_IDENTITY_BODY_KEYS,
  buildSubmittedPerson,
  hasOwn,
  mapLocation,
  personFromCustomerSnapshot,
  positiveInt,
  resolveMobileRequesterParties,
  resolveMobileReferrerAddress,
  sanitizeMobileSubmittedPayload,
  suppliedKeys,
  text,
  withSecondaryContactOverride,
  type PersonSnapshot,
  type WaterCheckReferrerMode,
} from './mobileWaterCheckIntake.js';
import {
  EMERGENCY_MAINTENANCE_FORM_VERSION,
  assertPayloadWithinLimit,
  validateEmergencyMaintenanceForm,
} from './emergencyMaintenanceFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

function externalPerson(person: PersonSnapshot, role: 'beneficiary'): Record<string, unknown> {
  return {
    snapshotSchemaVersion: 2,
    partyRole: role,
    firstName: person.firstName,
    fatherName: person.fatherName,
    lastName: person.lastName,
    name: person.name,
    primary_phone: person.primaryPhone,
    primaryPhoneHasWhatsapp: person.primaryPhoneHasWhatsapp,
    secondary_phone: person.secondaryPhone,
    secondaryPhoneHasWhatsapp: person.secondaryPhoneHasWhatsapp,
    identity_source: person.source,
  };
}

export async function resolveMobileRequestPeople(input: {
  body: Record<string, unknown>;
  identity: MobileIntakeIdentity;
  db: PoolClient;
  defaultReferrerModeForAnother?: 'none';
  requireRequesterNameForAnother?: boolean;
}) {
  const { body, identity, db } = input;
  const appAccount = identity.kind === 'customer' ? identity.account : undefined;
  const verifiedVisitorPhone = identity.kind === 'visitor' ? identity.phone : undefined;
  const unverifiedDevice = identity.kind === 'unverified'
    ? { deviceId: identity.deviceId, ip: identity.ip }
    : undefined;
  const rawSubmissionMode = text(body, 'submissionMode');
  if (!rawSubmissionMode) throw httpError(400, 'submission_mode_required');
  const submissionMode: 'for_self' | 'for_another' = rawSubmissionMode === 'for_another'
    ? 'for_another'
    : 'for_self';

  let referrerMode: WaterCheckReferrerMode = 'none';
  if (submissionMode === 'for_self') {
    if (hasOwn(body, 'referrerMode')) {
      throw httpError(400, 'referrer_mode_not_accepted', { reason: 'for_self_has_no_referrer' });
    }
    const fields = [...suppliedKeys(body, REQUESTER_BODY_KEYS), ...suppliedKeys(body, REFERRER_BODY_KEYS)];
    if (fields.length) throw httpError(400, 'party_fields_not_accepted', { fields });
  } else {
    const mode = text(body, 'referrerMode') ?? input.defaultReferrerModeForAnother ?? null;
    if (!mode) throw httpError(400, 'referrer_mode_required');
    referrerMode = mode as WaterCheckReferrerMode;
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
      person: registeredPerson!, body,
      phoneField: 'secondaryPhone', whatsappField: 'secondaryPhoneHasWhatsapp',
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
      const immutable = suppliedKeys(body, REQUESTER_BODY_KEYS.filter(
        (key) => key !== 'requesterSecondaryPhone' && key !== 'requesterSecondaryPhoneHasWhatsapp',
      ));
      if (immutable.length) throw httpError(400, 'requester_fields_not_accepted', { fields: immutable });
      requesterPerson = withSecondaryContactOverride({
        person: registeredPerson!, body,
        phoneField: 'requesterSecondaryPhone', whatsappField: 'requesterSecondaryPhoneHasWhatsapp',
      });
    } else if (submissionMode === 'for_self') {
      requesterPerson = beneficiaryPerson;
    } else {
      requesterPerson = buildSubmittedPerson({
        body,
        role: 'requester',
        requireName: input.requireRequesterNameForAnother === true || referrerMode !== 'none',
        ...(verifiedVisitorPhone ? { verifiedPrimaryPhone: verifiedVisitorPhone } : {}),
      });
    }
  }

  let referrerPerson: PersonSnapshot | null = null;
  const referrerFields = suppliedKeys(body, REFERRER_BODY_KEYS);
  const referrerIdentityFields = suppliedKeys(body, REFERRER_IDENTITY_BODY_KEYS);
  if (referrerMode === 'none') {
    if (referrerFields.length) throw httpError(400, 'referrer_fields_not_accepted', { fields: referrerFields });
  } else if (referrerMode === 'requester') {
    if (referrerIdentityFields.length) {
      throw httpError(400, 'referrer_fields_not_accepted', { fields: referrerIdentityFields });
    }
    referrerPerson = requesterPerson;
  } else {
    referrerPerson = buildSubmittedPerson({ body, role: 'referrer' });
  }
  const referrerAddress = referrerMode === 'none'
    ? null
    : await resolveMobileReferrerAddress(body, db);

  const beneficiaryExternal = externalPerson(beneficiaryPerson, 'beneficiary');
  const parties = resolveMobileRequesterParties({
    submissionMode,
    referrerMode,
    appAccount,
    verifiedVisitorPhone,
    unverifiedDevice,
    requesterPerson,
    beneficiaryExternal,
    referrerPerson,
    referrerAddress,
  });
  return { appAccount, submissionMode, referrerMode, beneficiaryPerson, beneficiaryExternal, parties };
}

export async function resolveReportedDevice(input: {
  body: Record<string, unknown>;
  identity: MobileIntakeIdentity;
  submissionMode: 'for_self' | 'for_another';
  db: PoolClient;
  rejectRegisteredSerial?: boolean;
}) {
  const selection = text(input.body, 'deviceSelectionType') as 'registered_device' | 'catalog_model' | 'other';
  if (!selection) throw httpError(400, 'device_selection_required');
  const installedDeviceId = positiveInt(input.body, 'installedDeviceId');
  const deviceModelId = positiveInt(input.body, 'deviceModelId');
  const deviceName = text(input.body, 'deviceName');
  const serialNumber = text(input.body, 'serialNumber') || null;

  if (selection === 'registered_device') {
    if (input.identity.kind !== 'customer' || input.submissionMode !== 'for_self') {
      throw httpError(403, 'registered_device_selection_forbidden');
    }
    if (!installedDeviceId) throw httpError(400, 'installed_device_id_required');
    if (input.rejectRegisteredSerial === true && serialNumber) {
      throw httpError(400, 'serial_number_not_accepted_for_registered_device');
    }
    const { rows } = await input.db.query<{
      id: number; device_model_id: number | null; device_source: string | null;
      model_name: string | null; serial_number: string | null; branch_id: number | null;
    }>(
      `SELECT d.id, d.device_model_id, d.device_source, d.serial_number, d.branch_id,
              COALESCE(dm.name_ar, dm.name_en, dm.name) AS model_name
         FROM installed_devices d
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
        WHERE d.id = $1 AND d.customer_id = $2
        LIMIT 1`,
      [installedDeviceId, input.identity.account.clientId],
    );
    if (!rows[0]) throw httpError(404, 'installed_device_not_found');
    const row = rows[0];
    return {
      selection,
      installedDeviceId: Number(row.id),
      branchId: row.branch_id == null ? null : Number(row.branch_id),
      deviceSource: row.device_source === 'external' ? 'external_device' as const : 'company_device' as const,
      modelId: row.device_model_id == null ? null : Number(row.device_model_id),
      snapshot: {
        selection, installedDeviceId: Number(row.id), modelId: row.device_model_id,
        modelName: row.model_name, serialNumber: row.serial_number, source: 'server_record',
      },
    };
  }

  if (installedDeviceId) throw httpError(400, 'installed_device_id_not_accepted');
  if (selection === 'catalog_model') {
    if (!deviceModelId) throw httpError(400, 'device_model_id_required');
    const { rows } = await input.db.query<{ id: number; name: string }>(
      `SELECT id, COALESCE(name_ar, name_en, name) AS name
         FROM device_models WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [deviceModelId],
    );
    if (!rows[0]) throw httpError(404, 'device_model_not_found');
    return {
      selection, installedDeviceId: null, deviceSource: 'external_device' as const, modelId: Number(rows[0].id),
      branchId: null,
      snapshot: { selection, modelId: Number(rows[0].id), modelName: rows[0].name, serialNumber, source: 'submitted_catalog_selection' },
    };
  }
  if (!deviceName) throw httpError(400, 'device_name_required');
  if (deviceModelId) throw httpError(400, 'device_model_id_not_accepted');
  return {
    selection, installedDeviceId: null, deviceSource: 'external_device' as const, modelId: null,
    branchId: null,
    snapshot: { selection, deviceName, serialNumber, source: 'submitted_free_text' },
  };
}

async function resolveSafetyIndicators(body: Record<string, unknown>, db: PoolClient) {
  const codes = Array.isArray(body.safetyIndicatorCodes)
    ? [...new Set(body.safetyIndicatorCodes.map(String).map((code) => code.trim()).filter(Boolean))]
    : [];
  if (!codes.length) return { codes: [], snapshots: [], requiresImmediateReview: false };
  const { rows } = await db.query<{ value: string; metadata: Record<string, unknown> }>(
    `SELECT value, metadata
       FROM system_lists
      WHERE category = 'emergency_maintenance_safety_indicators'
        AND is_active = TRUE
        AND metadata->>'code' = ANY($1::text[])`,
    [codes],
  );
  const found = new Set(rows.map((row) => String(row.metadata?.code ?? '')));
  const invalid = codes.filter((code) => !found.has(code));
  if (invalid.length) throw httpError(400, 'invalid_safety_indicator_codes', { codes: invalid });
  return {
    codes,
    snapshots: rows.map((row) => ({ code: row.metadata.code, label: row.value, metadata: row.metadata })),
    requiresImmediateReview: rows.some((row) => row.metadata?.requiresImmediateReview === true),
  };
}

async function normalizeAttachments(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
    return { attachments: [] as Record<string, unknown>[], uploadIds: [] as string[] };
  }
  const requested = body.attachments.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw httpError(400, 'invalid_attachment', { index });
    }
    const item = raw as Record<string, unknown>;
    const unknownFields = Object.keys(item).filter((key) => key !== 'uploadToken' && key !== 'category');
    const uploadToken = typeof item.uploadToken === 'string' ? item.uploadToken.trim().toLowerCase() : '';
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    if (unknownFields.length || !uploadToken || !category) {
      throw httpError(400, 'invalid_attachment', { index, unknownFields });
    }
    return { uploadToken, category };
  });
  if (new Set(requested.map((item) => item.uploadToken)).size !== requested.length) {
    throw httpError(400, 'duplicate_attachment_token');
  }
  const identityKey = identity.kind === 'customer' ? String(identity.account.appAccountId)
    : identity.kind === 'visitor' ? identity.phone : identity.deviceId;
  const { rows } = await db.query<{
    id: string; media_type: 'image' | 'video'; mime_type: string; public_url: string;
    byte_size: number; duration_ms: number | null;
  }>(
    `SELECT id, media_type, mime_type, public_url, byte_size, duration_ms
       FROM service_request_mobile_uploads
      WHERE id = ANY($1::uuid[])
        AND identity_kind = $2
        AND identity_key = $3
        AND consumed_at IS NULL
        AND expires_at > NOW()
        AND media_type IN ('image','video')
      FOR UPDATE`,
    [requested.map((item) => item.uploadToken), identity.kind, identityKey],
  );
  if (rows.length !== requested.length) throw httpError(400, 'attachment_token_invalid_or_expired');
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const videoCount = rows.filter((row) => row.media_type === 'video').length;
  const imageCount = rows.filter((row) => row.media_type === 'image').length;
  if (videoCount > 1 || imageCount > 5) {
    throw httpError(400, 'attachment_count_exceeded', { maximumImages: 5, maximumVideos: 1 });
  }
  const categories = [...new Set(requested.map((item) => item.category))];
  const { rows: categoryRows } = await db.query<{ code: string }>(
    `SELECT COALESCE(metadata->>'code', value) AS code
       FROM system_lists
      WHERE category = 'emergency_maintenance_attachment_categories'
        AND is_active = TRUE
        AND COALESCE(metadata->>'code', value) = ANY($1::text[])`,
    [categories],
  );
  const validCategories = new Set(categoryRows.map((row) => row.code));
  const invalidCategories = categories.filter((category) => !validCategories.has(category));
  if (invalidCategories.length) throw httpError(400, 'invalid_attachment_category', { categories: invalidCategories });
  return {
    uploadIds: rows.map((row) => row.id),
    attachments: requested.map((item) => {
      const row = rowById.get(item.uploadToken)!;
      return {
        url: row.public_url,
        mediaType: row.media_type,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        category: item.category,
        ...(row.duration_ms != null ? { durationMs: row.duration_ms } : {}),
      };
    }),
  };
}

export async function submitMobileEmergencyMaintenance(
  body: Record<string, unknown>,
  identity: MobileIntakeIdentity,
  db: PoolClient,
) {
  const form = validateEmergencyMaintenanceForm(body);
  if (!form.ok) {
    throw httpError(400, 'invalid_form_payload', {
      issues: form.issues,
      ...(form.unknownFields.length ? { unknownFields: form.unknownFields } : {}),
      formVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
    });
  }
  const problemDescription = text(body, 'problemDescription');
  const detailedAddress = text(body, 'detailedAddress', 'detailed_address');
  if (!problemDescription) throw httpError(400, 'problem_description_required');
  const governorate = positiveInt(body, 'governorateId', 'governorate');
  const cityOrArea = positiveInt(body, 'regionId', 'region', 'cityOrArea');
  const subArea = positiveInt(body, 'subdistrictId', 'subdistrict', 'subArea');
  const neighborhood = positiveInt(body, 'neighborhoodId', 'neighborhood');
  if (!governorate || !detailedAddress) {
    throw httpError(400, 'missing_required_fields', {
      fields: [!governorate && 'governorate', !detailedAddress && 'detailedAddress'].filter(Boolean),
    });
  }

  const people = await resolveMobileRequestPeople({ body, identity, db });
  const reportedDevice = await resolveReportedDevice({ body, identity, submissionMode: people.submissionMode, db });
  const resolvedAddress = await resolveAndValidateAddress({ governorate, cityOrArea, subArea, neighborhood }, db);
  const deepestGeoUnitId = resolvedAddress.ids.neighborhood ?? resolvedAddress.ids.subArea
    ?? resolvedAddress.ids.cityOrArea ?? resolvedAddress.ids.governorate;
  const serviceAddress = buildMobileServiceAddress({
    resolved: resolvedAddress,
    deepestGeoUnitId,
    detailedAddress,
    location: mapLocation(body),
  });
  const indicators = await resolveSafetyIndicators(body, db);
  const media = await normalizeAttachments(body, identity, db);
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

  await assertRequesterDailyQuota({ db, requestType: 'emergency_maintenance', identity });
  await assertRequesterIpQuota({ db, requestType: 'emergency_maintenance', identity });

  const requesterAuth = identity.kind === 'customer' ? 'app_account'
    : identity.kind === 'visitor' ? 'visitor_otp' : 'device';
  const submitterTier = identity.kind;
  const beneficiaryExternal = {
    ...people.beneficiaryExternal,
    detailedAddress,
    geoUnitId: deepestGeoUnitId,
    addressLabels: resolvedAddress.labels,
  };
  const submittedPayload = {
    requestType: 'emergency_maintenance',
    formVersion: EMERGENCY_MAINTENANCE_FORM_VERSION,
    capturedAt: new Date().toISOString(),
    requesterAuth,
    referrerMode: people.referrerMode,
    reportedDevice: reportedDevice.snapshot,
    safetyIndicators: indicators.snapshots,
    data: sanitizeMobileSubmittedPayload(body),
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });

  const result = await createServiceRequest({
    requestType: 'emergency_maintenance',
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
    submitterTier,
    deviceSource: reportedDevice.deviceSource,
    installedDeviceId: reportedDevice.installedDeviceId,
    reportedDeviceSelection: reportedDevice.selection,
    reportedDeviceModelId: reportedDevice.modelId,
    reportedDeviceSnapshot: reportedDevice.snapshot,
    problemDescription,
    attachments: media.attachments,
    safetyIndicatorCodes: indicators.codes,
    serviceAddress,
    priority: null,
    branchId,
    branchResolutionStatus: branchId == null ? geoBranch.status : 'resolved',
    branchResolutionReason: reportedDevice.branchId != null
      ? 'registered_device_branch'
      : beneficiaryBranchId != null ? 'beneficiary_client_branch' : geoBranch.reason,
    branchResolutionGeoUnitId: deepestGeoUnitId,
    actorUserId: null,
    actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);

  if (media.uploadIds.length > 0) {
    await db.query(
      `UPDATE service_request_mobile_uploads
          SET consumed_at = NOW(), service_request_id = $2
        WHERE id = ANY($1::uuid[])`,
      [media.uploadIds, result.data.id],
    );
  }

  if (identity.kind === 'unverified' || indicators.requiresImmediateReview || branchId == null) {
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
        reasons: [
          ...(identity.kind === 'unverified' ? ['submitter_unverified'] : []),
          ...(indicators.requiresImmediateReview ? ['safety_indicator'] : []),
          ...(branchId == null ? ['branch_resolution_required'] : []),
        ],
        auto: true,
      },
    });
  }

  return {
    publicRefNumber: result.data.publicRefNumber,
    status: result.data.status,
    reviewRequired: identity.kind === 'unverified' || indicators.requiresImmediateReview || branchId == null,
  };
}
