// ============================================================
// serviceRequests/duplicateDetection.ts
// ============================================================
// Constitution source: §٠.١٥.أ — fuzzy duplicate algorithm
//
//   score = 0.50 * phone_match
//         + 0.25 * device_match
//         + 0.25 * problem_similarity (pg_trgm)
//
// SCOPE: candidates are restricted to the SAME request_type. The section
// contract's strict isolation (البند الخامس) says a type's permission never
// touches another type — a cross-type `duplicate_of_request_id` would hand a
// water_check reviewer a pointer into a family they cannot open. It was also
// wrong on the facts: account_creation and water_check store the submitter's
// number in the same field, so one person doing both within the window scored
// phone_match = 1.0 against themselves.
//
//   if score >= threshold and existing.status NOT IN terminals:
//     duplicate_flag = TRUE, duplicate_of_request_id = best,
//     review_required_flag = TRUE (SR-R009),
//     audit: duplicate_flag_set.
//
// DEC-016 D-WC5/D-WC6 — two gaps the water_check open-request rule used to
// hide, both surfaced when that rule stopped guarding the beneficiary:
//
//   1. `phone_match` compared REQUESTER phones only. Two different senders
//      filing for the SAME beneficiary scored zero against each other — the
//      exact case now left to this detector. Both parties are compared now,
//      role against role.
//   2. The fuzzy score cannot carry that case anyway. An unverified submitter
//      has no requester phone, so the 0.50 phone term is structurally zero and
//      the remaining 0.50 can never reach the 0.75 threshold. A repeated
//      beneficiary number is therefore a DETERMINISTIC flag, independent of
//      the score: an exact match inside the window always raises the review
//      signal. It flags, it never blocks (§٠.١٥.أ).
//
// All weights + threshold + window are sourced live from system_settings
// (٠.١٥.أ "قابلية الضبط") so ops can tune without migrations.
//
// Called from createService AFTER the INSERT (post-insert detection)
// so a flawed algorithm never blocks a legitimate request.
// ============================================================

import type { PoolClient } from 'pg';
import { appendAudit, type ActorRole } from './_shared.js';

interface Settings {
  threshold: number;
  windowHours: number;
  phoneWeight: number;
  deviceWeight: number;
  problemWeight: number;
}

async function loadSettings(db: PoolClient): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings
      WHERE key IN (
        'service_request_duplicate_threshold',
        'service_request_duplicate_window_hours',
        'service_request_duplicate_phone_weight',
        'service_request_duplicate_device_weight',
        'service_request_duplicate_problem_weight'
      )`,
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    threshold: parseFloat(m['service_request_duplicate_threshold'] ?? '0.75'),
    windowHours: parseInt(m['service_request_duplicate_window_hours'] ?? '72', 10),
    phoneWeight: parseFloat(m['service_request_duplicate_phone_weight'] ?? '0.50'),
    deviceWeight: parseFloat(m['service_request_duplicate_device_weight'] ?? '0.25'),
    problemWeight: parseFloat(m['service_request_duplicate_problem_weight'] ?? '0.25'),
  };
}

export interface DuplicateMatch {
  candidateId: number;
  score: number;
  phoneMatch: number;
  deviceMatch: number;
  problemSimilarity: number;
  /** 1.0 when the beneficiary's number is identical — the deterministic rule. */
  beneficiaryPhoneMatch: number;
}

/** Why the flag was raised — carried into the audit trail for the reviewer. */
export type DuplicateTrigger = 'score_threshold' | 'beneficiary_phone_repeat';

export interface DuplicateDetectionResult {
  flagged: boolean;
  trigger: DuplicateTrigger | null;
  bestMatch: DuplicateMatch | null;
  consideredCount: number;
}

export async function detectDuplicates(
  db: PoolClient,
  newRequestId: number,
  actorUserId: number | null,
  actorRole: ActorRole,
): Promise<DuplicateDetectionResult> {
  const settings = await loadSettings(db);

  // Load the new request's matching fingerprint.
  const { rows: newRows } = await db.query<{
    id: number;
    request_type: string;
    primary_phone: string | null;
    beneficiary_phone: string | null;
    installed_device_id: number | null;
    external_device_serial: string | null;
    external_device_name: string | null;
    problem_description: string;
    created_at: string;
  }>(
    `SELECT
       id,
       request_type,
       requester_external->>'primary_phone' AS primary_phone,
       beneficiary_external->>'primary_phone' AS beneficiary_phone,
       installed_device_id,
       external_device_serial,
       external_device_name,
       problem_description,
       created_at
     FROM service_requests
     WHERE id = $1`,
    [newRequestId],
  );
  if (newRows.length === 0) {
    return { flagged: false, trigger: null, bestMatch: null, consideredCount: 0 };
  }
  const seed = newRows[0];

  // Score candidates in SQL — phone tail, device match flavours, trigram sim.
  // Window: 72h before seed.created_at.
  const { rows: candidates } = await db.query<{
    id: number;
    phone_match: number;
    beneficiary_phone_match: number;
    device_match: number;
    problem_similarity: number;
  }>(
    `SELECT
        c.id,
        -- Compared role against role, then the stronger of the two. Cross-role
        -- comparison is deliberately avoided: in for_self the requester and
        -- beneficiary snapshots hold the same number, so it would score a
        -- person against themselves.
        GREATEST(
          CASE
            WHEN $2::text IS NULL OR c_phone IS NULL THEN 0
            WHEN c_phone = $2 THEN 1.0
            WHEN RIGHT(c_phone, 7) = RIGHT($2, 7) THEN 0.8
            WHEN RIGHT(c_phone, 6) = RIGHT($2, 6) THEN 0.5
            ELSE 0
          END,
          CASE
            WHEN $10::text IS NULL OR c_ben_phone IS NULL THEN 0
            WHEN c_ben_phone = $10 THEN 1.0
            WHEN RIGHT(c_ben_phone, 7) = RIGHT($10, 7) THEN 0.8
            WHEN RIGHT(c_ben_phone, 6) = RIGHT($10, 6) THEN 0.5
            ELSE 0
          END
        ) AS phone_match,
        CASE
          WHEN $10::text IS NOT NULL AND c_ben_phone = $10 THEN 1.0
          ELSE 0
        END AS beneficiary_phone_match,
        CASE
          WHEN $3::int IS NOT NULL AND c.installed_device_id = $3::int THEN 1.0
          WHEN $4::text IS NOT NULL AND c.external_device_serial = $4 THEN 0.9
          WHEN $5::text IS NOT NULL AND c.external_device_name IS NOT NULL
               AND similarity(c.external_device_name, $5) > 0.4 THEN 0.5
          ELSE 0
        END AS device_match,
        COALESCE(similarity(c.problem_description, $6), 0)::float AS problem_similarity
      FROM (
        SELECT id, installed_device_id, external_device_serial, external_device_name,
               problem_description,
               requester_external->>'primary_phone' AS c_phone,
               beneficiary_external->>'primary_phone' AS c_ben_phone
          FROM service_requests
         WHERE id <> $1
           AND request_type = $9
           AND status NOT IN ('rejected','cancelled','promoted','resolved_at_intake')
           AND created_at >= $7::timestamptz - ($8 || ' hours')::interval
      ) c`,
    [
      seed.id,
      seed.primary_phone,
      seed.installed_device_id,
      seed.external_device_serial,
      seed.external_device_name,
      seed.problem_description,
      seed.created_at,
      settings.windowHours,
      seed.request_type,
      seed.beneficiary_phone,
    ],
  );

  let best: DuplicateMatch | null = null;
  let beneficiaryRepeat: DuplicateMatch | null = null;
  for (const c of candidates) {
    const phoneMatch = Number(c.phone_match);
    const beneficiaryPhoneMatch = Number(c.beneficiary_phone_match);
    const deviceMatch = Number(c.device_match);
    const problemSim = Number(c.problem_similarity);
    const score =
      settings.phoneWeight * phoneMatch +
      settings.deviceWeight * deviceMatch +
      settings.problemWeight * problemSim;
    const match: DuplicateMatch = {
      candidateId: c.id,
      score,
      phoneMatch,
      deviceMatch,
      problemSimilarity: problemSim,
      beneficiaryPhoneMatch,
    };
    if (!best || score > best.score) best = match;
    // Oldest wins: the reviewer is pointed at the request that came first,
    // which is the one already being worked on.
    if (beneficiaryPhoneMatch >= 1
      && (!beneficiaryRepeat || match.candidateId < beneficiaryRepeat.candidateId)) {
      beneficiaryRepeat = match;
    }
  }

  // The deterministic rule outranks the fuzzy score: an identical beneficiary
  // number is a fact, not an estimate, and it is the one signal that survives
  // an unverified submitter (D-WC5).
  const scoreFlagged = !!best && best.score >= settings.threshold;
  const trigger: DuplicateTrigger | null = beneficiaryRepeat
    ? 'beneficiary_phone_repeat'
    : scoreFlagged ? 'score_threshold' : null;
  if (beneficiaryRepeat) best = beneficiaryRepeat;
  const flagged = trigger !== null;

  if (flagged && best) {
    await db.query(
      `UPDATE service_requests
          SET duplicate_flag = TRUE,
              duplicate_of_request_id = $2,
              review_required_flag = TRUE
        WHERE id = $1`,
      [newRequestId, best.candidateId],
    );
    await appendAudit(db, {
      serviceRequestId: newRequestId,
      eventType: 'duplicate_flag_set',
      actorUserId,
      actorRole,
      payload: {
        duplicate_of_request_id: best.candidateId,
        trigger,
        score: best.score,
        phone_match: best.phoneMatch,
        beneficiary_phone_match: best.beneficiaryPhoneMatch,
        device_match: best.deviceMatch,
        problem_similarity: best.problemSimilarity,
        threshold: settings.threshold,
      },
    });
    await appendAudit(db, {
      serviceRequestId: newRequestId,
      eventType: 'review_required_flag_set',
      actorUserId,
      actorRole,
      payload: { reason: 'duplicate_detected', trigger, auto: true },
    });
  }

  return { flagged, trigger, bestMatch: best, consideredCount: candidates.length };
}
