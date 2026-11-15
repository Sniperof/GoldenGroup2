-- 493: USD-linked contract installments (2026-11-12)
--
-- Prices stay in SYP. Every installment schedule confirmed from now on is
-- linked to the US dollar at the central exchange rate in effect at the
-- moment of confirmation:
--   * contracts.usd_rate_snapshot        — SYP per 1 USD, taken at confirmation
--   * contract_installments.amount_usd   — round(amount_syp / snapshot, 2)
-- At collection the installment's remaining USD is converted with the rate of
-- the payment day (rounded to fx_collection_rounding_unit). The installment is
-- still settled at its ORIGINAL SYP; the gap between the cash collected and the
-- SYP credited is written to the per-branch branch_fx_differences ledger.
--
-- Legacy rows are untouched: NULL snapshot / NULL amount_usd = today's behaviour.
--
-- Decisions:
--   D1 exchange_rates is append-only. Several rows may share an effective date;
--      the latest one recorded wins (a same-day correction is a new row, so the
--      history keeps the mistake and its fix).
--   D2 branch_fx_differences.source_kind keeps the ledger generic so a later
--      stage (maintenance / warranty receivables) can write to it too.
--   D3 permission keys are defined only. NO role grants (granted manually).

BEGIN;

-- ── 1) Central exchange rate (SYP per 1 USD), append-only history ─────────
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id             BIGSERIAL PRIMARY KEY,
  rate           NUMERIC(14,4) NOT NULL CHECK (rate > 0),
  effective_from DATE NOT NULL,
  note           TEXT NULL,
  created_by     INTEGER NULL REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_effective
  ON public.exchange_rates (effective_from DESC, id DESC);

CREATE OR REPLACE FUNCTION public.fx_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% سجل غير قابل للتعديل أو الحذف (append-only).', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_exchange_rates_append_only ON public.exchange_rates;
CREATE TRIGGER trg_exchange_rates_append_only
  BEFORE UPDATE OR DELETE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.fx_append_only();

-- ── 2) Rounding unit for the SYP amount due at collection ──────────────────
INSERT INTO public.system_settings (key, value, value_type, category, description)
VALUES ('fx_collection_rounding_unit', '1000', 'integer', 'contracts',
        'وحدة تقريب المبلغ المستحق بالليرة عند تحصيل قسط مربوط بالدولار (لأقرب مضاعف)')
ON CONFLICT (key) DO NOTHING;

-- ── 3) Contract snapshot + installment USD amount ──────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS usd_rate_snapshot    NUMERIC(14,4) NULL,
  ADD COLUMN IF NOT EXISTS usd_rate_snapshot_at TIMESTAMPTZ NULL;

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_usd_rate_snapshot_ck;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_usd_rate_snapshot_ck
  CHECK (usd_rate_snapshot IS NULL OR usd_rate_snapshot > 0);

ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(14,2) NULL;

ALTER TABLE public.contract_installments
  DROP CONSTRAINT IF EXISTS contract_installments_amount_usd_ck;
ALTER TABLE public.contract_installments
  ADD CONSTRAINT contract_installments_amount_usd_ck
  CHECK (amount_usd IS NULL OR amount_usd >= 0);

-- ── 4) Payment entry: real cash, USD settled, day rate ─────────────────────
-- amount_syp stays the SYP CREDITED to the installment (original SYP), so the
-- balance recompute, statement and reports keep working unchanged.
ALTER TABLE public.contract_payment_entries
  ADD COLUMN IF NOT EXISTS collected_syp NUMERIC(14,2) NULL,
  ADD COLUMN IF NOT EXISTS usd_settled   NUMERIC(18,6) NULL,
  ADD COLUMN IF NOT EXISTS day_rate      NUMERIC(14,4) NULL;

ALTER TABLE public.contract_payment_entries
  DROP CONSTRAINT IF EXISTS contract_payment_entries_fx_ck;
ALTER TABLE public.contract_payment_entries
  ADD CONSTRAINT contract_payment_entries_fx_ck
  CHECK (
    (collected_syp IS NULL AND usd_settled IS NULL AND day_rate IS NULL)
    OR (collected_syp >= 0 AND usd_settled >= 0 AND day_rate > 0)
  );

-- Collector-side record of what was due that day (display / history only).
ALTER TABLE public.visit_task_installment_collection_results
  ADD COLUMN IF NOT EXISTS day_rate             NUMERIC(14,4) NULL,
  ADD COLUMN IF NOT EXISTS remaining_usd_before NUMERIC(18,6) NULL,
  ADD COLUMN IF NOT EXISTS due_today_syp        NUMERIC(14,2) NULL;

-- ── 5) Per-branch FX differences ledger (append-only) ──────────────────────
CREATE TABLE IF NOT EXISTS public.branch_fx_differences (
  id               BIGSERIAL PRIMARY KEY,
  branch_id        INTEGER NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  source_kind      VARCHAR(40) NOT NULL DEFAULT 'contract_installment',
  contract_id      INTEGER NULL REFERENCES public.contracts(id) ON DELETE SET NULL,
  installment_id   INTEGER NULL REFERENCES public.contract_installments(id) ON DELETE SET NULL,
  payment_entry_id INTEGER NULL REFERENCES public.contract_payment_entries(id) ON DELETE SET NULL,
  visit_task_result_id BIGINT NULL REFERENCES public.visit_task_results(id) ON DELETE SET NULL,
  contract_rate    NUMERIC(14,4) NOT NULL CHECK (contract_rate > 0),
  day_rate         NUMERIC(14,4) NOT NULL CHECK (day_rate > 0),
  usd_settled      NUMERIC(18,6) NOT NULL,
  collected_syp    NUMERIC(14,2) NOT NULL,
  settled_syp      NUMERIC(14,2) NOT NULL,
  difference_syp   NUMERIC(14,2) NOT NULL,           -- signed: collected − settled
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by      INTEGER NULL REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT branch_fx_differences_source_kind_ck
    CHECK (source_kind IN ('contract_installment'))
);

CREATE INDEX IF NOT EXISTS idx_branch_fx_differences_branch_date
  ON public.branch_fx_differences (branch_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_branch_fx_differences_contract
  ON public.branch_fx_differences (contract_id);

DROP TRIGGER IF EXISTS trg_branch_fx_differences_append_only ON public.branch_fx_differences;
CREATE TRIGGER trg_branch_fx_differences_append_only
  BEFORE UPDATE OR DELETE ON public.branch_fx_differences
  FOR EACH ROW EXECUTE FUNCTION public.fx_append_only();

-- ── 6) Permission keys (definitions only — no grants) ──────────────────────
INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('exchange_rates.view', 'settings', 'exchange_rates', 'view',
   'عرض سعر الصرف وسجله', 210, ARRAY['GLOBAL']),
  ('exchange_rates.manage', 'settings', 'exchange_rates', 'manage',
   'إدخال سعر صرف جديد', 211, ARRAY['GLOBAL']),
  ('fx_differences.view', 'settings', 'fx_differences', 'view',
   'عرض حساب فروقات سعر الصرف', 212, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

COMMIT;
