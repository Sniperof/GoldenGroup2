import { normalizePhone } from '../utils/contactValidation.js';
import { phoneNormalizationSql } from '../utils/phoneSql.js';

/**
 * Server-side duplicate detection for candidates (candidates.md BR-2).
 *
 * The constitution requires the SERVER to check every number on the candidate
 * (`mobile` + `contacts`) against client numbers and other candidate numbers
 * "بصرف النظر عن نطاق القائمة التي استطاعت الواجهة تحميلها" — regardless of what
 * the browser managed to load. Until now the flags were computed in the browser
 * from `api.clients.list()` (the whole clients table) and sent in the request
 * body, which made the verdict depend on the caller's scope and pulled 100k+
 * rows per created name. This module replaces that with two indexed-by-nothing
 * but single-shot lookups run inside the write transaction.
 */

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export type CandidateDuplicateVerdict = {
  duplicateFlag: boolean;
  duplicateType: 'Client' | 'Candidate' | 'Both' | null;
  duplicateReferenceId: number | null;
};

export const NO_CANDIDATE_DUPLICATE: CandidateDuplicateVerdict = {
  duplicateFlag: false,
  duplicateType: null,
  duplicateReferenceId: null,
};

/**
 * Every distinct normalised number carried by a candidate payload — the primary
 * mobile plus each contact entry (BR-2 checks "كل رقم", not only the primary).
 */
export function collectCandidatePhones(payload: {
  mobile?: unknown;
  contacts?: unknown;
}): string[] {
  const raw: unknown[] = [payload?.mobile];
  if (Array.isArray(payload?.contacts)) {
    for (const contact of payload.contacts as any[]) {
      raw.push(contact?.number);
    }
  }
  return Array.from(new Set(raw.map(normalizePhone).filter(Boolean)));
}

const PHONE_MATCH_CONDITION = (table: string) => `(
  ${phoneNormalizationSql(`${table}.mobile`)} = ANY($1::text[])
  OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(${table}.contacts, '[]'::jsonb)) AS contact
     WHERE ${phoneNormalizationSql(`contact->>'number'`)} = ANY($1::text[])
  )
)`;

/**
 * Detects whether any of `phones` already exists on a client or on another
 * candidate, and returns the BR-2 verdict. Scope-blind by design: the flag is a
 * data-integrity signal, and the constitution gates *revealing* the matched
 * record separately (GET /candidates/:id resolves the reference through the
 * subject policies and returns the bare fact when the caller cannot see it).
 */
export async function detectCandidateDuplicate(
  db: Queryable,
  phones: string[],
  excludeCandidateId: number | null = null,
  /**
   * The client this candidate BECAME. A conversion creates a client carrying the
   * candidate's own number, so without this the name would flag itself as a
   * duplicate of itself the moment it succeeds — which is exactly what used to
   * drag a fully-converted sheet's quality score down to zero. A *linked* name
   * passes null here: the client it matched existed beforehand, so it is a real
   * duplicate and must stay flagged.
   */
  excludeClientId: number | null = null,
): Promise<CandidateDuplicateVerdict> {
  if (phones.length === 0) return { ...NO_CANDIDATE_DUPLICATE };

  const { rows: clientRows } = await db.query(
    `SELECT c.id
       FROM clients c
      WHERE c.is_candidate = FALSE
        AND ($2::int IS NULL OR c.id <> $2)
        AND ${PHONE_MATCH_CONDITION('c')}
      ORDER BY c.id ASC
      LIMIT 1`,
    [phones, excludeClientId],
  );

  const { rows: candidateRows } = await db.query(
    `SELECT c.id
       FROM candidates c
      WHERE ($2::int IS NULL OR c.id <> $2)
        AND ${PHONE_MATCH_CONDITION('c')}
      ORDER BY c.id ASC
      LIMIT 1`,
    [phones, excludeCandidateId],
  );

  const clientMatchId = clientRows[0]?.id != null ? Number(clientRows[0].id) : null;
  const candidateMatchId = candidateRows[0]?.id != null ? Number(candidateRows[0].id) : null;

  if (clientMatchId == null && candidateMatchId == null) {
    return { ...NO_CANDIDATE_DUPLICATE };
  }

  // `duplicate_reference_id` is a legacy single reference (BR-2); when both an
  // existing client and another candidate match, the client is the more
  // actionable pointer — same preference the browser-side check used.
  return {
    duplicateFlag: true,
    duplicateType:
      clientMatchId != null && candidateMatchId != null
        ? 'Both'
        : clientMatchId != null
          ? 'Client'
          : 'Candidate',
    duplicateReferenceId: clientMatchId ?? candidateMatchId,
  };
}
