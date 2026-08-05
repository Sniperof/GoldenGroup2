// ============================================================
// serviceRequests/mobileIntakeIdentity.ts
// ============================================================
// Who is submitting, in three tiers of decreasing certainty:
//
//   customer    — an authenticated app account; identity comes from a record.
//   visitor     — no account, but the phone was proven by OTP.
//   unverified  — nothing is proven. Identified only by a device fingerprint
//                 the client itself generates (DEC-016 D-WC3).
//
// The third tier exists because OTP was removed from the water_check path
// (DEC-016 D-WC1). It is opt-in PER HANDLER, never global: every other type
// still fails closed without proof, so removing a guard for one request type
// cannot quietly remove it for the next one that is added.
//
// The device fingerprint is a DETERRENT, NOT A GUARANTEE. The client controls
// it and can reset it by reinstalling. It is the key the DB-enforced caps hang
// on, so `null` is refused rather than waved through — an anonymous submission
// with no key at all would silently bypass every cap (DEC-016 D-WC8).
// ============================================================

import type { PoolClient } from 'pg';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';

const HANDLE_TTL_MS = 10 * 60 * 1000;

/** Bounds the stored fingerprint: it is client-supplied and lands in a row. */
const DEVICE_ID_MAX_LENGTH = 128;

function httpError(status: number, code: string) {
  return Object.assign(new Error(code), { status, details: { code } });
}

export type MobileIntakeIdentity =
  | { kind: 'customer'; account: AppAccountClaims }
  | { kind: 'visitor'; phone: string; otpVerificationId: number }
  | { kind: 'unverified'; deviceId: string; ip: string | null };

/**
 * The throttle key for an identity, and how much it is worth trusting.
 * Kept here so the caps cannot invent their own answer and drift from it.
 */
export function intakeIdentityKeys(identity: MobileIntakeIdentity): {
  appAccountId: number | null;
  phone: string | null;
  deviceId: string | null;
  ip: string | null;
} {
  switch (identity.kind) {
    case 'customer':
      return { appAccountId: identity.account.appAccountId, phone: null, deviceId: null, ip: null };
    case 'visitor':
      return { appAccountId: null, phone: identity.phone, deviceId: null, ip: null };
    case 'unverified':
      return { appAccountId: null, phone: null, deviceId: identity.deviceId, ip: identity.ip };
  }
}

export async function resolveMobileIntakeIdentity(input: {
  db: PoolClient;
  appAccount?: AppAccountClaims;
  handle?: unknown;
  /** `X-Device-Id` header — the unverified tier's only identifier. */
  deviceId?: unknown;
  /** Second layer above the fingerprint; survives a reinstall, not a NAT. */
  ip?: string | null;
  /** Set by the handler. Unset means this type still requires proof. */
  allowUnverified?: boolean;
}): Promise<MobileIntakeIdentity> {
  if (input.appAccount) return { kind: 'customer', account: input.appAccount };

  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';

  // No handle: either the type opted into unverified intake, or it fails
  // closed exactly as before. A handle that IS present is still honoured —
  // app builds shipped before DEC-016 keep working through the migration
  // window, and they land on the stronger `visitor` tier, not the weaker one.
  if (!handle) {
    if (!input.allowUnverified) throw httpError(400, 'service_request_verification_required');
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
    if (!deviceId) throw httpError(400, 'device_identifier_required');
    if (deviceId.length > DEVICE_ID_MAX_LENGTH) throw httpError(400, 'invalid_device_identifier');
    return { kind: 'unverified', deviceId, ip: input.ip ?? null };
  }

  const { rows } = await input.db.query<{
    id: number;
    phone: string;
    verified_at: string | null;
    consumed_at: string | null;
  }>(
    `SELECT id, phone, verified_at, consumed_at
       FROM otp_verifications
      WHERE handle = $1 AND purpose = 'service_request'
      FOR UPDATE`,
    [handle],
  );
  if (rows.length === 0) throw httpError(400, 'unknown_service_request_verification');
  const row = rows[0];
  if (!row.verified_at) throw httpError(400, 'service_request_phone_not_verified');
  if (row.consumed_at) throw httpError(409, 'service_request_verification_already_used');
  if (new Date(row.verified_at).getTime() < Date.now() - HANDLE_TTL_MS) {
    throw httpError(400, 'service_request_verification_expired');
  }
  return { kind: 'visitor', phone: row.phone, otpVerificationId: Number(row.id) };
}

export async function consumeMobileIntakeIdentity(
  db: PoolClient,
  identity: MobileIntakeIdentity,
): Promise<void> {
  if (identity.kind === 'visitor') {
    await db.query(
      `UPDATE otp_verifications SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL`,
      [identity.otpVerificationId],
    );
  }
}
