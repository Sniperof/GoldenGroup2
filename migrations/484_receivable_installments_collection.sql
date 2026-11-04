-- 484: maintenance + golden-warranty installments become collectable receivables.
--
-- قبل هذا: مهمة التحصيل مربوطة إجبارياً بقسط عقد (contract_installments)، ونوع
-- الذمة «صيانة/كفالة» مجرد تسمية. أقساط الصيانة كانت تُكتب في جدول dues لا يقرؤه
-- أحد، وأقساط الكفالة بلا رصيد يتحدّث. هنا البنية فقط (المرحلة ١ من الخطة):
--   * رصيد لكل قسط صيانة (مدفوع/متبقٍ/حالة/مؤكَّد).
--   * ربط دفعة الصيانة/الكفالة بقسطها.
--   * مهمة التحصيل ونتيجتها تشير إلى قسط من أحد الأنواع الثلاثة (واحد فقط).
--   * دالة إعادة حساب الرصيد لكل نوع، على نمط recompute_installment_balance.

BEGIN;

-- ── أقساط الصيانة: رصيد + تأكيد ─────────────────────────────────────────────
ALTER TABLE public.emergency_installments
  ADD COLUMN IF NOT EXISTS paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS confirmed         BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.emergency_installments
   SET remaining_balance = COALESCE(remaining_balance, amount_syp),
       confirmed = confirmed OR due_id IS NOT NULL;

-- ── ربط الدفعة بقسطها ────────────────────────────────────────────────────────
ALTER TABLE public.emergency_payment_entries
  ADD COLUMN IF NOT EXISTS installment_id INTEGER
    REFERENCES public.emergency_installments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_emergency_payment_entries_installment
  ON public.emergency_payment_entries (installment_id) WHERE installment_id IS NOT NULL;

ALTER TABLE public.device_warranty_payments
  ADD COLUMN IF NOT EXISTS installment_id INTEGER
    REFERENCES public.device_warranty_installments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_device_warranty_payments_installment
  ON public.device_warranty_payments (installment_id) WHERE installment_id IS NOT NULL;

-- ── مهمة التحصيل: قسط من نوع واحد فقط ───────────────────────────────────────
ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS maintenance_installment_id INTEGER
    REFERENCES public.emergency_installments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warranty_installment_id INTEGER
    REFERENCES public.device_warranty_installments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_open_tasks_maintenance_installment
  ON public.open_tasks (maintenance_installment_id) WHERE maintenance_installment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_open_tasks_warranty_installment
  ON public.open_tasks (warranty_installment_id) WHERE warranty_installment_id IS NOT NULL;
ALTER TABLE public.open_tasks DROP CONSTRAINT IF EXISTS chk_open_tasks_one_installment;
ALTER TABLE public.open_tasks ADD CONSTRAINT chk_open_tasks_one_installment CHECK (
  (installment_id IS NOT NULL)::int
  + (maintenance_installment_id IS NOT NULL)::int
  + (warranty_installment_id IS NOT NULL)::int <= 1
);

ALTER TABLE public.visit_task_installment_collection_results
  ALTER COLUMN installment_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS maintenance_installment_id INTEGER
    REFERENCES public.emergency_installments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS warranty_installment_id INTEGER
    REFERENCES public.device_warranty_installments(id) ON DELETE RESTRICT;
ALTER TABLE public.visit_task_installment_collection_results
  DROP CONSTRAINT IF EXISTS chk_vticr_one_installment;
ALTER TABLE public.visit_task_installment_collection_results ADD CONSTRAINT chk_vticr_one_installment CHECK (
  (installment_id IS NOT NULL)::int
  + (maintenance_installment_id IS NOT NULL)::int
  + (warranty_installment_id IS NOT NULL)::int = 1
);

-- ── إعادة حساب الرصيد ───────────────────────────────────────────────────────
-- المدفوع = مجموع دفعات القسط (المرتجع يُطرح)؛ نفس قاعدة الحالة لأقساط العقد.
CREATE OR REPLACE FUNCTION public.recompute_maintenance_installment_balance(p_installment_id integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_amount NUMERIC; v_due DATE; v_paid NUMERIC; v_remaining NUMERIC;
BEGIN
  IF p_installment_id IS NULL THEN RETURN; END IF;
  SELECT amount_syp, due_date INTO v_amount, v_due
    FROM public.emergency_installments WHERE id = p_installment_id;
  IF v_amount IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount_syp), 0) INTO v_paid
    FROM public.emergency_payment_entries WHERE installment_id = p_installment_id;
  v_remaining := GREATEST(v_amount - v_paid, 0);
  UPDATE public.emergency_installments
     SET paid_amount = v_paid,
         remaining_balance = v_remaining,
         status = CASE
           WHEN v_remaining <= 0                    THEN 'paid'
           WHEN v_paid > 0                          THEN 'partial'
           WHEN v_due < CURRENT_DATE                THEN 'overdue'
           ELSE 'pending' END
   WHERE id = p_installment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_warranty_installment_balance(p_installment_id integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_amount NUMERIC; v_due DATE; v_paid NUMERIC; v_remaining NUMERIC;
BEGIN
  IF p_installment_id IS NULL THEN RETURN; END IF;
  SELECT amount_syp, due_date INTO v_amount, v_due
    FROM public.device_warranty_installments WHERE id = p_installment_id;
  IF v_amount IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END), 0) INTO v_paid
    FROM public.device_warranty_payments WHERE installment_id = p_installment_id;
  v_remaining := GREATEST(v_amount - v_paid, 0);
  UPDATE public.device_warranty_installments
     SET paid_amount = v_paid,
         remaining_balance = v_remaining,
         status = CASE
           WHEN v_remaining <= 0                    THEN 'paid'
           WHEN v_paid > 0                          THEN 'partial'
           WHEN v_due < CURRENT_DATE                THEN 'overdue'
           ELSE 'pending' END
   WHERE id = p_installment_id;
END;
$$;

COMMIT;
