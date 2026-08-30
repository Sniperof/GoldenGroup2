/**
 * Server-side recomputation of referral-sheet statistics.
 *
 * These numbers used to be derived in the browser (`useCandidateStore
 * .updateSheetStats`) by filtering the fully-loaded candidates array and then
 * PUT-ing the result back — which only works while the page holds every
 * candidate in memory, and silently skipped deletions and empty sheets. The
 * counters are now derived from the relation itself, in line with the
 * 2026-07-29 decision in candidates.md ("يحسب عدد الأسماء الفعلي خادمياً من
 * العلاقة ولا يعتمد وحده على العداد المخزن").
 *
 * Definitions preserved from the previous client-side computation:
 *   total      = names attached to the sheet
 *   quality    = share of names that are neither flagged duplicate nor Junk
 *   conversion = share of names linked to a client (converted_to_lead_id)
 */

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export async function recomputeReferralSheetStats(
  db: Queryable,
  sheetId: unknown,
): Promise<void> {
  const id = Number(sheetId);
  if (!Number.isInteger(id) || id <= 0) return;

  await db.query(
    `WITH agg AS (
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE duplicate_flag IS NOT TRUE
             AND COALESCE(status, '') <> 'Junk'
             -- A linked name was an existing customer, never a new lead — it is
             -- excluded explicitly rather than relying on duplicate_flag, which
             -- misses a link whose phone number happens to differ (migration 442).
             AND qualification_kind IS DISTINCT FROM 'linked'
         )::int AS valid,
         COUNT(*) FILTER (WHERE converted_to_lead_id IS NOT NULL)::int AS converted
       FROM candidates
      WHERE referral_sheet_id = $1
     )
     UPDATE referral_sheets rs
        SET total_candidates = agg.total,
            quality_percentage = CASE WHEN agg.total = 0 THEN 0
                                      ELSE ROUND(agg.valid::numeric * 100 / agg.total) END,
            conversion_percentage = CASE WHEN agg.total = 0 THEN 0
                                         ELSE ROUND(agg.converted::numeric * 100 / agg.total) END
       FROM agg
      WHERE rs.id = $1`,
    [id],
  );
}
