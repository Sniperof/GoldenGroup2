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
