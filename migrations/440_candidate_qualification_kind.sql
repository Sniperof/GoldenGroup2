-- ============================================================
-- 440_candidate_qualification_kind.sql
-- ============================================================
-- Separates "تم التحويل" (a NEW client was created from this name) from
-- "تم الربط" (the name was attached to an ALREADY EXISTING client), and repairs
-- the damage caused by using duplicate_flag as the de-facto discriminator.
--
-- Before this migration both paths wrote the identical three fields:
--   status='Qualified', converted_to_lead_id=<client>, duplicate_flag=TRUE
-- so nothing in the data told them apart, the badge rendered every qualified
-- name as "تم الربط", and — because referralSheetStats counts a name as valid
-- only when duplicate_flag IS NOT TRUE — a sheet that converted ALL of its names
-- scored 0% quality (observed: sheet 6, conversion 100% / quality 0%).
--
-- duplicate_flag goes back to meaning one thing only: this name's phone number
-- already exists elsewhere. A CONVERTED name is not a duplicate of the client it
-- just became; a LINKED name is a genuine duplicate of a client that existed
-- before it.
-- ============================================================

-- ── 1. The discriminator ────────────────────────────────────
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS qualification_kind TEXT;

ALTER TABLE candidates
  DROP CONSTRAINT IF EXISTS candidates_qualification_kind_check;
ALTER TABLE candidates
  ADD CONSTRAINT candidates_qualification_kind_check
  CHECK (qualification_kind IS NULL OR qualification_kind IN ('converted', 'linked'));

-- ── 2. Backfill history ─────────────────────────────────────
-- The only surviving trace of a conversion is on the client side: the client
-- created from a name carries that name's id as `sourceCandidateId` inside its
-- `referrers` JSONB. Anything qualified without that trace was a link.
UPDATE candidates c
   SET qualification_kind = 'converted'
  FROM clients cl
 WHERE c.status = 'Qualified'
   AND c.converted_to_lead_id = cl.id
   AND cl.referrers @> jsonb_build_array(jsonb_build_object('sourceCandidateId', c.id))
   AND c.qualification_kind IS NULL;

UPDATE candidates
   SET qualification_kind = 'linked'
 WHERE status = 'Qualified'
   AND converted_to_lead_id IS NOT NULL
   AND qualification_kind IS NULL;

-- ── 3. Repair duplicate_flag on converted names ─────────────
-- Re-derive the flag for converted names, ignoring the client they became.
-- A remaining match (another client, or another candidate carrying the same
-- number) keeps the flag TRUE — this is a repair, not a blanket clear.
WITH converted AS (
  SELECT
    c.id,
    c.converted_to_lead_id,
    ARRAY(
      SELECT DISTINCT regexp_replace(p, '\D', '', 'g')
        FROM unnest(
               ARRAY[c.mobile] ||
               ARRAY(
                 SELECT contact->>'number'
                   FROM jsonb_array_elements(COALESCE(c.contacts, '[]'::jsonb)) AS contact
               )
             ) AS p
       WHERE p IS NOT NULL AND regexp_replace(p, '\D', '', 'g') <> ''
    ) AS phones
    FROM candidates c
   WHERE c.status = 'Qualified'
     AND c.qualification_kind = 'converted'
),
verdict AS (
  SELECT
    conv.id,
    (SELECT cl.id
       FROM clients cl
      WHERE cl.is_candidate = FALSE
        AND cl.id <> conv.converted_to_lead_id
        AND (
          regexp_replace(COALESCE(cl.mobile, ''), '\D', '', 'g') = ANY(conv.phones)
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(cl.contacts, '[]'::jsonb)) AS contact
             WHERE regexp_replace(COALESCE(contact->>'number', ''), '\D', '', 'g') = ANY(conv.phones)
          )
        )
      ORDER BY cl.id ASC
      LIMIT 1) AS client_match,
    (SELECT other.id
       FROM candidates other
      WHERE other.id <> conv.id
        AND (
          regexp_replace(COALESCE(other.mobile, ''), '\D', '', 'g') = ANY(conv.phones)
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements(COALESCE(other.contacts, '[]'::jsonb)) AS contact
             WHERE regexp_replace(COALESCE(contact->>'number', ''), '\D', '', 'g') = ANY(conv.phones)
          )
        )
      ORDER BY other.id ASC
      LIMIT 1) AS candidate_match
    FROM converted conv
)
UPDATE candidates c
   SET duplicate_flag = (v.client_match IS NOT NULL OR v.candidate_match IS NOT NULL),
       duplicate_type = CASE
         WHEN v.client_match IS NOT NULL AND v.candidate_match IS NOT NULL THEN 'Both'
         WHEN v.client_match IS NOT NULL THEN 'Client'
         WHEN v.candidate_match IS NOT NULL THEN 'Candidate'
         ELSE NULL
       END,
       duplicate_reference_id = COALESCE(v.client_match, v.candidate_match)
  FROM verdict v
 WHERE c.id = v.id;

-- ── 4. Recompute every sheet's counters ─────────────────────
-- Same formula as services/referralSheetStats.ts, applied to all sheets at once
-- so the historical percentages reflect the repaired flags.
WITH agg AS (
  SELECT
    referral_sheet_id AS sheet_id,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (
      WHERE duplicate_flag IS NOT TRUE
        AND COALESCE(status, '') <> 'Junk'
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

-- Sheets that lost every candidate must not keep stale counters.
UPDATE referral_sheets rs
   SET total_candidates = 0, quality_percentage = 0, conversion_percentage = 0
 WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.referral_sheet_id = rs.id);

CREATE INDEX IF NOT EXISTS idx_candidates_qualification_kind
  ON candidates (qualification_kind)
  WHERE qualification_kind IS NOT NULL;

ANALYZE candidates;
