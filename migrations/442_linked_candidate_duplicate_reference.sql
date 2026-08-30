-- ============================================================
-- 442_linked_candidate_duplicate_reference.sql
-- ============================================================
-- Follow-up to 440. Two loose ends it left:
--
-- 1. Historical LINKED names keep duplicate_flag = TRUE (correct — they were
--    attached to a client that already existed) but carry no duplicate_type and
--    no duplicate_reference_id, because the old code asserted the flag without
--    ever computing a verdict. The record they duplicate is known exactly: it is
--    the client they were linked to.
--
-- 2. Sheet quality leaned on duplicate_flag to exclude linked names. That worked
--    only by accident — a name linked to an existing client whose phone number
--    differs would not be flagged, and would then be counted as a *valid* new
--    name even though the person was already a customer. Quality now excludes
--    linked names explicitly, which is what the metric always meant to say:
--    "how many of these names were genuinely new, usable leads".
-- ============================================================

UPDATE candidates
   SET duplicate_type = 'Client',
       duplicate_reference_id = converted_to_lead_id
 WHERE qualification_kind = 'linked'
   AND converted_to_lead_id IS NOT NULL
   AND duplicate_type IS NULL;

-- Recompute every sheet with the corrected quality definition (mirrors
-- services/referralSheetStats.ts).
WITH agg AS (
  SELECT
    referral_sheet_id AS sheet_id,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (
      WHERE duplicate_flag IS NOT TRUE
        AND COALESCE(status, '') <> 'Junk'
        AND qualification_kind IS DISTINCT FROM 'linked'
    )::int AS valid,
    COUNT(*) FILTER (WHERE converted_to_lead_id IS NOT NULL)::int AS converted
    FROM candidates
   WHERE referral_sheet_id IS NOT NULL
   GROUP BY referral_sheet_id
)
UPDATE referral_sheets rs
   SET total_candidates = agg.total,
       quality_percentage = CASE WHEN agg.total = 0 THEN 0
                                 ELSE ROUND(agg.valid::numeric * 100 / agg.total) END,
       conversion_percentage = CASE WHEN agg.total = 0 THEN 0
                                    ELSE ROUND(agg.converted::numeric * 100 / agg.total) END
  FROM agg
 WHERE rs.id = agg.sheet_id;
