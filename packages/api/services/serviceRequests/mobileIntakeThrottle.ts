// ============================================================
// serviceRequests/mobileIntakeThrottle.ts
// ============================================================
// Identity-level intake caps for the mobile gateway.
//
// A visitor is already bounded: every submission costs a one-time OTP handle.
// An authenticated customer is not — one 60-minute access token can drive an
// unbounded number of submissions, and duplicate detection deliberately flags
// without ever blocking (§٠.١٥.أ), so every repeat lands on a reviewer's desk.
//
// Two caps, both mirroring rules the section already owns:
//   1. Open-request rule — the same shape as account_creation's
//      "one pending request per number", applied to the beneficiary's phone.
//      This is the rule that actually protects reviewer time.
//   2. Rolling-24h ceiling per submitting identity — a backstop against a
//      looping client hammering DIFFERENT beneficiaries.
//
// Enforced in the DB inside the intake transaction, so restarts and extra
// worker processes cannot widen it.
// ============================================================

import type { PoolClient } from 'pg';
import {
  APP_WATER_CHECK_DAILY_PER_REQUESTER,
  APP_WATER_CHECK_OPEN_PER_PHONE,
} from '../../config/env.js';
import { SR_ACTIVE_STATUSES } from './_shared.js';
import type { MobileIntakeIdentity } from './mobileIntakeIdentity.js';

function httpError(status: number, code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(code), { status, details: { code, ...(details ?? {}) } });
}

/**
 * Rejects a submission when the beneficiary's number already has an open
 * request of this type. Returns the blocking request's public ref so the app
 * can show the customer what they already sent instead of a bare refusal.
 */
export async function assertNoOpenRequestForPhone(input: {
  db: PoolClient;
  requestType: string;
  beneficiaryPhone: string;
  limit?: number;
}): Promise<void> {
  const limit = input.limit ?? APP_WATER_CHECK_OPEN_PER_PHONE;
  if (limit <= 0 || !input.beneficiaryPhone) return;

  const { rows } = await input.db.query<{ n: string; public_ref_number: string }>(
    `SELECT COUNT(*) OVER ()::text AS n, public_ref_number
       FROM service_requests
      WHERE request_type = $1
        AND beneficiary_external->>'primary_phone' = $2
        AND status = ANY($3)
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.requestType, input.beneficiaryPhone, SR_ACTIVE_STATUSES],
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
 * logged-in customer, the verified phone for a visitor.
 */
export async function assertRequesterDailyQuota(input: {
  db: PoolClient;
  requestType: string;
  identity: MobileIntakeIdentity;
  limit?: number;
}): Promise<void> {
  const limit = input.limit ?? APP_WATER_CHECK_DAILY_PER_REQUESTER;
  if (limit <= 0) return;

  const identity = input.identity;
  const appAccountId = identity.kind === 'customer' ? identity.account.appAccountId : null;
  const visitorPhone = identity.kind === 'visitor' ? identity.phone : null;
  const { rows } = await input.db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM service_requests
      WHERE request_type = $1
        AND created_at >= NOW() - INTERVAL '24 hours'
        AND (
          ($2::bigint IS NOT NULL AND requester_app_account_id = $2::bigint)
          OR ($3::text IS NOT NULL AND requester_external->>'primary_phone' = $3::text)
        )`,
    [input.requestType, appAccountId, visitorPhone],
  );
  if (Number(rows[0]?.n ?? 0) < limit) return;

  throw httpError(429, 'daily_request_quota_reached', { limit, windowHours: 24 });
}
