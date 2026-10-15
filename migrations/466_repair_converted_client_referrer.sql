-- Repair the primary mediator of clients created by CONVERTING a suggested
-- name (الأسماء المقترحة → زبون).
--
-- Until now the conversion let the browser rebuild `clients.referrers[0]` from
-- ClientModal form state instead of deriving it from the source candidate.
-- That path replaced a real `referral_name_snapshot` with the literal 'مجهول'
-- whenever the mediator type was `Unknown`, hard-coded `referralSheetId` and
-- `referralReason`, dropped the referral address, and never stamped
-- `sourceCandidateId` — so the network tab showed an anonymous mediator with no
-- link back to the suggested name it came from. The LINK path (link-client)
-- always built the same object server-side and was unaffected, which is why the
-- same client could show one broken row next to one complete row.
--
-- This backfill is pure enrichment: every field falls back to whatever the
-- client already had, so nothing that was present can be lost. No referrer row
-- is added or removed — element 0 is repaired in place.
--
-- Constitution: candidates.md BR-5 (قرار 2026-07-29) — the suggested name is
-- the server-side source of truth for the mediator's type, id, name snapshot,
-- channel, date and address.

BEGIN;

WITH conv AS (
  -- The suggested name that CREATED the client. One per client; the lowest id
  -- wins if historical data ever produced more than one.
  SELECT DISTINCT ON (k.converted_to_lead_id)
         k.converted_to_lead_id           AS client_id,
         k.id                             AS cand_id,
         k.referral_type,
         k.referral_origin_channel,
         k.referral_name_snapshot,
         k.referral_entity_id,
         k.referral_date,
         k.referral_reason,
         k.referral_sheet_id,
         k.address_text
    FROM candidates k
   WHERE k.qualification_kind = 'converted'
     AND k.converted_to_lead_id IS NOT NULL
   ORDER BY k.converted_to_lead_id, k.id
),
target AS (
  SELECT c.id                             AS client_id,
         conv.cand_id,
         conv.referral_type,
         conv.referral_origin_channel,
         conv.referral_name_snapshot,
         conv.referral_entity_id,
         conv.referral_date,
         conv.referral_reason,
         conv.referral_sheet_id,
         conv.address_text,
         c.referrers                      AS referrers,
         c.referrers -> 0                 AS old0
    FROM clients c
    JOIN conv ON conv.client_id = c.id
   WHERE jsonb_typeof(c.referrers) = 'array'
     AND jsonb_array_length(c.referrers) > 0
     -- Only entries produced by the broken path: a stamped element 0 is
     -- already authoritative and is left untouched.
     AND (c.referrers -> 0 ->> 'sourceCandidateId') IS NULL
     -- Never create a second row for a name already represented somewhere.
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(c.referrers) AS existing
            WHERE existing ->> 'sourceCandidateId' = conv.cand_id::text
         )
),
rebuilt AS (
  SELECT t.client_id,
         t.resolved_type,
         t.resolved_name,
         t.resolved_channel,
         t.resolved_address,
         t.resolved_entity_id,
         jsonb_build_object(
           'id',                  t.resolved_entity_id,
           'sourceCandidateId',   t.cand_id,
           'name',                t.resolved_name,
           'type',                t.resolved_type,
           'channel',             t.resolved_channel,
           'address',             t.resolved_address,
           'referrerType',        t.resolved_type,
           'referrerId',          NULL::int,
           'referralEntityId',    t.resolved_entity_id,
           'referrerName',        t.resolved_name,
           'sourceChannel',       t.resolved_channel,
           'referralDate',        t.resolved_date,
           'referralReason',      COALESCE(NULLIF(TRIM(t.referral_reason), ''), NULLIF(TRIM(t.old0 ->> 'referralReason'), '')),
           'referralSheetId',     COALESCE(t.referral_sheet_id, t.old_sheet_id),
           'referralAddressText', t.resolved_address
         ) AS item
    FROM (
      SELECT tt.*,
             COALESCE(NULLIF(TRIM(tt.referral_type), ''),          NULLIF(TRIM(tt.old0 ->> 'referrerType'), ''))                                     AS resolved_type,
             COALESCE(NULLIF(TRIM(tt.referral_name_snapshot), ''), NULLIF(TRIM(tt.old0 ->> 'referrerName'), ''))                                     AS resolved_name,
             COALESCE(NULLIF(TRIM(tt.referral_origin_channel), ''),NULLIF(TRIM(tt.old0 ->> 'sourceChannel'), ''))                                    AS resolved_channel,
             COALESCE(NULLIF(TRIM(tt.address_text), ''),           NULLIF(TRIM(tt.old0 ->> 'referralAddressText'), ''), NULLIF(TRIM(tt.old0 ->> 'address'), '')) AS resolved_address,
             COALESCE(NULLIF(TRIM(tt.referral_date), ''),          NULLIF(TRIM(tt.old0 ->> 'referralDate'), ''))                                     AS resolved_date,
             CASE
               WHEN tt.old0 ->> 'referralSheetId' ~ '^\d+$' THEN (tt.old0 ->> 'referralSheetId')::int
               ELSE NULL
             END                                                                                                                                     AS old_sheet_id,
             CASE
               WHEN COALESCE(NULLIF(TRIM(tt.referral_type), ''), NULLIF(TRIM(tt.old0 ->> 'referrerType'), '')) IN ('Client', 'Employee')
                 THEN COALESCE(
                        tt.referral_entity_id,
                        CASE WHEN tt.old0 ->> 'referralEntityId' ~ '^\d+$' THEN (tt.old0 ->> 'referralEntityId')::int ELSE NULL END
                      )
               ELSE NULL
             END                                                                                                                                     AS resolved_entity_id
        FROM target tt
    ) t
)
UPDATE clients c
   SET referrers             = jsonb_set(c.referrers, '{0}', r.item, false),
       -- Flat columns mirror element 0 (same derivation the link path uses).
       referrer_name         = r.item ->> 'referrerName',
       referrer_type         = r.item ->> 'referrerType',
       source_channel        = r.item ->> 'sourceChannel',
       referral_entity_id    = r.resolved_entity_id,
       referral_date         = r.item ->> 'referralDate',
       referral_reason       = r.item ->> 'referralReason',
       referral_sheet_id     = CASE
                                 WHEN r.item ->> 'referralSheetId' ~ '^\d+$' THEN (r.item ->> 'referralSheetId')::int
                                 ELSE NULL
                               END,
       referral_address_text = r.item ->> 'referralAddressText'
  FROM rebuilt r
 WHERE c.id = r.client_id;

COMMIT;
