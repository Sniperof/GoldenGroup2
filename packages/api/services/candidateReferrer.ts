/**
 * Single source of truth for the referrer entry a client inherits from the
 * suggested name (candidate) it came from.
 *
 * Constitution — candidates.md BR-5 (قرار 2026-07-29): the candidate/sheet is
 * the SERVER-side source of truth for mediator type, id, name snapshot,
 * channel, date and address; the server must not accept parallel, tamperable
 * values for these fields from the browser.
 *
 * Both qualification paths must produce the same shape:
 *   - link   → POST /api/candidates/:id/link-client
 *   - convert→ POST /api/clients  (with `sourceCandidateId`)
 *
 * The convert path used to let ClientModal rebuild this object in the browser,
 * which overwrote a real `referral_name_snapshot` with the literal 'مجهول'
 * whenever the type was `Unknown`, hard-coded `referralSheetId: null`, dropped
 * the referral address and never stamped `sourceCandidateId` — leaving the
 * network tab with an anonymous mediator and no link back to the source name.
 */

export interface CandidateReferralSource {
  id: number | string;
  referralType?: string | null;
  referralOriginChannel?: string | null;
  referralNameSnapshot?: string | null;
  referralEntityId?: number | string | null;
  referralDate?: string | null;
  referralReason?: string | null;
  referralSheetId?: number | string | null;
  addressText?: string | null;
}

export interface CandidateReferrerEntry {
  id: number | null;
  sourceCandidateId: number;
  name: string | null;
  type: string | null;
  channel: string | null;
  address: string | null;
  referrerType: string | null;
  referrerId: null;
  referralEntityId: number | null;
  referrerName: string | null;
  sourceChannel: string | null;
  referralDate: string | null;
  referralReason: string | null;
  referralSheetId: number | null;
  referralAddressText: string | null;
}

/** The referral fields a browser payload may NOT decide for a conversion. */
export const CANDIDATE_OWNED_REFERRAL_FIELDS = [
  'referrerType',
  'referrerName',
  'referrerId',
  'referralEntityId',
  'sourceChannel',
  'referralDate',
  'referralReason',
  'referralSheetId',
  'referralAddressText',
] as const;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function id(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Build the client-side referrer entry from the candidate row.
 *
 * `referralDate` is passed in because the two paths date the relation
 * differently on purpose: linking stamps the day the relation was formed,
 * while conversion keeps the candidate's historical date and leaves a missing
 * one unknown rather than defaulting it to today (which would falsify
 * acquisition reports).
 */
export function buildReferrerFromCandidate(
  candidate: CandidateReferralSource,
  options: { referralDate: string | null },
): CandidateReferrerEntry {
  const referrerType = text(candidate.referralType);
  const referralEntityId = referrerType === 'Client' || referrerType === 'Employee'
    ? id(candidate.referralEntityId)
    : null;
  const referrerName = text(candidate.referralNameSnapshot);
  const sourceChannel = text(candidate.referralOriginChannel);
  const addressText = text(candidate.addressText);

  return {
    id: referralEntityId,
    sourceCandidateId: Number(candidate.id),
    name: referrerName,
    type: referrerType,
    channel: sourceChannel,
    address: addressText,
    referrerType,
    referrerId: null,
    referralEntityId,
    referrerName,
    sourceChannel,
    referralDate: text(options.referralDate),
    referralReason: text(candidate.referralReason),
    referralSheetId: id(candidate.referralSheetId),
    referralAddressText: addressText,
  };
}

/**
 * Drop the referral fields the browser is no longer allowed to decide, so the
 * candidate-derived entry is the only referrer the write path can see.
 */
export function stripBrowserReferralInput<T extends Record<string, any>>(payload: T): T {
  const stripped = { ...payload } as Record<string, any>;
  for (const field of CANDIDATE_OWNED_REFERRAL_FIELDS) {
    delete stripped[field];
  }
  delete stripped.referrers;
  return stripped as T;
}

type ReferrerQueryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

/**
 * Marks each referrer entry that was added by LINKING a duplicate suggested
 * name to an already existing client (`viaDuplicateLink: true`), as opposed to
 * the mediator whose name created the client. The sale form shows the mark so
 * the seller knows who brought the client before picking the sale's mediator
 * (2026-10-20).
 *
 * An entry stamped with `sourceCandidateId` is matched on it. Older entries
 * carry no stamp; with `clientId` they are matched against the names linked to
 * that client by mediator id, type, name snapshot and sheet — the same rule
 * the client network tab uses (GET /clients/:id/network), so both agree.
 */
export async function annotateDuplicateLinkReferrers<T extends Record<string, any>>(
  db: ReferrerQueryable,
  referrers: T[],
  clientId?: number | string | null,
): Promise<Array<T & { viaDuplicateLink: boolean }>> {
  const stampedIds = Array.from(new Set(
    referrers
      .map(ref => Number(ref?.sourceCandidateId))
      .filter(id => Number.isInteger(id) && id > 0),
  ));
  const numericClientId = Number(clientId);
  const hasClient = Number.isInteger(numericClientId) && numericClientId > 0;
  if (stampedIds.length === 0 && !hasClient) return referrers.map(ref => ({ ...ref, viaDuplicateLink: false }));

  const { rows } = await db.query(
    `SELECT id,
            converted_to_lead_id AS "clientId",
            referral_entity_id AS "entityId",
            referral_type AS "type",
            referral_name_snapshot AS "nameSnapshot",
            referral_sheet_id AS "sheetId"
       FROM candidates
      WHERE qualification_kind = 'linked'
        AND (id = ANY($1::int[]) OR ($2::int IS NOT NULL AND converted_to_lead_id = $2::int))`,
    [stampedIds, hasClient ? numericClientId : null],
  );
  const linkedIds = new Set(rows.map((row: any) => Number(row.id)));
  // A name already stamped on an entry belongs to that entry; an unstamped
  // entry (the original mediator, say) never claims it a second time.
  const clientLinked = hasClient
    ? rows.filter((row: any) => Number(row.clientId) === numericClientId && !stampedIds.includes(Number(row.id)))
    : [];
  const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();
  const positive = (value: unknown) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  return referrers.map(ref => {
    const stamped = positive(ref?.sourceCandidateId);
    if (stamped != null) return { ...ref, viaDuplicateLink: linkedIds.has(stamped) };
    const refEntity = positive(ref?.referralEntityId ?? ref?.id);
    const refType = norm(ref?.referrerType ?? ref?.type);
    const refName = norm(ref?.referrerName ?? ref?.name ?? ref?.referralName);
    const refSheet = positive(ref?.referralSheetId);
    const matched = clientLinked.some((row: any) => {
      const rowEntity = positive(row.entityId);
      const rowSheet = positive(row.sheetId);
      return (refEntity == null || rowEntity === refEntity)
        && (!refType || norm(row.type) === refType)
        && (!refName || norm(row.nameSnapshot) === refName)
        && (refSheet == null || rowSheet === refSheet);
    });
    return { ...ref, viaDuplicateLink: matched };
  });
}
