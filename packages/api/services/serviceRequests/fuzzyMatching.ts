// ============================================================
// serviceRequests/fuzzyMatching.ts
// ============================================================
// Constitution source: §٠.١١ (Suggested Records List) + §٠.١٥.أ shape
//
// Different goal from duplicateDetection:
//   - duplicateDetection: "is this NEW request a duplicate of an existing
//     service_request?" Runs post-insert, weighs phone + device + problem.
//   - fuzzyMatching.suggestRecords: "for an Operator linking an unattached
//     request, which clients / candidates fuzzy-match the requester's
//     name + phone?" Returns ranked candidates so the operator can pick.
//
// Output is read-only suggestions for the UI — no writes, no side effects.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../../db.js';

export interface SuggestInput {
  name?: string | null;
  phone?: string | null;
  /** Soft cap on returned suggestions per source. */
  limit?: number;
}

export interface SuggestedMatch {
  source: 'client' | 'candidate';
  id: number;
  name: string;
  phone: string | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  branchId: number | null;
}

export interface SuggestOutput {
  clients: SuggestedMatch[];
  candidates: SuggestedMatch[];
}

const HIGH_THRESHOLD = 0.75;
const MEDIUM_THRESHOLD = 0.5;
const NAME_WEIGHT = 0.5;
const PHONE_WEIGHT = 0.5;

function confidenceFor(score: number): 'high' | 'medium' | 'low' {
  if (score >= HIGH_THRESHOLD) return 'high';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

export async function suggestRecords(
  input: SuggestInput,
  db?: PoolClient,
): Promise<SuggestOutput> {
  const client = db ?? pool;
  const name = (input.name ?? '').trim();
  const phone = (input.phone ?? '').trim();
  const limit = input.limit ?? 10;

  if (name.length === 0 && phone.length === 0) {
    return { clients: [], candidates: [] };
  }

  // ----- Clients -----
  // Clients table has full_name + phone fields (varies). We use COALESCE-safe
  // similarity on full_name + tail match on phone. Score combines weighted.
  const { rows: clientRows } = await client.query<{
    id: number;
    name: string;
    phone: string | null;
    branch_id: number | null;
    name_sim: number;
    phone_score: number;
  }>(
    `SELECT
        c.id,
        c.full_name AS name,
        c.phone1 AS phone,
        c.branch_id,
        CASE WHEN $1::text = '' THEN 0
             ELSE COALESCE(similarity(c.full_name, $1::text), 0)::float
        END AS name_sim,
        CASE
          WHEN $2::text = '' OR c.phone1 IS NULL THEN 0
          WHEN c.phone1 = $2::text THEN 1.0
          WHEN RIGHT(c.phone1, 7) = RIGHT($2::text, 7) THEN 0.8
          WHEN RIGHT(c.phone1, 6) = RIGHT($2::text, 6) THEN 0.5
          ELSE 0
        END AS phone_score
       FROM clients c
      WHERE c.is_candidate = false
        AND (
          ($1::text <> '' AND similarity(c.full_name, $1::text) > 0.2)
          OR ($2::text <> '' AND RIGHT(c.phone1, 6) = RIGHT($2::text, 6))
        )
      ORDER BY (
        ${NAME_WEIGHT} * COALESCE(similarity(c.full_name, $1::text), 0) +
        ${PHONE_WEIGHT} * CASE
          WHEN $2::text = '' OR c.phone1 IS NULL THEN 0
          WHEN c.phone1 = $2::text THEN 1.0
          WHEN RIGHT(c.phone1, 7) = RIGHT($2::text, 7) THEN 0.8
          WHEN RIGHT(c.phone1, 6) = RIGHT($2::text, 6) THEN 0.5
          ELSE 0
        END
      ) DESC
      LIMIT $3`,
    [name, phone, limit],
  );

  // ----- Candidates -----
  const { rows: candRows } = await client.query<{
    id: number;
    name: string;
    phone: string | null;
    branch_id: number | null;
    name_sim: number;
    phone_score: number;
  }>(
    `SELECT
        c.id,
        c.full_name AS name,
        c.phone1 AS phone,
        c.branch_id,
        CASE WHEN $1::text = '' THEN 0
             ELSE COALESCE(similarity(c.full_name, $1::text), 0)::float
        END AS name_sim,
        CASE
          WHEN $2::text = '' OR c.phone1 IS NULL THEN 0
          WHEN c.phone1 = $2::text THEN 1.0
          WHEN RIGHT(c.phone1, 7) = RIGHT($2::text, 7) THEN 0.8
          WHEN RIGHT(c.phone1, 6) = RIGHT($2::text, 6) THEN 0.5
          ELSE 0
        END AS phone_score
       FROM candidates c
      WHERE (
          ($1::text <> '' AND similarity(c.full_name, $1::text) > 0.2)
          OR ($2::text <> '' AND RIGHT(c.phone1, 6) = RIGHT($2::text, 6))
        )
      ORDER BY (
        ${NAME_WEIGHT} * COALESCE(similarity(c.full_name, $1::text), 0) +
        ${PHONE_WEIGHT} * CASE
          WHEN $2::text = '' OR c.phone1 IS NULL THEN 0
          WHEN c.phone1 = $2::text THEN 1.0
          WHEN RIGHT(c.phone1, 7) = RIGHT($2::text, 7) THEN 0.8
          WHEN RIGHT(c.phone1, 6) = RIGHT($2::text, 6) THEN 0.5
          ELSE 0
        END
      ) DESC
      LIMIT $3`,
    [name, phone, limit],
  );

  const buildMatch = (r: typeof clientRows[number], source: 'client' | 'candidate'): SuggestedMatch => {
    const score = NAME_WEIGHT * Number(r.name_sim) + PHONE_WEIGHT * Number(r.phone_score);
    return {
      source,
      id: r.id,
      name: r.name,
      phone: r.phone,
      score,
      confidence: confidenceFor(score),
      branchId: r.branch_id,
    };
  };

  return {
    clients: clientRows.map((r) => buildMatch(r, 'client')),
    candidates: candRows.map((r) => buildMatch(r, 'candidate')),
  };
}
