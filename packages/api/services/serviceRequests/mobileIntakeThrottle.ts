// ============================================================
// serviceRequests/mobileIntakeThrottle.ts
// ============================================================
// Identity-level intake caps for the mobile gateway.
//
// Both caps used to hang on a phone number, which only worked while OTP proved
// it. DEC-016 removed OTP from the water_check path, so they now hang on the
// SUBMITTER's identity — app account, verified phone, or device fingerprint.
//
// Why the open-request rule moved off the BENEFICIARY's phone (D-WC4): it is
// the beneficiary who gets blocked, and without OTP anyone can type anyone's
// number. Keeping it would let a stranger lock a real customer out of ever
// filing a request, silently and for free. Repetition on the beneficiary's
// number is now a REVIEW SIGNAL instead of a refusal (D-WC5, duplicateDetection).
//
// Two keys per unverified submitter, both enforced: the device fingerprint,
// and the IP above it. The fingerprint is reset by a reinstall; the IP is
// shared behind NAT. Neither is sufficient alone, so a submission must clear
// both. Enforced in the DB inside the intake transaction, so restarts and
// extra worker processes cannot widen them.
// ============================================================

import type { PoolClient } from 'pg';
import {
  APP_WATER_CHECK_DAILY_PER_IP,
  APP_WATER_CHECK_OPEN_PER_REQUESTER,
} from '../../config/env.js';
import { SR_ACTIVE_STATUSES } from './_shared.js';
import { intakeIdentityKeys, type MobileIntakeIdentity } from './mobileIntakeIdentity.js';
import { getDailyRequestsPerIdentity } from './mobileRequestQuotaSettings.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

/**
 * The SQL predicate matching rows submitted by this identity, plus its params.
 *
 * Returns `null` only for an identity with no usable key at all. Callers must
 * treat that as a refusal, never as "no rows matched" — the previous version
 * built a predicate that silently matched nothing, so an identity the caps
 * could not see passed every cap without an error or a log entry (D-WC8).
 */
function requesterPredicate(
  identity: MobileIntakeIdentity,
  offset: number,
): { sql: string; params: unknown[] } | null {
  const keys = intakeIdentityKeys(identity);
  if (keys.appAccountId !== null) {
    return { sql: `requester_app_account_id = $${offset}::bigint`, params: [keys.appAccountId] };
  }
  if (keys.phone) {
    return { sql: `requester_external->>'primary_phone' = $${offset}::text`, params: [keys.phone] };
  }
  if (keys.deviceId) {
    return { sql: `requester_external->>'device_id' = $${offset}::text`, params: [keys.deviceId] };
  }
  return null;
}

/**
 * Rejects a submission when this SUBMITTER already has an open request of this
 * type. Returns the blocking request's public ref so the app can show what it
 * already sent instead of a bare refusal.
 */
export async function assertNoOpenRequestForRequester(input: {
  db: PoolClient;
  requestType: string;
  identity: MobileIntakeIdentity;
  limit?: number;
}): Promise<void> {
  const limit = input.limit ?? APP_WATER_CHECK_OPEN_PER_REQUESTER;
  if (limit <= 0) return;

  const predicate = requesterPredicate(input.identity, 3);
  if (!predicate) throw httpError(400, 'requester_identity_unavailable');

  const { rows } = await input.db.query<{ n: string; public_ref_number: string }>(
    `SELECT COUNT(*) OVER ()::text AS n, public_ref_number
       FROM service_requests
      WHERE request_type = $1
        AND status = ANY($2)
        AND archived_at IS NULL
        AND ${predicate.sql}
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.requestType, SR_ACTIVE_STATUSES, ...predicate.params],
  );
  if (rows.length === 0) return;
  if (Number(rows[0].n) < limit) return;

  throw httpError(409, 'open_request_exists', {
    publicRefNumber: rows[0].public_ref_number,
    limit,
  });
}

/**
 * Rolling-24h ceiling on submissions from one identity: the app account for a
 * logged-in customer, the verified phone for a visitor, the device fingerprint
 * for an unverified submitter.
 */
export async function assertRequesterDailyQuota(input: {
  db: PoolClient;
  requestType: string;
  identity: MobileIntakeIdentity;
  limit?: number;
}): Promise<void> {
  const limit = input.limit ?? await getDailyRequestsPerIdentity(input.requestType);
  if (limit <= 0) return;

  const predicate = requesterPredicate(input.identity, 2);
  if (!predicate) throw httpError(400, 'requester_identity_unavailable');

  const { rows } = await input.db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM service_requests
      WHERE request_type = $1
        AND created_at >= NOW() - INTERVAL '24 hours'
        AND ${predicate.sql}`,
    [input.requestType, ...predicate.params],
  );
  if (Number(rows[0]?.n ?? 0) < limit) return;

  throw httpError(429, 'daily_request_quota_reached', { limit, windowHours: 24 });
}

/**
 * Rolling-24h ceiling per IP, applied ON TOP of the fingerprint cap and only
 * to unverified submitters. The fingerprint alone is reset by clearing app
 * data; this is the layer that costs an attacker a new network, not a button.
 *
 * Deliberately looser than the per-device cap: one household or office can
 * legitimately share an address, so this is a ceiling on abuse, not on use.
 */
export async function assertRequesterIpQuota(input: {
  db: PoolClient;
  requestType: string;
  identity: MobileIntakeIdentity;
  limit?: number;
}): Promise<void> {
  const limit = input.limit ?? APP_WATER_CHECK_DAILY_PER_IP;
  if (limit <= 0) return;
  if (input.identity.kind !== 'unverified') return;

  const ip = input.identity.ip;
  // An unresolvable IP does not relax the cap for anyone else, and the device
  // cap has already run, so there is nothing to fail closed on here.
  if (!ip) return;

  const { rows } = await input.db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM service_requests
      WHERE request_type = $1
        AND created_at >= NOW() - INTERVAL '24 hours'
        AND requester_external->>'requester_ip' = $2::text`,
    [input.requestType, ip],
  );
  if (Number(rows[0]?.n ?? 0) < limit) return;

  throw httpError(429, 'daily_request_quota_reached', { limit, windowHours: 24, scope: 'ip' });
}
