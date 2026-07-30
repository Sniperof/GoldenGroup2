// ============================================================
// services/otp/otpService.ts
// ============================================================
// OTP challenge core (DEC-013 §6). Storage/expiry/attempts live here and
// are identical across providers. On successful verify we return an opaque
// one-time `handle` (the pre-account proof) — NOT tokens. Consuming the
// handle (create request / delete / login) belongs to later phases.
//
// Rules: TTL 120s, resend after 60s, max 5 attempts, code HASH stored (never
// the code). Phone is normalized (normalizePhone) so it matches app_accounts.
// ============================================================

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../../db.js';
import { normalizePhone, isValidSyrianMobile } from '../../utils/contactValidation.js';
import {
  OTP_TTL_SECONDS,
  OTP_RESEND_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_CODE_LENGTH,
  OTP_EXPOSE_CODE,
} from '../../config/env.js';
import { getOtpSender } from './otpSender.js';
import { SR_ACTIVE_STATUSES } from '../serviceRequests/_shared.js';

export type OtpPurpose = 'account_creation' | 'login' | 'account_deletion' | 'request_status' | 'service_request';
const PURPOSES: OtpPurpose[] = ['account_creation', 'login', 'account_deletion', 'request_status', 'service_request'];

export interface SendOtpInput {
  phone: string;
  purpose: string;
}
export interface SendOtpResult {
  sent: true;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Present ONLY in dev/simulated mode (OTP_EXPOSE_CODE). Never in production. */
  devCode?: string;
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
  purpose: string;
}
export interface VerifyOtpResult {
  verified: true;
  /** Opaque one-time proof to be attached to the next action. */
  handle: string;
  purpose: OtpPurpose;
}

function httpError(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

function assertValid(phone: string, purpose: string): { phone: string; purpose: OtpPurpose } {
  const normalized = normalizePhone(phone);
  if (!isValidSyrianMobile(normalized)) {
    throw httpError(400, 'رقم الموبايل غير صالح');
  }
  if (!PURPOSES.includes(purpose as OtpPurpose)) {
    throw httpError(400, 'غرض التحقق غير معروف');
  }
  return { phone: normalized, purpose: purpose as OtpPurpose };
}

/**
 * Purpose preconditions, checked BEFORE a code is generated and sent.
 *
 * The app is expected to route by GET /api/app/account/status first, so a
 * mismatch here means a mis-implemented (or abusive) client. Without this the
 * whole journey succeeds and only the last call fails — after an SMS was
 * already paid for. Leaks nothing: `account/status` exposes the same facts
 * publicly by design (DEC-013 §3). Every purpose is covered: account_creation
 * requires no live account (active OR suspended — a suspended account is
 * reactivated by the admin, never replaced), login/account_deletion require an
 * active one, request_status requires a pending request, service_request is
 * open to visitors.
 */
async function assertPurposePrecondition(phone: string, purpose: OtpPurpose): Promise<void> {
  if (purpose === 'login' || purpose === 'account_deletion') {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM app_accounts
        WHERE primary_mobile = $1 AND deleted_at IS NULL AND status IN ('active', 'suspended')
        ORDER BY (status = 'active') DESC
        LIMIT 1`,
      [phone],
    );
    if (rows.length === 0) {
      throw httpError(404, 'لا يوجد حساب مفعّل لهذا الرقم', { code: 'no_active_account' });
    }
    if (rows[0].status !== 'active') {
      throw httpError(403, 'الحساب موقوف', { code: 'suspended' });
    }
    return;
  }

  if (purpose === 'account_creation') {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM app_accounts
        WHERE primary_mobile = $1 AND deleted_at IS NULL
          AND status IN ('active', 'suspended')
        ORDER BY (status = 'active') DESC
        LIMIT 1`,
      [phone],
    );
    if (rows.length > 0) {
      throw httpError(409, 'لا يمكن إنشاء حساب جديد لهذا الرقم', {
        code: rows[0].status === 'suspended' ? 'suspended' : 'active_account_exists',
        status: rows[0].status,
      });
    }
    // One-pending-per-number rule (a rejected request does NOT block: the user
    // may freely re-apply after a rejection). Blocking pending here means the
    // single "create account" button fails fast at send, before an SMS, when a
    // request is already in review — the right purpose for that number is
    // `request_status`.
    const { rows: pending } = await pool.query(
      `SELECT 1 FROM service_requests
        WHERE request_type = 'account_creation'
          AND requester_external->>'primary_phone' = $1
          AND status = ANY($2)
          AND archived_at IS NULL
        LIMIT 1`,
      [phone, SR_ACTIVE_STATUSES],
    );
    if (pending.length > 0) {
      throw httpError(409, 'يوجد طلب قيد المراجعة لهذا الرقم', {
        code: 'pending_request_exists',
        status: 'pending',
      });
    }
    return;
  }

  if (purpose === 'request_status') {
    // Pending OR rejected (non-archived): the proven owner may also recover
    // their request's fate + rejection reason through /mine. Archiving closes
    // that window.
    const { rows } = await pool.query(
      `SELECT 1 FROM service_requests
        WHERE request_type = 'account_creation'
          AND requester_external->>'primary_phone' = $1
          AND (status = ANY($2) OR status = 'rejected')
          AND archived_at IS NULL
        LIMIT 1`,
      [phone, SR_ACTIVE_STATUSES],
    );
    if (rows.length === 0) {
      throw httpError(404, 'لا يوجد طلب قيد المراجعة لهذا الرقم', { code: 'no_pending_request' });
    }
  }
}

function generateCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += crypto.randomInt(0, 10).toString();
  return code;
}

export async function sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
  const { phone, purpose } = assertValid(input.phone, input.purpose);
  await assertPurposePrecondition(phone, purpose);

  // Resend window: block a new code within OTP_RESEND_SECONDS of the last one.
  const { rows: recent } = await pool.query<{ last_sent_at: string }>(
    `SELECT last_sent_at
       FROM otp_verifications
      WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone, purpose],
  );
  if (recent.length > 0) {
    const elapsed = (Date.now() - new Date(recent[0].last_sent_at).getTime()) / 1000;
    if (elapsed < OTP_RESEND_SECONDS) {
      throw httpError(429, 'الرجاء الانتظار قبل إعادة إرسال الرمز', {
        retryAfterSeconds: Math.ceil(OTP_RESEND_SECONDS - elapsed),
      });
    }
  }

  const code = generateCode(OTP_CODE_LENGTH);
  const codeHash = await bcrypt.hash(code, 10);

  await pool.query(
    `INSERT INTO otp_verifications (phone, purpose, code_hash, expires_at, last_sent_at)
     VALUES ($1, $2, $3, NOW() + make_interval(secs => $4), NOW())`,
    [phone, purpose, codeHash, OTP_TTL_SECONDS],
  );

  await getOtpSender().send(phone, code, purpose);

  return {
    sent: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_SECONDS,
    ...(OTP_EXPOSE_CODE ? { devCode: code } : {}),
  };
}

export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const { phone, purpose } = assertValid(input.phone, input.purpose);
  const code = String(input.code ?? '').trim();
  if (!code) throw httpError(400, 'الرمز مطلوب');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: number;
      handle: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, handle, code_hash, expires_at, attempts, max_attempts
         FROM otp_verifications
        WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [phone, purpose],
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      throw httpError(400, 'لا يوجد رمز فعّال. اطلب رمزاً جديداً.');
    }
    const row = rows[0];

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      throw httpError(400, 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.');
    }
    if (row.attempts >= (row.max_attempts ?? OTP_MAX_ATTEMPTS)) {
      await client.query('ROLLBACK');
      throw httpError(429, 'تجاوزت الحد المسموح من المحاولات. اطلب رمزاً جديداً.');
    }

    const match = await bcrypt.compare(code, row.code_hash);
    if (!match) {
      const { rows: updated } = await client.query<{ attempts: number; max_attempts: number }>(
        `UPDATE otp_verifications SET attempts = attempts + 1
          WHERE id = $1 RETURNING attempts, max_attempts`,
        [row.id],
      );
      await client.query('COMMIT');
      const remaining = updated[0].max_attempts - updated[0].attempts;
      if (remaining <= 0) {
        throw httpError(429, 'تجاوزت الحد المسموح من المحاولات. اطلب رمزاً جديداً.');
      }
      throw httpError(400, 'رمز غير صحيح', { attemptsRemaining: remaining });
    }

    await client.query(`UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1`, [row.id]);
    await client.query('COMMIT');
    return { verified: true, handle: row.handle, purpose };
  } catch (err) {
    // Harmless no-op if the tx already ended (committed/rolled back above).
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
