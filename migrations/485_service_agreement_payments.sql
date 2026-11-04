-- 485: service-agreement fee becomes real money (charge + payments in the unified ledger).
--
-- اتفاقية الخدمة (DEC-CT-02) كان لها حقل رسوم fee_syp فقط، بلا أي سجل دفع ولا حركة
-- مالية — فرسوم الاتفاقية لم تظهر في كشف حساب الزبون. القرار (2026-10-19):
--   * الرسوم = استحقاق عند تفعيل الاتفاقية (service_agreement)، والدفعات في جدول خاص
--     (service_agreement_payment)، وحذف الدفعة = حركة عكسية؛ الإلغاء يخصم المتبقي.
--   * الرسوم تغطي أجور الزيارات الدورية؛ القطع على الزبون.
--   * التجديد = اتفاقية جديدة؛ الرسوم تُقفل بعد التفعيل.
-- على نمط device_warranty_payments.

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_agreement_payments (
  id                      SERIAL PRIMARY KEY,
  agreement_id            INTEGER NOT NULL REFERENCES public.service_agreements(id) ON DELETE RESTRICT,
  method                  VARCHAR(30) NOT NULL,
  currency                VARCHAR(3)  NOT NULL DEFAULT 'SYP',
  amount_value            NUMERIC(14,2) NOT NULL,
  exchange_rate           NUMERIC(14,4),
  amount_syp              NUMERIC(14,2) NOT NULL,
  reference_number        VARCHAR(100),
  barter_name             TEXT,
  barter_value_syp        NUMERIC(14,2),
  transfer_company_id     INTEGER,
  received_by_employee_id INTEGER,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                   TEXT,
  entry_type              VARCHAR(20) NOT NULL DEFAULT 'collection',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_agreement_payments_method_check CHECK (method IN (
    'cash', 'sham_cash', 'syriatel_cash', 'mtn_cash', 'alharam', 'bank_transfer', 'barter', 'usd_cash')),
  CONSTRAINT service_agreement_payments_entry_type_check CHECK (entry_type IN ('collection', 'refund')),
  CONSTRAINT service_agreement_payments_amount_check CHECK (amount_value >= 0 AND amount_syp >= 0),
  CONSTRAINT service_agreement_payments_rate_check CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  CONSTRAINT service_agreement_payments_barter_check CHECK (barter_value_syp IS NULL OR barter_value_syp >= 0)
);

CREATE INDEX IF NOT EXISTS idx_service_agreement_payments_agreement
  ON public.service_agreement_payments (agreement_id);

-- When the agreement was activated (its charge date) and cancelled (its discount date).
ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

UPDATE public.service_agreements
   SET activated_at = COALESCE(activated_at, created_at)
 WHERE status IN ('active', 'completed', 'cancelled') AND activated_at IS NULL;

COMMIT;
