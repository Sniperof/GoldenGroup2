// Referral credit — what a mediator earns for one suggested name (2026-10-20).
//
// A name reaches a client in one of two ways:
//   • converted — the name became a NEW client: the mediator gets acquisition
//     credit, and purchase credit once that client is OP;
//   • linked    — the name was a duplicate of a client that already existed:
//     no acquisition credit, and purchase credit only for a contract made on
//     or after the link day.
// The link day is the date stamped on the referrer entry the link appended to
// the client (`clients.referrers[].sourceCandidateId = name`); the name's own
// creation day is the fallback for entries without one.
//
// Shared by the gift-record source status and the mediator gifts report so
// both apply the same rule as the client network tab.

import { buildClientLifecycleStatusSql } from './customerOwnership.js';

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

/** SQL date: the day `candidateAlias` was linked to `clientAlias`. */
export function linkedOnSql(candidateAlias: string, clientAlias: string): string {
  return `COALESCE(
    (SELECT MIN(LEFT(link_ref->>'referralDate', 10)::date)
       FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(${clientAlias}.referrers) = 'array' THEN ${clientAlias}.referrers ELSE '[]'::jsonb END
            ) link_ref
      WHERE link_ref->>'sourceCandidateId' = ${candidateAlias}.id::text
        AND link_ref->>'referralDate' ~ '^\\d{4}-\\d{2}-\\d{2}'),
    (${candidateAlias}.created_at AT TIME ZONE 'Asia/Damascus')::date
  )`;
}

/** SQL boolean: `clientAlias` has an approved (non-draft) contract made on or after `dateSql`. */
export function purchasedOnOrAfterSql(clientAlias: string, dateSql: string): string {
  return `EXISTS (
    SELECT 1 FROM contracts credit_ct
     WHERE credit_ct.customer_id = ${clientAlias}.id
       AND credit_ct.status NOT IN ('draft', 'discarded')
       AND (COALESCE(credit_ct.closing_date, credit_ct.created_at) AT TIME ZONE 'Asia/Damascus')::date >= ${dateSql}
  )`;
}

/** SQL boolean: the mediator earns purchase credit for this name. */
export function purchaseCreditSql(candidateAlias: string, clientAlias: string): string {
  return `CASE
    WHEN ${clientAlias}.id IS NULL THEN FALSE
    WHEN ${candidateAlias}.qualification_kind = 'linked'
      THEN ${purchasedOnOrAfterSql(clientAlias, linkedOnSql(candidateAlias, clientAlias))}
    ELSE (${buildClientLifecycleStatusSql(clientAlias)}) = 'OP'
  END`;
}

export type ReferralNameState = 'open' | 'rejected' | 'converted' | 'linked';

export interface GiftSourceName {
  candidateId: number;
  name: string;
  state: ReferralNameState;
  clientId: number | null;
  clientName: string | null;
  /** Computed lifecycle stage of the client the name reached. */
  stage: 'LEAD' | 'FOP' | 'OP' | null;
  linkedOn: string | null;
  /** First approved contract of the client (any time). */
  firstPurchaseOn: string | null;
  /** The mediator earns purchase credit for this name (see the module comment). */
  purchaseCredited: boolean;
}

export interface GiftSourceStatus {
  applicable: boolean;
  summary: {
    names: number;
    converted: number;
    linked: number;
    purchaseCredited: number;
    /** Linked names whose client bought before the link: no credit. */
    linkedBoughtBefore: number;
  };
  names: GiftSourceName[];
  truncated: boolean;
}

const NAMES_LIMIT = 200;

/**
 * The suggested names behind a referral gift promise (its `candidate` and
 * `name_list` sources) with what each one earns the mediator. Decision
 * support for the manual condition check; it never changes the record.
 */
export async function loadGiftSourceStatus(db: Queryable, giftRecordId: number): Promise<GiftSourceStatus> {
  const { rows } = await db.query(
    `WITH source_names AS (
       SELECT DISTINCT can.id
         FROM gift_record_sources src
         JOIN candidates can
           ON (src.source_type = 'candidate' AND can.id = src.candidate_id)
           OR (src.source_type = 'name_list' AND can.referral_sheet_id = src.referral_sheet_id)
        WHERE src.gift_record_id = $1
     )
     SELECT can.id AS "candidateId",
            COALESCE(
              NULLIF(TRIM(CONCAT_WS(' ', can.first_name, can.last_name)), ''),
              NULLIF(can.nickname, ''),
              CONCAT('#', can.id)
            ) AS name,
            CASE
              WHEN cl.id IS NULL THEN CASE WHEN can.status = 'Junk' THEN 'rejected' ELSE 'open' END
              WHEN can.qualification_kind = 'linked' THEN 'linked'
              ELSE 'converted'
            END AS state,
            cl.id AS "clientId",
            cl.name AS "clientName",
            CASE WHEN cl.id IS NOT NULL THEN (${buildClientLifecycleStatusSql('cl')}) END AS stage,
            CASE WHEN cl.id IS NOT NULL AND can.qualification_kind = 'linked'
                 THEN ${linkedOnSql('can', 'cl')} END AS "linkedOn",
            (SELECT MIN((COALESCE(first_ct.closing_date, first_ct.created_at) AT TIME ZONE 'Asia/Damascus')::date)
               FROM contracts first_ct
              WHERE cl.id IS NOT NULL
                AND first_ct.customer_id = cl.id
                AND first_ct.status NOT IN ('draft', 'discarded')) AS "firstPurchaseOn",
            ${purchaseCreditSql('can', 'cl')} AS "purchaseCredited"
       FROM source_names sn
       JOIN candidates can ON can.id = sn.id
       LEFT JOIN clients cl ON cl.id = can.converted_to_lead_id AND cl.deleted_at IS NULL
      ORDER BY (cl.id IS NULL), can.id`,
    [giftRecordId],
  );

  const toDate = (value: unknown) => (value ? new Date(value as string).toISOString().split('T')[0] : null);
  const names: GiftSourceName[] = rows.map((row: any) => ({
    candidateId: Number(row.candidateId),
    name: row.name,
    state: row.state,
    clientId: row.clientId == null ? null : Number(row.clientId),
    clientName: row.clientName ?? null,
    stage: row.stage ?? null,
    linkedOn: toDate(row.linkedOn),
    firstPurchaseOn: toDate(row.firstPurchaseOn),
    purchaseCredited: row.purchaseCredited === true,
  }));

  return {
    applicable: names.length > 0,
    summary: {
      names: names.length,
      converted: names.filter(n => n.state === 'converted').length,
      linked: names.filter(n => n.state === 'linked').length,
      purchaseCredited: names.filter(n => n.purchaseCredited).length,
      linkedBoughtBefore: names.filter(n => n.state === 'linked' && n.firstPurchaseOn != null && !n.purchaseCredited).length,
    },
    names: names.slice(0, NAMES_LIMIT),
    truncated: names.length > NAMES_LIMIT,
  };
}
