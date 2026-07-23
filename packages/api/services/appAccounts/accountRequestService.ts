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
/** Create and recover return the SAME shape, so the app's pending screen has
 *  one renderer regardless of which path filled it. */
export type CreateAccountRequestResult = PendingRequestSnapshot;

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

/**
 * Customer-facing labels for the shared reject reason codes (stateMachine
 * TRIAGE_OUTCOMES_BY_TERMINAL.rejected). Disclosed only through the
 * handle-gated recovery path — the proven owner of the number may know their
 * own request's fate; the public status route keeps answering `visitor`.
 */
const REJECTION_REASON_LABELS: Record<string, string> = {
  duplicate: 'طلب مكرّر — يوجد طلب أو حساب سابق لهذا الرقم',
  invalid_request: 'بيانات الطلب غير مكتملة أو غير صالحة',
  spam: 'طلب غير جدّي',
  out_of_scope: 'خارج نطاق الخدمة',
  unverified_caller: 'تعذّر التحقق من مقدّم الطلب',
  device_not_company: 'الجهاز ليس من أجهزة الشركة',
};

/** The pending-screen payload, built from the immutable submitted snapshot. */
export interface PendingRequestSnapshot {
  status: 'pending' | 'rejected';
  requestId: number;
  publicRefNumber: string;
  submittedAt: string;
  /** Present only when status = 'rejected'. */
  rejection?: { code: string; label: string; rejectedAt: string | null } | null;
  firstName: string | null;
  lastName: string | null;
  primaryMobile: string;
  secondaryMobile: string | null;
  address: {
    governorate: string | null;
    cityOrArea: string | null;
    subArea: string | null;
    neighborhood: string | null;
    detailedAddress: string | null;
  };
  notes: string | null;
  location: { lat: number; lng: number } | null;
}

/**
 * One builder for both paths. Reads `submitted_payload` — i.e. what the server
 * actually stored after normalization (phone as `09XXXXXXXX`, trimmed names,
 * resolved geo labels) — so the customer's screen and the admin's screen never
 * drift, and the app never has to track the picker labels itself.
 */
function buildSnapshot(
  requestId: number | string,
  publicRefNumber: string,
  submittedAt: string,
  payload: Record<string, any> | null,
  fallbackPhone: string,
  status: 'pending' | 'rejected' = 'pending',
  rejection: PendingRequestSnapshot['rejection'] = null,
): PendingRequestSnapshot {
  const p = payload ?? {};
  const labels = (p.address_labels ?? {}) as Record<string, string | null>;
  return {
    status,
    ...(status === 'rejected' ? { rejection } : {}),
    // BIGINT id → node-pg string; the documented contract is `integer`.
    requestId: Number(requestId),
    publicRefNumber,
    submittedAt,
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    primaryMobile: p.primary_mobile ?? fallbackPhone,
    secondaryMobile: p.secondary_mobile ?? null,
    address: {
      governorate: labels.governorate ?? null,
      cityOrArea: labels.city_or_area ?? null,
      subArea: labels.sub_area ?? null,
      neighborhood: labels.neighborhood ?? null,
      detailedAddress: p.detailed_address ?? null,
    },
    notes: p.notes ?? null,
    location: p.location ?? null,
  };
}

/**
 * The customer's own pending request, as they submitted it — the recovery path
 * for a lost local copy (app reinstall). Gated by a `request_status` OTP handle
 * because the payload is personal data (name + home address): a phone-keyed
 * public route would be a reverse directory. Reads the immutable
 * `submitted_payload` snapshot, never the linked client record (that is
 * GET /api/app/me, and only exists after the admin links and activates).
 */
export async function getPendingRequestByVerifiedHandle(input: {
  handle: string;
  phone: string;
}): Promise<PendingRequestSnapshot> {
  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
  if (!handle) throw httpError(400, 'مُعرّف التحقق مطلوب');
  const phone = normalizePhone(input.phone);
  if (!isValidSyrianMobile(phone)) throw httpError(400, 'رقم الموبايل غير صالح');

  const tx = await acquireTx();
  try {
    const { rows: hrows } = await tx.client.query<{
      id: number;
      phone: string;
      verified_at: string | null;
      consumed_at: string | null;
    }>(
      `SELECT id, phone, verified_at, consumed_at
         FROM otp_verifications
        WHERE handle = $1 AND purpose = 'request_status'
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

    // Prefer the live pending request; otherwise fall back to the latest
    // rejected one so the proven owner learns their request's fate and reason
    // (the public status route keeps saying `visitor` — this disclosure is
    // handle-gated only). Archiving the rejected request closes this window.
    const { rows: reqs } = await tx.client.query<{
      id: number;
      public_ref_number: string;
      created_at: string;
      submitted_payload: Record<string, any> | null;
      status: string;
      rejection_reason: string | null;
      closed_at: string | null;
    }>(
      `SELECT id, public_ref_number, created_at, submitted_payload,
              status, rejection_reason, closed_at
         FROM service_requests
        WHERE request_type = 'account_creation'
          AND requester_external->>'primary_phone' = $1
          AND (status = ANY($2) OR status = 'rejected')
          AND archived_at IS NULL
        ORDER BY (status = ANY($2)) DESC, created_at DESC
        LIMIT 1`,
      [phone, SR_ACTIVE_STATUSES],
    );
    if (reqs.length === 0) {
      throw httpError(404, 'لا يوجد طلب قيد المراجعة لهذا الرقم', { code: 'no_pending_request' });
    }
    const row = reqs[0];

    // One-time: the handle is spent even though this is a read, so a leaked
    // handle cannot be replayed.
    await tx.client.query(`UPDATE otp_verifications SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
    await commitTx(tx);

    const rejected = row.status === 'rejected';
    return buildSnapshot(
      row.id,
      row.public_ref_number,
      row.created_at,
      row.submitted_payload,
      phone,
      rejected ? 'rejected' : 'pending',
      rejected
        ? {
            code: row.rejection_reason ?? 'unspecified',
            label:
              REJECTION_REASON_LABELS[row.rejection_reason ?? ''] ?? 'لم يُستكمل الطلب',
            rejectedAt: row.closed_at,
          }
        : null,
    );
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
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
    const { rows: active } = await tx.client.query<{ status: string }>(
      `SELECT status FROM app_accounts
        WHERE primary_mobile = $1 AND status IN ('active', 'suspended') AND deleted_at IS NULL
        ORDER BY (status = 'active') DESC
        LIMIT 1`,
      [phone],
    );
    if (active.length > 0) {
      throw httpError(409, 'يوجد حساب قائم لهذا الرقم', { status: active[0].status });
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

    const { rows: ins } = await tx.client.query<{ id: number; created_at: string }>(
      `INSERT INTO service_requests
         (public_ref_number, request_type, channel, submitter_tier, submission_type,
          problem_description, submitted_payload, requester_external, service_address, status)
       VALUES ($1, 'account_creation', 'mobile_app', 'visitor', 'apply',
          $2, $3::jsonb, $4::jsonb, $5::jsonb, 'received')
       RETURNING id, created_at`,
      [
        ref,
        problemDescription,
        JSON.stringify(submittedPayload),
        JSON.stringify(requesterExternal),
        JSON.stringify(serviceAddress),
      ],
    );
    const requestId = ins[0].id;
    const createdAt = ins[0].created_at;

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
    // Echo the stored snapshot so the app can render the pending screen with
    // zero extra calls and without tracking the address picker labels itself.
    return buildSnapshot(requestId, ref, createdAt, submittedPayload, phone);
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
