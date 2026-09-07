BEGIN;

-- Supports BRANCH snapshots in their deterministic report order.
CREATE INDEX IF NOT EXISTS idx_candidates_branch_created_id
  ON public.candidates (branch_id, created_at DESC, id DESC);

-- Reverse lookups used while collecting gift state for candidate/name-list rows.
CREATE INDEX IF NOT EXISTS idx_gift_record_sources_candidate_record
  ON public.gift_record_sources (candidate_id, gift_record_id)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_record_sources_sheet_record
  ON public.gift_record_sources (referral_sheet_id, gift_record_id)
  WHERE referral_sheet_id IS NOT NULL;

ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.report_runs
   SET expires_at = COALESCE(expires_at, requested_at, generated_at, NOW()) + INTERVAL '30 days'
 WHERE expires_at IS NULL;

ALTER TABLE public.report_runs
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_runs_expired_cleanup
  ON public.report_runs (expires_at, id)
  WHERE is_pinned IS FALSE AND status IN ('completed','failed');

-- Keep the immutable export audit after its bulky snapshot expires.
ALTER TABLE public.report_export_audit
  DROP CONSTRAINT IF EXISTS report_export_audit_report_run_id_fkey;
ALTER TABLE public.report_export_audit
  ADD CONSTRAINT report_export_audit_report_run_id_fkey
  FOREIGN KEY (report_run_id) REFERENCES public.report_runs(id) ON DELETE SET NULL;

COMMIT;
