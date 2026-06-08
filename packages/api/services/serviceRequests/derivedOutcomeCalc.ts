// ============================================================
// serviceRequests/derivedOutcomeCalc.ts
// ============================================================
// Constitution source: §٠.١٩.ح — derived_outcome on open_task
//
//   IF every problem.status = 'resolved'                  → 'fully_resolved'
//   ELIF some 'resolved' AND some 'deferred'              → 'partially_resolved'
//   ELIF every 'deferred'                                  → 'all_deferred'
//   ELIF some 'unresolvable_field'                         → 'partially_unresolvable'
//   ELIF every 'unresolvable_field'                        → 'fully_unresolvable'
//   ELIF every 'cancelled'                                 → 'all_cancelled'
//   ELSE                                                   → 'mixed'
//
// Edge cases:
//   - Zero active problems (all soft-deleted) → 'no_problems'
//   - Problems still in 'reported' / 'confirmed' / 'resolved_at_intake'
//     before any field work — falls into 'mixed' since they neither
//     terminate the task nor count as a closure outcome.
//
// Pure read: no writes. The endpoint layer surfaces this on demand.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../../db.js';

export type DerivedOutcome =
  | 'fully_resolved'
  | 'partially_resolved'
  | 'all_deferred'
  | 'partially_unresolvable'
  | 'fully_unresolvable'
  | 'all_cancelled'
  | 'mixed'
  | 'no_problems';

export interface OutcomeBreakdown {
  outcome: DerivedOutcome;
  counts: Record<string, number>;
  total: number;
}

export async function computeDerivedOutcome(
  openTaskId: number,
  db?: PoolClient,
): Promise<OutcomeBreakdown> {
  const client = db ?? pool;
  const { rows } = await client.query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n
       FROM service_request_problems
      WHERE open_task_id = $1
        AND deleted_at IS NULL
      GROUP BY status`,
    [openTaskId],
  );
  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    counts[r.status] = Number(r.n);
    total += Number(r.n);
  }
  return { outcome: classify(counts, total), counts, total };
}

function classify(counts: Record<string, number>, total: number): DerivedOutcome {
  if (total === 0) return 'no_problems';
  const resolved = counts['resolved'] ?? 0;
  const deferred = counts['deferred'] ?? 0;
  const unresolvable = counts['unresolvable_field'] ?? 0;
  const cancelled = counts['cancelled'] ?? 0;

  if (resolved === total) return 'fully_resolved';
  if (unresolvable === total) return 'fully_unresolvable';
  if (cancelled === total) return 'all_cancelled';
  if (deferred === total) return 'all_deferred';

  if (resolved > 0 && deferred > 0 && unresolvable === 0) return 'partially_resolved';
  if (unresolvable > 0) return 'partially_unresolvable';

  return 'mixed';
}
