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
  sources?: 'all' | 'clients';
}

export interface SuggestedMatch {
  source: 'client' | 'candidate';
  id: number;
  clientType: 'Client' | 'Candidate';
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  secondaryPhones: string[];
  score: number;
  confidence: 'high' | 'medium' | 'low';
  branchId: number | null;
  governorateId: number | null;
  regionId: number | null;
  subdistrictId: number | null;
  neighborhoodId: number | null;
  detailedAddress: string | null;
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

function phoneNormalizationSql(expression: string): string {
  const digits = `regexp_replace(COALESCE(${expression}, ''), '\\D', '', 'g')`;
  return `
    CASE
      WHEN ${digits} ~ '^009639\\d{8}$' THEN '0' || right(${digits}, 9)
      WHEN ${digits} ~ '^9639\\d{8}$' THEN '0' || right(${digits}, 9)
      WHEN ${digits} ~ '^9\\d{8}$' THEN '0' || ${digits}
      ELSE ${digits}
    END
  `;
}

export async function suggestRecords(
  input: SuggestInput,
  db?: PoolClient,
): Promise<SuggestOutput> {
  const client = db ?? pool;
  const name = (input.name ?? '').trim();
  const phone = (input.phone ?? '').trim();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 10));
  const sources = input.sources ?? 'all';

  if (name.length === 0 && phone.length === 0) {
    return { clients: [], candidates: [] };
  }

  // ----- Clients -----
  // Clients table has full_name + phone fields (varies). We use COALESCE-safe
  // similarity on full_name + tail match on phone. Score combines weighted.
  const { rows: clientRows } = await client.query<{
    id: number;
    name: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    secondary_phones: string[] | null;
    branch_id: number | null;
    governorate_id: number | null;
    region_id: number | null;
    neighborhood_id: number | null;
    detailed_address: string | null;
    name_sim: number;
    phone_score: number;
  }>(
    `SELECT
        c.id,
        COALESCE(NULLIF(c.name, ''), NULLIF(CONCAT_WS(' ', c.first_name, c.father_name, c.last_name), ''), 'زبون #' || c.id::text) AS name,
        c.first_name,
        c.last_name,
        c.mobile AS phone,
        COALESCE((
          SELECT array_agg(contact->>'number')
            FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
           WHERE COALESCE(contact->>'number', '') <> ''
             AND ${phoneNormalizationSql(`contact->>'number'`)} <> ${phoneNormalizationSql('c.mobile')}
        ), '{}'::text[]) AS secondary_phones,
        c.branch_id,
        c.governorate AS governorate_id,
        c.district AS region_id,
        c.neighborhood AS neighborhood_id,
        c.detailed_address,
        CASE WHEN $1::text = '' THEN 0
             ELSE COALESCE(similarity(COALESCE(c.name, CONCAT_WS(' ', c.first_name, c.father_name, c.last_name)), $1::text), 0)::float
        END AS name_sim,
        CASE
          WHEN $2::text = '' THEN 0
          WHEN ${phoneNormalizationSql('c.mobile')} = ${phoneNormalizationSql('$2::text')} THEN 1.0
          WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE ${phoneNormalizationSql(`contact->>'number'`)} = ${phoneNormalizationSql('$2::text')}
          ) THEN 1.0
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 7) = RIGHT(${phoneNormalizationSql('$2::text')}, 7) THEN 0.8
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6) THEN 0.5
          ELSE 0
        END AS phone_score
       FROM clients c
      WHERE COALESCE(c.is_candidate, FALSE) = FALSE
        AND c.deleted_at IS NULL
        AND (
          ($1::text <> '' AND similarity(COALESCE(c.name, CONCAT_WS(' ', c.first_name, c.father_name, c.last_name)), $1::text) > 0.2)
          OR ($2::text <> '' AND RIGHT(${phoneNormalizationSql('c.mobile')}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6))
          OR ($2::text <> '' AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE RIGHT(${phoneNormalizationSql(`contact->>'number'`)}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6)
          ))
        )
      ORDER BY (
        ${NAME_WEIGHT} * COALESCE(similarity(COALESCE(c.name, CONCAT_WS(' ', c.first_name, c.father_name, c.last_name)), $1::text), 0) +
        ${PHONE_WEIGHT} * CASE
          WHEN $2::text = '' THEN 0
          WHEN ${phoneNormalizationSql('c.mobile')} = ${phoneNormalizationSql('$2::text')} THEN 1.0
          WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE ${phoneNormalizationSql(`contact->>'number'`)} = ${phoneNormalizationSql('$2::text')}
          ) THEN 1.0
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 7) = RIGHT(${phoneNormalizationSql('$2::text')}, 7) THEN 0.8
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6) THEN 0.5
          ELSE 0
        END
      ) DESC
      LIMIT $3`,
    [name, phone, limit],
  );

  // ----- Candidates -----
  const candRows = sources === 'clients' ? [] : (await client.query<{
    id: number;
    name: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    secondary_phones: string[] | null;
    branch_id: number | null;
    geo_unit_id: number | null;
    detailed_address: string | null;
    name_sim: number;
    phone_score: number;
  }>(
    `SELECT
        c.id,
        NULLIF(CONCAT_WS(' ', c.first_name, c.last_name), '') AS name,
        c.first_name,
        c.last_name,
        c.mobile AS phone,
        COALESCE((
          SELECT array_agg(contact->>'number')
            FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
           WHERE COALESCE(contact->>'number', '') <> ''
             AND ${phoneNormalizationSql(`contact->>'number'`)} <> ${phoneNormalizationSql('c.mobile')}
        ), '{}'::text[]) AS secondary_phones,
        c.branch_id,
        c.geo_unit_id,
        c.address_text AS detailed_address,
        CASE WHEN $1::text = '' THEN 0
             ELSE COALESCE(similarity(CONCAT_WS(' ', c.first_name, c.last_name), $1::text), 0)::float
        END AS name_sim,
        CASE
          WHEN $2::text = '' THEN 0
          WHEN ${phoneNormalizationSql('c.mobile')} = ${phoneNormalizationSql('$2::text')} THEN 1.0
          WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE ${phoneNormalizationSql(`contact->>'number'`)} = ${phoneNormalizationSql('$2::text')}
          ) THEN 1.0
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 7) = RIGHT(${phoneNormalizationSql('$2::text')}, 7) THEN 0.8
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6) THEN 0.5
          ELSE 0
        END AS phone_score
       FROM candidates c
      WHERE (
          ($1::text <> '' AND similarity(CONCAT_WS(' ', c.first_name, c.last_name), $1::text) > 0.2)
          OR ($2::text <> '' AND RIGHT(${phoneNormalizationSql('c.mobile')}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6))
          OR ($2::text <> '' AND EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE RIGHT(${phoneNormalizationSql(`contact->>'number'`)}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6)
          ))
        )
      ORDER BY (
        ${NAME_WEIGHT} * COALESCE(similarity(CONCAT_WS(' ', c.first_name, c.last_name), $1::text), 0) +
        ${PHONE_WEIGHT} * CASE
          WHEN $2::text = '' THEN 0
          WHEN ${phoneNormalizationSql('c.mobile')} = ${phoneNormalizationSql('$2::text')} THEN 1.0
          WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
             WHERE ${phoneNormalizationSql(`contact->>'number'`)} = ${phoneNormalizationSql('$2::text')}
          ) THEN 1.0
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 7) = RIGHT(${phoneNormalizationSql('$2::text')}, 7) THEN 0.8
          WHEN RIGHT(${phoneNormalizationSql('c.mobile')}, 6) = RIGHT(${phoneNormalizationSql('$2::text')}, 6) THEN 0.5
          ELSE 0
        END
      ) DESC
      LIMIT $3`,
    [name, phone, limit],
  )).rows;

  const buildMatch = (r: {
    id: number;
    name: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    secondary_phones?: string[] | null;
    branch_id?: number | null;
    governorate_id?: number | null;
    region_id?: number | null;
    neighborhood_id?: number | null;
    geo_unit_id?: number | null;
    detailed_address?: string | null;
    name_sim: number;
    phone_score: number;
  }, source: 'client' | 'candidate'): SuggestedMatch => {
    const score = NAME_WEIGHT * Number(r.name_sim) + PHONE_WEIGHT * Number(r.phone_score);
    return {
      source,
      id: r.id,
      clientType: source === 'client' ? 'Client' : 'Candidate',
      name: r.name || `${source === 'client' ? 'Client' : 'Candidate'} #${r.id}`,
      firstName: r.first_name ?? null,
      lastName: r.last_name ?? null,
      phone: r.phone,
      secondaryPhones: Array.isArray(r.secondary_phones) ? r.secondary_phones : [],
      score,
      confidence: confidenceFor(score),
      branchId: r.branch_id,
      governorateId: r.governorate_id ?? null,
      regionId: r.region_id ?? null,
      subdistrictId: null,
      neighborhoodId: r.neighborhood_id ?? r.geo_unit_id ?? null,
      detailedAddress: r.detailed_address ?? null,
    };
  };

  const combined = [
    ...clientRows.map((r) => buildMatch(r, 'client')),
    ...candRows.map((r) => buildMatch(r, 'candidate')),
  ].sort((a, b) => b.score - a.score).slice(0, limit);

  return {
    clients: combined.filter((match) => match.source === 'client'),
    candidates: combined.filter((match) => match.source === 'candidate'),
  };
}
