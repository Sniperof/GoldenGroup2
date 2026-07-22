// ============================================================
// services/appAccounts/accountDuplicatePolicy.ts
// ============================================================
// DEC-013 §6.3 — the account-creation-specific duplicate policy.
//
// The generic serviceRequests/duplicateDetection is request-to-request and
// weights device + problem-description (both meaningless for account creation),
// and is not scoped by request_type — so it is NOT reused here.
//
// "Duplicate" for an account-creation request (per the product decision) is the
// SOFT case only — literal same-number duplicates are already hard-blocked at
// intake (uniqueness 409). A request is a soft-duplicate when the requester
// (name + phone) fuzzy-matches EITHER:
//   (a) someone who already holds an app_account (active/suspended), OR
//   (b) another still-open account_creation request.
// Matching a client who has NO account is the normal LINK path, not a duplicate,
// so clients are deliberately not a duplicate target.
//
//   score = 0.5 * name_similarity (pg_trgm) + 0.5 * phone_match (tail-based)
//   flag when score >= threshold  (system_settings, same knob as §0.15.أ)
//
// Both compared phones are already normalized at storage time, so no SQL phone
// normalization is needed. Runs post-insert inside the request transaction, so
// a flawed match can never block a legitimate submission.
// ============================================================

import type { PoolClient } from 'pg';
import { appendAudit, type ActorRole, SR_ACTIVE_STATUSES } from '../serviceRequests/_shared.js';

const DEFAULT_THRESHOLD = 0.75;
const NAME_WEIGHT = 0.5;
const PHONE_WEIGHT = 0.5;

export interface AccountDuplicateMatch {
  kind: 'account' | 'request';
  refId: number;
  score: number;
  nameSim: number;
  phoneMatch: number;
}

export interface AccountDuplicateResult {
  flagged: boolean;
  bestMatch: AccountDuplicateMatch | null;
  consideredCount: number;
}

async function loadThreshold(db: PoolClient): Promise<number> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'service_request_duplicate_threshold'`,
  );
  const t = rows.length ? parseFloat(rows[0].value) : NaN;
  return Number.isFinite(t) ? t : DEFAULT_THRESHOLD;
}

/**
 * Detect + flag a soft duplicate for an account-creation request. Sets
 * duplicate_flag + review_required_flag (and duplicate_of_request_id when the
 * match is another request) and writes the audit trail. Returns the outcome.
 */
export async function detectAccountRequestDuplicate(
  db: PoolClient,
  requestId: number,
  actorUserId: number | null,
  actorRole: ActorRole,
): Promise<AccountDuplicateResult> {
  const { rows: seedRows } = await db.query<{ name: string | null; phone: string | null }>(
    `SELECT requester_external->>'name' AS name, requester_external->>'primary_phone' AS phone
       FROM service_requests WHERE id = $1`,
    [requestId],
  );
  if (seedRows.length === 0) return { flagged: false, bestMatch: null, consideredCount: 0 };
  const seedName = (seedRows[0].name ?? '').trim();
  const seedPhone = (seedRows[0].phone ?? '').trim();
  if (seedName === '' && seedPhone === '') {
    return { flagged: false, bestMatch: null, consideredCount: 0 };
  }

  const threshold = await loadThreshold(db);

  const { rows: cands } = await db.query<{ kind: 'account' | 'request'; ref_id: number; name_sim: number; phone_match: number }>(
    `SELECT
        kind,
        ref_id,
        CASE WHEN $2::text = '' THEN 0
             ELSE COALESCE(similarity(name, $2::text), 0)::float END AS name_sim,
        CASE
          WHEN $3::text = '' OR phone IS NULL THEN 0
          WHEN phone = $3::text THEN 1.0
          WHEN RIGHT(phone, 7) = RIGHT($3::text, 7) THEN 0.8
          WHEN RIGHT(phone, 6) = RIGHT($3::text, 6) THEN 0.5
          ELSE 0
        END AS phone_match
      FROM (
        SELECT 'account'::text AS kind,
               a.id AS ref_id,
               COALESCE(NULLIF(cl.name, ''),
                        NULLIF(CONCAT_WS(' ', cl.first_name, cl.father_name, cl.last_name), '')) AS name,
               a.primary_mobile AS phone
          FROM app_accounts a
          JOIN clients cl ON cl.id = a.linked_client_record_id
         WHERE a.deleted_at IS NULL AND a.status IN ('active', 'suspended')
        UNION ALL
        SELECT 'request'::text AS kind,
               r.id AS ref_id,
               r.requester_external->>'name' AS name,
               r.requester_external->>'primary_phone' AS phone
          FROM service_requests r
         WHERE r.request_type = 'account_creation'
           AND r.id <> $1
           AND r.status = ANY($4)
           AND r.archived_at IS NULL
      ) cand`,
    [requestId, seedName, seedPhone, SR_ACTIVE_STATUSES],
  );

  let best: AccountDuplicateMatch | null = null;
  for (const c of cands) {
    const nameSim = Number(c.name_sim);
    const phoneMatch = Number(c.phone_match);
    const score = NAME_WEIGHT * nameSim + PHONE_WEIGHT * phoneMatch;
    if (!best || score > best.score) {
      best = { kind: c.kind, refId: Number(c.ref_id), score, nameSim, phoneMatch };
    }
  }

  const flagged = !!best && best.score >= threshold;

  if (flagged && best) {
    await db.query(
      `UPDATE service_requests
          SET duplicate_flag = TRUE,
              review_required_flag = TRUE,
              duplicate_of_request_id = $2
        WHERE id = $1`,
      [requestId, best.kind === 'request' ? best.refId : null],
    );
    await appendAudit(db, {
      serviceRequestId: requestId,
      eventType: 'duplicate_flag_set',
      actorUserId,
      actorRole,
      payload: {
        match_kind: best.kind,
        matched_id: best.refId,
        score: best.score,
        name_similarity: best.nameSim,
        phone_match: best.phoneMatch,
        threshold,
      },
    });
    await appendAudit(db, {
      serviceRequestId: requestId,
      eventType: 'review_required_flag_set',
      actorUserId,
      actorRole,
      payload: { reason: 'account_duplicate_detected', auto: true },
    });
  }

  return { flagged, bestMatch: best, consideredCount: cands.length };
}
