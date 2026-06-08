-- Migration 264: Add missing columns and tables to support current API features
-- These columns/tables are referenced in the code or Constitution but missing from staging DB.
-- Run: psql $DATABASE_URL -f migrations/264_add_missing_columns_and_tables.sql

-- ============================================================
-- 1. visit_tasks — CRITICAL: device_id (used by visitTaskResultReflection.ts)
-- ============================================================
ALTER TABLE public.visit_tasks
    ADD COLUMN IF NOT EXISTS device_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_visit_tasks_device_id
    ON public.visit_tasks(device_id)
    WHERE device_id IS NOT NULL;

-- Note: FK to installed_devices is optional — device_id may be set before device is installed.
-- If strict enforcement is needed later, add: FOREIGN KEY (device_id) REFERENCES installed_devices(id) ON DELETE SET NULL

-- result_snapshot — for future visit result serialization
ALTER TABLE public.visit_tasks
    ADD COLUMN IF NOT EXISTS result_snapshot JSONB;

-- ============================================================
-- 2. contracts — device_snapshot + source_visit_id (Constitution DEC-002/DEC-003)
-- ============================================================
ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS device_snapshot JSONB;

ALTER TABLE public.contracts
    ADD COLUMN IF NOT EXISTS source_visit_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_contracts_source_visit
    ON public.contracts(source_visit_id)
    WHERE source_visit_id IS NOT NULL;

-- Note: team_snapshot on contracts is offer_team_snapshot (already exists from migration 262)

-- ============================================================
-- 3. open_tasks — customer_snapshot + source_legacy_* (Constitution DEC-003/DEC-004)
-- ============================================================
ALTER TABLE public.open_tasks
    ADD COLUMN IF NOT EXISTS customer_snapshot JSONB;

ALTER TABLE public.open_tasks
    ADD COLUMN IF NOT EXISTS source_legacy_type VARCHAR(50);

ALTER TABLE public.open_tasks
    ADD COLUMN IF NOT EXISTS source_legacy_id VARCHAR(100);

-- ============================================================
-- 4. employees — has_car + max_visit_load (Constitution field-team scheduling)
-- ============================================================
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS has_car BOOLEAN DEFAULT FALSE;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS max_visit_load INTEGER;

-- ============================================================
-- 5. clients — committed (Constitution client-snapshot, not in initial schema)
-- ============================================================
-- Note: The Constitution references `clients.committed` but the actual code uses `clients.rating`.
-- If committed is needed as a separate column, uncomment below:
-- ALTER TABLE public.clients
--     ADD COLUMN IF NOT EXISTS committed VARCHAR(50);

-- ============================================================
-- 6. Tables — survey_skip_reasons is a system_lists category, not a table.
--    The other "missing" tables (contract_draft_devices, device_possession_transfers,
--    referral_sheet_names) are aspirational Constitution features not yet referenced in code.
--    They will be added when their respective features are implemented.
-- ============================================================

-- ============================================================
-- 7. Seed: ensure survey_skip_reasons category exists in system_lists
-- ============================================================
INSERT INTO public.system_lists (category, value, is_active, display_order)
VALUES ('survey_skip_reasons', 'أخرى', true, 99)
ON CONFLICT (category, value) DO NOTHING;

-- ============================================================
-- 8. Backfill: visit_tasks.device_id from open_tasks.device_id where linked
-- ============================================================
UPDATE public.visit_tasks vt
SET device_id = ot.device_id
FROM public.open_tasks ot
WHERE ot.id = vt.source_open_task_id
  AND vt.device_id IS NULL
  AND ot.device_id IS NOT NULL;

-- ============================================================
-- 9. Comments for documentation
-- ============================================================
COMMENT ON COLUMN public.visit_tasks.device_id IS 'FK → installed_devices(id) — the device this task operates on (DEC-003)';
COMMENT ON COLUMN public.visit_tasks.result_snapshot IS 'Frozen result snapshot for audit/history';
COMMENT ON COLUMN public.contracts.device_snapshot IS 'Frozen device snapshot at contract creation time';
COMMENT ON COLUMN public.contracts.source_visit_id IS 'The field_visit that originated this contract (DEC-002)';
COMMENT ON COLUMN public.open_tasks.customer_snapshot IS 'Frozen client snapshot at task creation (DEC-004 D12)';
COMMENT ON COLUMN public.open_tasks.source_legacy_type IS 'Legacy source type for backward compatibility';
COMMENT ON COLUMN public.open_tasks.source_legacy_id IS 'Legacy source ID for backward compatibility';
COMMENT ON COLUMN public.employees.has_car IS 'Does the employee have a company car for field visits?';
COMMENT ON COLUMN public.employees.max_visit_load IS 'Maximum daily visits this employee can handle';
