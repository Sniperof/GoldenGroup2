// ============================================================
// serviceRequests/duplicateDetection.ts
// ============================================================
// Constitution source: §٠.١٥.أ — fuzzy duplicate algorithm
//
//   score = 0.50 * phone_match
//         + 0.25 * device_match
//         + 0.25 * problem_similarity (pg_trgm)
//
//   if score >= threshold and existing.status NOT IN terminals:
//     duplicate_flag = TRUE, duplicate_of_request_id = best,
//     review_required_flag = TRUE (SR-R009),
//     audit: duplicate_flag_set.
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
}

export interface DuplicateDetectionResult {
  flagged: boolean;
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
    primary_phone: string | null;
    installed_device_id: number | null;
    external_device_serial: string | null;
    external_device_name: string | null;
    problem_description: string;
    created_at: string;
  }>(
    `SELECT
       id,
       requester_external->>'primary_phone' AS primary_phone,
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
    return { flagged: false, bestMatch: null, consideredCount: 0 };
  }
  const seed = newRows[0];

  // Score candidates in SQL — phone tail, device match flavours, trigram sim.
  // Window: 72h before seed.created_at.
  const { rows: candidates } = await db.query<{
    id: number;
    phone_match: number;
    device_match: number;
    problem_similarity: number;
  }>(
    `SELECT
        c.id,
        CASE
          WHEN $2::text IS NULL OR c_phone IS NULL THEN 0
          WHEN c_phone = $2 THEN 1.0
          WHEN RIGHT(c_phone, 7) = RIGHT($2, 7) THEN 0.8
          WHEN RIGHT(c_phone, 6) = RIGHT($2, 6) THEN 0.5
          ELSE 0
        END AS phone_match,
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
               problem_description, requester_external->>'primary_phone' AS c_phone
          FROM service_requests
         WHERE id <> $1
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
    ],
  );

  let best: DuplicateMatch | null = null;
  for (const c of candidates) {
    const phoneMatch = Number(c.phone_match);
    const deviceMatch = Number(c.device_match);
    const problemSim = Number(c.problem_similarity);
    const score =
      settings.phoneWeight * phoneMatch +
      settings.deviceWeight * deviceMatch +
      settings.problemWeight * problemSim;
    if (!best || score > best.score) {
      best = {
        candidateId: c.id,
        score,
        phoneMatch,
        deviceMatch,
        problemSimilarity: problemSim,
      };
    }
  }

  const flagged = !!best && best.score >= settings.threshold;

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
        score: best.score,
        phone_match: best.phoneMatch,
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
      payload: { reason: 'duplicate_detected', auto: true },
    });
  }

  return { flagged, bestMatch: best, consideredCount: candidates.length };
}
