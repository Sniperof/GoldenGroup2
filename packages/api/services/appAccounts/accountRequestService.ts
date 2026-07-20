// ============================================================
// services/appAccounts/accountRequestService.ts
// ============================================================
// Phase 3 (DEC-013) — customer account-creation request path.
//
//   checkMobileStatus(phone)      → derived mobile view (visitor/pending/
//                                    active/suspended) keyed by normalized phone.
//   createAccountRequest(handle)  → consumes the one-time OTP handle, enforces
//                                    uniqueness + pending rule, and stores a
//                                    service_requests row (request_type=
//                                    'account_creation', status 'received').
//
// Reuses the low-level SR helpers (generatePublicRefNumber + appendAudit) but
// NOT createServiceRequest — its post-insert duplicateDetection is not scoped
// by request_type and would cross-match other request types by phone. The
// account-specific duplicate policy (DEC-013 §6.3) is a Phase 4 concern.
// ============================================================

import pool from '../../db.js';
import { normalizePhone, isValidSyrianMobile } from '../../utils/contactValidation.js';
import { resolveAndValidateAddress } from './addressValidation.js';
import { detectAccountRequestDuplicate } from './accountDuplicatePolicy.js';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  generatePublicRefNumber,
  SR_ACTIVE_STATUSES,
} from '../serviceRequests/_shared.js';

/** Handle validity window after a successful OTP verify (DEC-013 §6). */
const HANDLE_TTL_MS = 10 * 60 * 1000;

export type MobileStatus = 'visitor' | 'pending' | 'active' | 'suspended';

export interface AccountRequestForm {
  firstName: string;
  lastName: string;
  primaryMobile: string;
  secondaryMobile?: string | null;
  governorate: number | string;
  cityOrArea?: number | string | null;
  subArea?: number | string | null;
  neighborhood?: number | string | null;
  detailedAddress: string;
  notes?: string | null;
  location?: { lat: number; lng: number } | null;
}

export interface CreateAccountRequestInput {
  handle: string;
  form: AccountRequestForm;
}
export interface CreateAccountRequestResult {
  status: 'pending';
  requestId: number;
  publicRefNumber: string;
}

function httpError(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

function requireText(value: unknown, label: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw httpError(400, `${label} مطلوب`);
  return v;
}

/**
 * Derived mobile view. Priority: active/suspended account (by number) wins over
 * a pending request; a deleted account falls back to visitor (may re-register).
 */
export async function checkMobileStatus(rawPhone: string): Promise<{ status: MobileStatus }> {
  const phone = normalizePhone(rawPhone);
  if (!isValidSyrianMobile(phone)) throw httpError(400, 'رقم الموبايل غير صالح');

  const { rows: acc } = await pool.query<{ status: string }>(
    `SELECT status FROM app_accounts
      WHERE primary_mobile = $1 AND deleted_at IS NULL AND status IN ('active', 'suspended')
      ORDER BY (status = 'active') DESC
      LIMIT 1`,
    [phone],
  );
  if (acc.length > 0) {
    return { status: acc[0].status === 'active' ? 'active' : 'suspended' };
  }

  const { rows: pending } = await pool.query(
    `SELECT 1 FROM service_requests
      WHERE request_type = 'account_creation'
        AND requester_external->>'primary_phone' = $1
        AND status = ANY($2)
        AND archived_at IS NULL
      LIMIT 1`,
    [phone, SR_ACTIVE_STATUSES],
  );
  if (pending.length > 0) return { status: 'pending' };

  return { status: 'visitor' };
}

export async function createAccountRequest(
  input: CreateAccountRequestInput,
): Promise<CreateAccountRequestResult> {
  const form = input.form ?? ({} as AccountRequestForm);
  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
  if (!handle) throw httpError(400, 'مُعرّف التحقق مطلوب');

  const firstName = requireText(form.firstName, 'الاسم الأول');
  const lastName = requireText(form.lastName, 'الكنية');
  const detailedAddress = requireText(form.detailedAddress, 'العنوان التفصيلي');
  const phone = normalizePhone(form.primaryMobile);
  if (!isValidSyrianMobile(phone)) throw httpError(400, 'رقم الموبايل الرئيسي غير صالح');

  // Administrative address must be canonical geo_units IDs (picked via
  // GET /api/public/areas), validated for level + parent chain. We keep both the
  // ids and a resolved names snapshot so the admin comparison stays readable.
  const address = await resolveAndValidateAddress({
    governorate: form.governorate,
    cityOrArea: form.cityOrArea,
    subArea: form.subArea,
    neighborhood: form.neighborhood,
  });

  const tx = await acquireTx();
  try {
    // 1. Validate the one-time verification handle (locked).
    const { rows: hrows } = await tx.client.query<{
      id: number;
      phone: string;
      verified_at: string | null;
      consumed_at: string | null;
    }>(
      `SELECT id, phone, verified_at, consumed_at
         FROM otp_verifications
        WHERE handle = $1 AND purpose = 'account_creation'
        FOR UPDATE`,
      [handle],
    );
    if (hrows.length === 0) throw httpError(400, 'مُعرّف التحقق غير معروف');
    const otp = hrows[0];
    if (!otp.verified_at) throw httpError(400, 'لم يتم التحقق من الرقم بعد');
    if (otp.consumed_at) throw httpError(409, 'استُخدم مُعرّف التحقق مسبقاً. أعد التحقق.');
    if (new Date(otp.verified_at).getTime() < Date.now() - HANDLE_TTL_MS) {
      throw httpError(400, 'انتهت صلاحية التحقق. أعد التحقق من الرقم.');
    }
    if (otp.phone !== phone) throw httpError(400, 'الرقم لا يطابق الرقم الذي تم التحقق منه');

    // 2. Uniqueness: no ACTIVE account for this number (DEC-013 §9.2).
    const { rows: active } = await tx.client.query(
      `SELECT 1 FROM app_accounts
        WHERE primary_mobile = $1 AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [phone],
    );
    if (active.length > 0) {
      throw httpError(409, 'يوجد حساب مفعّل لهذا الرقم', { status: 'active' });
    }

    // 3. Pending-request rule: one active account_creation request per number.
    const { rows: pending } = await tx.client.query(
      `SELECT 1 FROM service_requests
        WHERE request_type = 'account_creation'
          AND requester_external->>'primary_phone' = $1
          AND status = ANY($2)
          AND archived_at IS NULL
        LIMIT 1`,
      [phone, SR_ACTIVE_STATUSES],
    );
    if (pending.length > 0) {
      throw httpError(409, 'يوجد طلب قيد المراجعة لهذا الرقم', { status: 'pending' });
    }

    // 4. Insert the request (received = Pending to the user).
    const ref = await generatePublicRefNumber(tx.client);
    const requesterExternal = {
      name: `${firstName} ${lastName}`.trim(),
      first_name: firstName,
      last_name: lastName,
      primary_phone: phone,
      secondary_phone: form.secondaryMobile ? normalizePhone(form.secondaryMobile) : null,
    };
    const addressLabels = {
      governorate: address.labels.governorate,
      city_or_area: address.labels.cityOrArea,
      sub_area: address.labels.subArea,
      neighborhood: address.labels.neighborhood,
    };
    const serviceAddress = {
      governorate: address.ids.governorate,
      city_or_area: address.ids.cityOrArea,
      sub_area: address.ids.subArea,
      neighborhood: address.ids.neighborhood,
      detailed_address: detailedAddress,
      location: form.location ?? null,
      labels: addressLabels,
    };
    const submittedPayload = {
      first_name: firstName,
      last_name: lastName,
      primary_mobile: phone,
      secondary_mobile: requesterExternal.secondary_phone,
      governorate: address.ids.governorate,
      city_or_area: address.ids.cityOrArea,
      sub_area: address.ids.subArea,
      neighborhood: address.ids.neighborhood,
      address_labels: addressLabels,
      detailed_address: detailedAddress,
      notes: form.notes ?? null,
      location: form.location ?? null,
    };
    const problemDescription =
      form.notes && String(form.notes).trim() ? String(form.notes).trim() : 'طلب إنشاء حساب';

    const { rows: ins } = await tx.client.query<{ id: number }>(
      `INSERT INTO service_requests
         (public_ref_number, request_type, channel, submitter_tier, submission_type,
          problem_description, submitted_payload, requester_external, service_address, status)
       VALUES ($1, 'account_creation', 'mobile_app', 'visitor', 'apply',
          $2, $3::jsonb, $4::jsonb, $5::jsonb, 'received')
       RETURNING id`,
      [
        ref,
        problemDescription,
        JSON.stringify(submittedPayload),
        JSON.stringify(requesterExternal),
        JSON.stringify(serviceAddress),
      ],
    );
    const requestId = ins[0].id;

    // 5. Consume the handle (one-time).
    await tx.client.query(`UPDATE otp_verifications SET consumed_at = NOW() WHERE id = $1`, [otp.id]);

    // 6. Audit.
    await appendAudit(tx.client, {
      serviceRequestId: requestId,
      eventType: 'request_created',
      actorUserId: null,
      actorRole: 'customer',
      payload: {
        request_type: 'account_creation',
        channel: 'mobile_app',
        public_ref_number: ref,
        primary_phone: phone,
      },
    });

    // 7. Soft-duplicate policy (DEC-013 §6.3): flag + force review when the
    // requester fuzzy-matches an existing account or another open request.
    await detectAccountRequestDuplicate(tx.client, requestId, null, 'customer');

    await commitTx(tx);
    return { status: 'pending', requestId, publicRefNumber: ref };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
