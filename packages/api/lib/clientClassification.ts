// ============================================================
// lib/clientClassification.ts
// ============================================================
// Single source of truth for a client's business classification.
//
// System-wide rule (see clientLifecycleService — OP/FOP are the two promoted
// states, everything else is un-promoted; and customerOwnership which treats
// OP/FOP specially): a client is OP or FOP when candidate_status says so,
// otherwise a Lead by DEFAULT. It is never null — "no recognised stage yet"
// means Lead, not "unknown".
//
// Returns canonical-cased 'OP' | 'FOP' | 'Lead'. Callers that need a different
// casing (e.g. clientSnapshot emits upper-case 'LEAD') derive from this.
// ============================================================

export type ClientClassification = 'OP' | 'FOP' | 'Lead';

export function deriveClientClassification(
  candidateStatus: string | null | undefined,
): ClientClassification {
  const s = String(candidateStatus ?? '').trim().toUpperCase();
  if (s === 'OP') return 'OP';
  if (s === 'FOP') return 'FOP';
  return 'Lead';
}
