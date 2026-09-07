BEGIN;

ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS generation_metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.report_export_audit
  ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.report_runs.generation_metrics IS
  'Stage timings and batch statistics for the immutable tabular snapshot generation.';

COMMENT ON COLUMN public.report_export_audit.metrics IS
  'Snapshot read, workbook build, total export duration, and produced byte size.';

COMMIT;
