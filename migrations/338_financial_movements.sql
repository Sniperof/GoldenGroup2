-- ============================================================
-- 338_financial_movements.sql
-- ============================================================
-- سجل الحركات المالية الموحّد (append-only) — مصدر حقيقة واحد عابر للمصادر
-- لكشف حساب الزبون. يحلّ محلّ النسخة المُجسّدة client_ledger_entries
-- (التي ستُسقَط في مرحلة لاحقة) ويعالج:
--   - الطرح المزدوج للدفعة الأولى (مجموع الاستحقاقات = قيمة العقد).
--   - تسرّب عقود المسوّدة (نُدخل فقط active/completed).
--   - تشتّت أموال المهام (طارئة/دورية/تركيب/كفالة) — تُكتب لاحقاً عبر نقاط
--     الكتابة في المرحلة 2 + ترحيلها التاريخي حينها.
--
-- القاعدة: kind ∈ charge|payment|refund|discount، amount_syp موجب دائماً،
-- والرصيد = Σ(charge+refund) − Σ(payment+discount). لا triggers مزامنة،
-- ولا إعادة حساب رصيد؛ مجرّد سجل أحداث يُقرأ مباشرةً.
--
-- نطاق هذه المرحلة (1): الجدول + الفهارس + حارس append-only + backfill
-- لمصادر العقد الموثوقة فقط. مؤجّل بوضوح:
--   * عقود cancelled  — تحتاج قاعدة استرجاع/إبطال (refund/discount) محسومة.
--   * جزر المهام      — emergency_result_costs / installation JSON /
--                       golden_warranty_* — تُرحَّل عند ربط نقاط الكتابة.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_movements (
  id                 SERIAL PRIMARY KEY,
  client_id          INTEGER NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  occurred_at        TIMESTAMP WITH TIME ZONE NOT NULL,     -- متى حصل الحدث (due_date / received_at)
  kind               VARCHAR(20) NOT NULL,                  -- charge | payment | refund | discount
  amount_syp         NUMERIC(14,2) NOT NULL,                -- موجب دائماً؛ الإشارة من kind
  currency           VARCHAR(10) NOT NULL DEFAULT 'SYP',
  amount_original    NUMERIC(14,2),                         -- القيمة بالعملة الأصلية (provenance)
  exchange_rate      NUMERIC,
  source_type        VARCHAR(40) NOT NULL,                  -- contract | contract_installment | contract_payment | emergency_maintenance | periodic_maintenance | installation | golden_warranty | opening_balance
  source_id          INTEGER,                               -- معرّف المصدر للتنقّل (عقد/مهمة/طلب)
  source_ref_id      INTEGER,                               -- الصف الدقيق المُنتِج (payment_entry/installment/costs)
  contract_id        INTEGER REFERENCES public.contracts(id) ON DELETE SET NULL,
  description        TEXT NOT NULL,
  reference_no       VARCHAR(100),
  occurred_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  recorded_by        INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  reverses_id        INTEGER REFERENCES public.financial_movements(id) ON DELETE SET NULL, -- التصحيح بحركة عكسية لا بالتعديل
  notes              TEXT,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_movements_kind_check
    CHECK (kind IN ('charge', 'payment', 'refund', 'discount')),
  CONSTRAINT financial_movements_amount_positive_check
    CHECK (amount_syp > 0)
);

CREATE INDEX IF NOT EXISTS idx_fm_client_date
  ON public.financial_movements (client_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_fm_contract
  ON public.financial_movements (contract_id);
CREATE INDEX IF NOT EXISTS idx_fm_source
  ON public.financial_movements (source_type, source_id);

-- منع تكرار الحركة عند إعادة حفظ النتيجة / إعادة تشغيل الترحيل (idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fm_source_ref
  ON public.financial_movements (source_type, source_ref_id, kind)
  WHERE source_ref_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Backfill (1/3): استحقاق العقد عند التوقيع = قيمة العقد − مجموع الأقساط.
--   * لعقود الكاش يساوي كامل القيمة؛ لعقود التقسيط يساوي المقدّم.
--   * بهذا يصبح مجموع الاستحقاقات (التوقيع + الأقساط) = قيمة العقد بالضبط،
--     فتُطرح الدفعة الأولى مرّة واحدة فقط.
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, source_type, source_id,
  source_ref_id, contract_id, description, occurred_branch_id
)
SELECT c.customer_id,
       c.created_at,
       'charge',
       (c.final_price - COALESCE(inst.sum_amt, 0))::numeric(14,2),
       'contract',
       c.id,
       c.id,
       c.id,
       'استحقاق العقد ' || COALESCE(c.contract_number, c.id::text) || ' عند التوقيع',
       c.branch_id
FROM public.contracts c
LEFT JOIN (
  SELECT contract_id, SUM(amount_syp) AS sum_amt
  FROM public.contract_installments
  GROUP BY contract_id
) inst ON inst.contract_id = c.id
WHERE c.customer_id IS NOT NULL
  AND c.status IN ('active', 'completed')
  AND c.sale_subtype = 'definitive'
  AND (c.final_price - COALESCE(inst.sum_amt, 0)) > 0
ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
DO NOTHING;

-- Backfill (2/3): استحقاق كل قسط بتاريخ أجله (charge).
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, source_type, source_id,
  source_ref_id, contract_id, description, occurred_branch_id
)
SELECT c.customer_id,
       i.due_date::timestamptz,
       'charge',
       i.amount_syp::numeric(14,2),
       'contract_installment',
       c.id,
       i.id,
       c.id,
       'استحقاق قسط رقم ' || i.installment_number || ' للعقد ' || COALESCE(c.contract_number, c.id::text),
       c.branch_id
FROM public.contract_installments i
JOIN public.contracts c ON c.id = i.contract_id
WHERE c.customer_id IS NOT NULL
  AND c.status IN ('active', 'completed')
  AND c.sale_subtype = 'definitive'
  AND i.amount_syp > 0
ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
DO NOTHING;

-- Backfill (3/3): الدفعات الفعلية (payment) والمرتجعات (refund).
--   كل دفعة (بما فيها المقدّم والتحصيل) حركة واحدة → لا طرح مزدوج.
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, currency, amount_original, exchange_rate,
  source_type, source_id, source_ref_id, contract_id, description, reference_no, occurred_branch_id
)
SELECT c.customer_id,
       p.received_at,
       CASE WHEN p.entry_type = 'refund' THEN 'refund' ELSE 'payment' END,
       p.amount_syp::numeric(14,2),
       p.currency,
       p.amount_value::numeric(14,2),
       p.exchange_rate,
       'contract_payment',
       c.id,
       p.id,
       c.id,
       CASE WHEN p.entry_type = 'refund'
            THEN 'مبلغ مرتجع للعقد ' || COALESCE(c.contract_number, c.id::text)
            ELSE 'دفعة عقد ' || COALESCE(c.contract_number, c.id::text) END,
       p.reference_number,
       c.branch_id
FROM public.contract_payment_entries p
JOIN public.contracts c ON c.id = p.contract_id
WHERE c.customer_id IS NOT NULL
  AND c.status IN ('active', 'completed')
  AND c.sale_subtype = 'definitive'
  AND p.amount_syp > 0
ON CONFLICT (source_type, source_ref_id, kind) WHERE source_ref_id IS NOT NULL
DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- حارس append-only: يمنع UPDATE/DELETE. التصحيح يكون بحركة عكسية
-- (INSERT بـ kind معاكس و reverses_id يشير للأصل). الـ INSERT مسموح.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.financial_movements_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial_movements سجل غير قابل للتعديل (append-only) — صحّح بحركة عكسية.';
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_movements_append_only ON public.financial_movements;
CREATE TRIGGER trg_financial_movements_append_only
  BEFORE UPDATE OR DELETE ON public.financial_movements
  FOR EACH ROW EXECUTE FUNCTION public.financial_movements_append_only();

COMMIT;
