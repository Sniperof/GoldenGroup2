BEGIN;

-- ============================================================
-- 458_temporary_contract_trial_model.sql
-- ============================================================
-- نموذج العقد المؤقت كتجربة (قرار 2026-09-13، غير مثبّت في الدستور بعد):
--   • عقد واحد يُعتمد فوراً بلا أثر مالي، الجهاز يُعامل معاملة المبيع تشغيلياً.
--   • عند الشراء: تسوية في المكان تقلب sale_subtype إلى definitive وتُجمّد
--     ملحق تثبيت البيعة الحامل للبنود المالية (الأصل يبقى ورقة التجربة).
--   • عند عدم الشراء: مهمة سحب بغرض trial_return، وبنجاح السحب يُلغى العقد
--     ويتحرّر الرقم التسلسلي لعقد آخر.
-- ============================================================

-- 1) تتبّع مصير التجربة ───────────────────────────────────────
-- قلب النوع الفرعي في المكان يمحو الدليل على أن العقد بدأ تجربةً، فنثبّته.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS started_as_temporary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS temporary_settled_at TIMESTAMPTZ;

UPDATE public.contracts
   SET started_as_temporary = TRUE
 WHERE sale_subtype = 'temporary'
   AND started_as_temporary = FALSE;

COMMENT ON COLUMN public.contracts.started_as_temporary IS
  'العقد بدأ كعقد تجربة (sale_subtype=temporary) بصرف النظر عن نوعه الحالي.';
COMMENT ON COLUMN public.contracts.temporary_settled_at IS
  'لحظة تسوية التجربة وتحوّلها إلى بيع قطعي؛ NULL يعني تجربة لم تُحسم.';

CREATE INDEX IF NOT EXISTS idx_contracts_started_as_temporary
  ON public.contracts (started_as_temporary)
  WHERE started_as_temporary = TRUE;

-- 2) غرض سحب جديد: إرجاع جهاز التجربة ────────────────────────
-- السحب القائم (maintenance / replacement) رحلة ذهاب وعودة؛ إرجاع التجربة
-- خروج نهائي من علاقة الزبون، فيلزمه غرض مستقل حتى لا تتلوّث التقارير.
ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_retrieval_purpose_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_retrieval_purpose_check
  CHECK (retrieval_purpose IS NULL
         OR retrieval_purpose IN ('maintenance', 'replacement', 'trial_return'));

ALTER TABLE public.visit_task_device_retrieval_results
  DROP CONSTRAINT IF EXISTS visit_task_device_retrieval_purpose_check;

ALTER TABLE public.visit_task_device_retrieval_results
  ADD CONSTRAINT visit_task_device_retrieval_purpose_check
  CHECK (retrieval_purpose IN ('maintenance', 'replacement', 'trial_return'));

-- سبب المهمة نفسه محكوم بقيد على open_tasks.reason، فنضيف قيمة إرجاع التجربة.
ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_reason_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'new_lead', 'follow_up', 'renewal', 'service_request', 'other',
    'device_demo', 'gift_delivery', 'sale_delivery', 'post_maintenance_return',
    'temporary_swap_delivery', 'replacement_delivery', 'manual_delivery',
    'golden_warranty_offer', 'golden_warranty_card_delivery',
    'contract_installment_due', 'maintenance_receivable_due',
    'golden_warranty_receivable_due', 'remaining_installment_balance',
    'rescheduled_collection', 'previous_task_cancelled', 'manager_followup',
    'data_correction', 'contract_cancelled', 'temporary_stop',
    'customer_request', 'technical_safety', 'replacement_preparation',
    'maintenance_preparation', 'device_checkup', 'manual_checkup',
    'device_retrieval_maintenance', 'device_retrieval_replacement',
    'device_retrieval_trial_return',
    'device_return_after_maintenance',
    'device_transfer_same_customer_new_address',
    'device_transfer_another_customer'
  ]::text[]));

-- سبب إنشاء مهمة السحب ضمن القوائم المُدارة (يتبع نمط القائمة القائمة:
-- القيمة عربية والسبب النظامي داخل metadata.systemReason).
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'device_retrieval_creation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('سحب جهاز تجربة لم تُحسم', 30,
   '{"label":"سحب جهاز تجربة لم تُحسم","systemReason":"device_retrieval_trial_return"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'device_retrieval_creation_reasons' AND sl.value = v.value
);

-- سبب إلغاء العقد المقابل (يُخزَّن نصّاً في contracts.cancellation_reason).
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'contract_cancellation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('trial_not_settled', 50, '{"label":"انتهت التجربة دون شراء وسُحب الجهاز"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'contract_cancellation_reasons' AND sl.value = v.value
);

-- 3) تحرير الرقم التسلسلي بعد خروج الجهاز نهائياً ─────────────
-- لا يوجد مستودع، فالجهاز المُرجَع يصبح رقمه متاحاً لعقد آخر. نُبقي الرقم
-- مكتوباً على السجل القديم (هو الخيط الوحيد الذي يربط تاريخ الجهاز عبر
-- العقود) ونستثني الحالات النهائية من قيد التفرّد بدل تفريغه.
DROP INDEX IF EXISTS public.uq_installed_devices_serial_normalized;

CREATE UNIQUE INDEX uq_installed_devices_serial_normalized
  ON public.installed_devices (lower(btrim(serial_number)))
  WHERE serial_number IS NOT NULL
    AND btrim(serial_number) <> ''
    AND status NOT IN ('retrieved', 'contract_cancelled');

-- 4) إصلاح بيانات: خصومات إلغاء بلا استحقاق يقابلها ───────────
-- إلغاء عقد مؤقت كان يكتب حركة discount بقيمة العقد كاملة، بينما العقد
-- المؤقت لا يُنتج حركة charge أصلاً (financialMovements يحصر التوليد في
-- definitive). النتيجة رصيد دائن وهمي للزبون بقيمة العقد.
-- السجل append-only بحكم trigger، والتصحيح المقرر فيه حركة عكسية لا حذف،
-- فنكتب استحقاقاً معاكساً موسوماً بـ reverses_id. الرصيد يعود صفراً ويبقى
-- الأثر مرئياً للتدقيق.
INSERT INTO public.financial_movements (
  client_id, occurred_at, kind, amount_syp, currency,
  source_type, source_id, source_ref_id, contract_id,
  description, occurred_branch_id, reverses_id, notes
)
SELECT m.client_id, m.occurred_at, 'charge', m.amount_syp, m.currency,
       'contract_correction', m.contract_id, m.id, m.contract_id,
       'تصحيح: إبطال خصم إلغاء عقد تجربة لم يقابله استحقاق',
       m.occurred_branch_id, m.id,
       'هجرة 458 — العقد المؤقت لا يولّد استحقاقاً، فخصم الإلغاء كان يتيماً.'
  FROM public.financial_movements m
 WHERE m.kind = 'discount'
   AND m.source_type = 'contract'
   AND m.contract_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.contracts c
      WHERE c.id = m.contract_id
        AND c.sale_subtype <> 'definitive'
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.financial_movements charge
      WHERE charge.contract_id = m.contract_id
        AND charge.kind = 'charge'
   )
ON CONFLICT (source_type, source_ref_id, kind)
  WHERE source_ref_id IS NOT NULL
  DO NOTHING;

COMMIT;
