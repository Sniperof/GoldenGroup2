-- ============================================================
-- 362_gift_record_candidate_source.sql
-- ============================================================
-- Direct names entered through Candidates create a candidates row, not a
-- direct_suggestions row. Gift promises from that flow need a traceable source
-- so they can be stored in gift_records and shown in gift management/client tab.
-- ============================================================

BEGIN;

ALTER TABLE public.gift_record_sources
  ADD COLUMN IF NOT EXISTS candidate_id INTEGER REFERENCES public.candidates(id) ON DELETE RESTRICT;

ALTER TABLE public.gift_record_sources
  DROP CONSTRAINT IF EXISTS gift_record_sources_source_type_check;

ALTER TABLE public.gift_record_sources
  ADD CONSTRAINT gift_record_sources_source_type_check
  CHECK (source_type IN ('contract', 'name_list', 'direct_referral', 'candidate'));

ALTER TABLE public.gift_record_sources
  DROP CONSTRAINT IF EXISTS gift_record_sources_one_reference_check;

ALTER TABLE public.gift_record_sources
  ADD CONSTRAINT gift_record_sources_one_reference_check
  CHECK (
    (source_type = 'contract' AND contract_id IS NOT NULL)
    OR (source_type = 'name_list' AND referral_sheet_id IS NOT NULL)
    OR (source_type = 'direct_referral' AND direct_referral_id IS NOT NULL)
    OR (source_type = 'candidate' AND candidate_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_record_sources_candidate
  ON public.gift_record_sources (gift_record_id, candidate_id)
  WHERE source_type = 'candidate' AND candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_record_sources_candidate
  ON public.gift_record_sources (candidate_id);

COMMIT;
