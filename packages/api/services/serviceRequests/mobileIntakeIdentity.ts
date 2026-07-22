import type { PoolClient } from 'pg';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';

const HANDLE_TTL_MS = 10 * 60 * 1000;

function httpError(status: number, code: string) {
  return Object.assign(new Error(code), { status, details: { code } });
}

export type MobileIntakeIdentity =
  | { kind: 'customer'; account: AppAccountClaims }
  | { kind: 'visitor'; phone: string; otpVerificationId: number };

export async function resolveMobileIntakeIdentity(input: {
  db: PoolClient;
  appAccount?: AppAccountClaims;
  handle?: unknown;
}): Promise<MobileIntakeIdentity> {
  if (input.appAccount) return { kind: 'customer', account: input.appAccount };
  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
  if (!handle) throw httpError(400, 'service_request_verification_required');
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
