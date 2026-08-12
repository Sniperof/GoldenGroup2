import type { PoolClient } from 'pg';
import { APP_SUBMITTED_PAYLOAD_MAX_CHARS } from '../../config/env.js';
import { isValidSyrianMobile, normalizePhone } from '../../utils/contactValidation.js';
import { resolveAndValidateAddress } from '../geo/administrativeAddress.js';
import { getSystemSettingNumber } from '../systemSettings.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { assertRequesterDailyQuota, assertRequesterIpQuota } from './mobileIntakeThrottle.js';
import { createServiceRequest } from './createService.js';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';
import { assertPayloadWithinLimit } from './waterCheckFormSchema.js';
import { NAME_NOMINATION_FORM_VERSION, validateNameNominationForm } from './nameNominationFormSchema.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function optionalBool(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }

async function requesterSnapshot(body: Record<string, unknown>, identity: MobileIntakeIdentity, db: PoolClient) {
  if (identity.kind === 'customer') {
    const forbidden = ['requesterFirstName','requesterLastName','requesterPrimaryPhone','requesterPrimaryPhoneHasWhatsapp']
      .filter((key) => body[key] != null);
    if (forbidden.length) throw httpError(400, 'requester_identity_fields_not_accepted', { fields: forbidden });
    const { rows } = await db.query<{ first_name: string | null; last_name: string | null }>(
      'SELECT first_name,last_name FROM clients WHERE id=$1 AND deleted_at IS NULL', [identity.account.clientId],
    );
    if (!rows[0] || !text(rows[0].first_name)) throw httpError(409, 'customer_profile_incomplete');
    const secondary = text(body.requesterSecondaryPhone);
    if (secondary && !isValidSyrianMobile(secondary)) throw httpError(400, 'invalid_requester_secondary_phone');
    return {
      mediatorType: 'Client', entityId: identity.account.clientId,
      firstName: text(rows[0].first_name), lastName: text(rows[0].last_name) || null,
      name: [text(rows[0].first_name), text(rows[0].last_name)].filter(Boolean).join(' '),
      primaryPhone: normalizePhone(identity.account.phone), primaryPhoneHasWhatsapp: null,
      secondaryPhone: secondary ? normalizePhone(secondary) : null,
      secondaryPhoneHasWhatsapp: secondary ? optionalBool(body.requesterSecondaryPhoneHasWhatsapp) : null,
      identitySource: 'app_account', appAccountId: identity.account.appAccountId,
    };
  }
  const firstName = text(body.requesterFirstName);
  const lastName = text(body.requesterLastName) || null;
  if (!firstName) throw httpError(400, 'requester_first_name_required');
  const submittedPrimary = normalizePhone(body.requesterPrimaryPhone);
  const primaryPhone = identity.kind === 'visitor' ? normalizePhone(identity.phone) : submittedPrimary;
  if (identity.kind === 'visitor' && submittedPrimary && submittedPrimary !== primaryPhone) {
    throw httpError(400, 'verified_phone_does_not_match_requester');
  }
  if (!isValidSyrianMobile(primaryPhone)) throw httpError(400, 'invalid_requester_primary_phone');
  const secondaryPhone = text(body.requesterSecondaryPhone) ? normalizePhone(body.requesterSecondaryPhone) : null;
  if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) throw httpError(400, 'invalid_requester_secondary_phone');
  if (!secondaryPhone && body.requesterSecondaryPhoneHasWhatsapp != null) {
    throw httpError(400, 'requester_secondary_whatsapp_without_phone');
  }
  return {
    mediatorType: 'Personal', entityId: null, firstName, lastName,
    name: [firstName,lastName].filter(Boolean).join(' '), primaryPhone,
    primaryPhoneHasWhatsapp: optionalBool(body.requesterPrimaryPhoneHasWhatsapp),
    secondaryPhone, secondaryPhoneHasWhatsapp: secondaryPhone ? optionalBool(body.requesterSecondaryPhoneHasWhatsapp) : null,
    identitySource: identity.kind === 'visitor' ? 'visitor_otp' : 'unverified_device',
    ...(identity.kind === 'unverified' ? { deviceId: identity.deviceId, requesterIp: identity.ip } : {}),
  };
}

export async function submitMobileNameNomination(body: Record<string, unknown>, identity: MobileIntakeIdentity, db: PoolClient) {
  const form = validateNameNominationForm(body);
  if (!form.ok) throw httpError(400, 'invalid_form_payload', { issues: form.issues, unknownFields: form.unknownFields });
  const maxNames = Math.max(1, Math.floor(await getSystemSettingNumber('name_nomination_max_names_per_request', 50)));
  const rawNames = body.names as Record<string, unknown>[];
  if (rawNames.length < 1 || rawNames.length > maxNames) throw httpError(400, 'name_count_out_of_range', { maxNames });
  const requester = await requesterSnapshot(body, identity, db);
  const occupationValues = [...new Set(rawNames.map((x) => text(x.occupation)).filter(Boolean))];
  if (occupationValues.length) {
    const { rows } = await db.query<{ value: string }>(
      `SELECT value FROM system_lists WHERE category='occupation' AND is_active=TRUE AND value=ANY($1::text[])`, [occupationValues],
    );
    if (rows.length !== occupationValues.length) throw httpError(400, 'invalid_or_inactive_occupation');
  }
  const items: Array<{ normalized: any; deepest: number; branch: Awaited<ReturnType<typeof resolveBranchForServiceGeoUnit>> }> = [];
  for (let index = 0; index < rawNames.length; index += 1) {
    const raw = rawNames[index];
    const firstName = text(raw.firstName);
    if (!firstName) throw httpError(400, 'nominee_first_name_required', { index });
    const primaryPhone = normalizePhone(raw.primaryPhone);
    if (!isValidSyrianMobile(primaryPhone)) throw httpError(400, 'invalid_nominee_primary_phone', { index });
    const secondaryPhone = text(raw.secondaryPhone) ? normalizePhone(raw.secondaryPhone) : null;
    if (secondaryPhone && !isValidSyrianMobile(secondaryPhone)) throw httpError(400, 'invalid_nominee_secondary_phone', { index });
    if (!secondaryPhone && raw.secondaryPhoneHasWhatsapp != null) throw httpError(400, 'nominee_secondary_whatsapp_without_phone', { index });
    const resolved = await resolveAndValidateAddress({
      governorate: raw.governorate as number, cityOrArea: raw.region as number | undefined,
      subArea: raw.subdistrict as number | undefined, neighborhood: raw.neighborhood as number | undefined,
    }, db);
    const deepest = resolved.ids.neighborhood ?? resolved.ids.subArea ?? resolved.ids.cityOrArea ?? resolved.ids.governorate;
    const branch = await resolveBranchForServiceGeoUnit(deepest, db);
    const normalized = {
      firstName, lastName: text(raw.lastName) || null, occupation: text(raw.occupation) || null,
      primaryPhone, primaryPhoneHasWhatsapp: optionalBool(raw.primaryPhoneHasWhatsapp),
      secondaryPhone, secondaryPhoneHasWhatsapp: secondaryPhone ? optionalBool(raw.secondaryPhoneHasWhatsapp) : null,
      geo: { ids: resolved.ids, labels: resolved.labels },
    };
    items.push({ normalized, deepest, branch });
  }
  const dailyLimit = Math.max(0, Math.floor(await getSystemSettingNumber('name_nomination_daily_per_identity', 5)));
  const ipLimit = Math.max(0, Math.floor(await getSystemSettingNumber('name_nomination_daily_per_unverified_ip', 20)));
  await assertRequesterDailyQuota({ db, requestType: 'name_nomination', identity, limit: dailyLimit });
  await assertRequesterIpQuota({ db, requestType: 'name_nomination', identity, limit: ipLimit });
  const submittedPayload = {
    requestType: 'name_nomination', formVersion: NAME_NOMINATION_FORM_VERSION,
    capturedAt: new Date().toISOString(), requester, names: items.map((x) => x.normalized),
  };
  const size = assertPayloadWithinLimit(submittedPayload, APP_SUBMITTED_PAYLOAD_MAX_CHARS);
  if (!size.ok) throw httpError(413, 'submitted_payload_too_large', { limit: size.limit, size: size.size });
  const requesterExternal = {
    name: requester.name, primary_phone: requester.primaryPhone, secondary_phone: requester.secondaryPhone,
    identity_source: requester.identitySource,
    ...(identity.kind === 'unverified' ? { device_id: identity.deviceId, requester_ip: identity.ip } : {}),
  };
  const result = await createServiceRequest({
    requestType: 'name_nomination', channel: 'mobile_app', applicationSource: 'customer_mobile_app',
    submittedPayload, requesterAppAccountId: identity.kind === 'customer' ? identity.account.appAccountId : null,
    requesterClientId: identity.kind === 'customer' ? identity.account.clientId : null,
    requesterExternal, referrerClientId: identity.kind === 'customer' ? identity.account.clientId : null,
    referrerExternal: identity.kind === 'customer' ? null : requesterExternal,
    submissionType: 'apply', submitterTier: identity.kind,
    problemDescription: `طلب ترشيح ${items.length} اسم`, attachments: [], safetyIndicatorCodes: [],
    serviceAddress: null, branchId: null, branchResolutionStatus: 'not_applicable',
    branchResolutionReason: 'per_item_branch_resolution', actorUserId: null, actorRole: 'customer',
  }, db);
  if (result.ok !== true) throw httpError(400, result.code, result.details);
  for (const [index, item] of items.entries()) {
    const n = item.normalized;
    await db.query(
      `INSERT INTO service_request_name_nomination_items
       (service_request_id,item_order,first_name,last_name,primary_phone,primary_phone_has_whatsapp,
        secondary_phone,secondary_phone_has_whatsapp,occupation,governorate_id,region_id,subdistrict_id,
        neighborhood_id,geo_snapshot,submitted_snapshot,branch_resolution_geo_unit_id,
        branch_resolution_status,branch_resolution_reason,branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19)`,
      [result.data.id,index+1,n.firstName,n.lastName,n.primaryPhone,n.primaryPhoneHasWhatsapp,
       n.secondaryPhone,n.secondaryPhoneHasWhatsapp,n.occupation,n.geo.ids.governorate,n.geo.ids.cityOrArea,
       n.geo.ids.subArea,n.geo.ids.neighborhood,JSON.stringify(n.geo),JSON.stringify(n),item.deepest,
       item.branch.status,item.branch.reason,item.branch.branchId],
    );
  }
  const reviewRequired = identity.kind === 'unverified' || items.some((x) => x.branch.status !== 'resolved');
  await db.query('UPDATE service_requests SET review_required_flag=$2,updated_at=NOW() WHERE id=$1', [result.data.id, reviewRequired]);
  return { publicRefNumber: result.data.publicRefNumber, status: result.data.status, reviewRequired, possibleDuplicate: result.data.duplicateFlag };
}
