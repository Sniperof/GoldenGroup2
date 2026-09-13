BEGIN;

-- ============================================================
-- 459_trial_contract_no_auto_completion.sql
-- ============================================================
-- عقد التجربة صار بقيمة صفر (هجرة 458)، فوقع في فرع الإكمال النقدي داخل
-- recompute_contract_completion: الشرط `مجموع الدفعات >= القيمة النهائية`
-- يتحقق بـ `0 >= 0`، فيُختم العقد `completed` لحظة اعتماده.
--
-- الأثر أن التجربة تولد مكتملة، فيتعذّر تثبيت بيعتها ويتعذّر سحب جهازها
-- (كلاهما يشترط `active`) — أي المأزق نفسه الذي وُجدت 458 لرفعه.
--
-- الإصلاح مقصور على `temporary`: العقد المجاني يُختم بصفر عن قصد (لا التزام
-- عليه أصلاً)، أما التجربة فقرارها لم يُتّخذ بعد ولا يجوز ختمها.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recompute_contract_completion(p_contract_id integer)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_status        VARCHAR(50);
  v_payment_type  VARCHAR(50);
  v_sale_subtype  VARCHAR(30);
  v_final_price   NUMERIC;
  v_total         INTEGER;
  v_paid          INTEGER;
  v_net_payments  NUMERIC;
BEGIN
  IF p_contract_id IS NULL THEN
    RETURN;
  END IF;

  SELECT status, payment_type, final_price, sale_subtype
    INTO v_status, v_payment_type, v_final_price, v_sale_subtype
    FROM public.contracts
   WHERE id = p_contract_id
   FOR UPDATE;

  -- Only auto-advance from active. Terminal and pre-approval states are stable.
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN;
  END IF;

  -- عقد التجربة ليس بيعاً مكتملاً بل بيع لم يُقرَّر بعد. يخرج من `active`
  -- بقرار صريح فقط: تثبيت البيعة، أو إلغاء بعد سحب الجهاز.
  IF v_sale_subtype = 'temporary' THEN
    RETURN;
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'paid')
    INTO v_total, v_paid
    FROM public.contract_installments
   WHERE contract_id = p_contract_id;

  IF v_total > 0 THEN
    IF v_total = v_paid THEN
      UPDATE public.contracts
         SET status = 'completed'
       WHERE id = p_contract_id
         AND status = 'active';
    END IF;
    RETURN;
  END IF;

  IF v_payment_type = 'cash' AND v_final_price IS NOT NULL THEN
    SELECT COALESCE(SUM(
             CASE
               WHEN entry_type = 'refund' THEN -amount_syp
               ELSE amount_syp
             END
           ), 0)
      INTO v_net_payments
      FROM public.contract_payment_entries
     WHERE contract_id = p_contract_id;

    IF v_net_payments >= v_final_price THEN
      UPDATE public.contracts
         SET status = 'completed'
       WHERE id = p_contract_id
         AND status = 'active';
    END IF;
  END IF;
END;
$function$;

-- إصلاح العقود المؤقتة التي خُتمت بهذا الخلل: تُعاد إلى `active` ما دامت
-- لم تُلغَ ولم تُسوَّ، وما دام جهازها لم يُسحب بعد.
UPDATE public.contracts c
   SET status = 'active'
 WHERE c.sale_subtype = 'temporary'
   AND c.status = 'completed'
   AND c.temporary_settled_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.installed_devices d
      WHERE d.contract_id = c.id
        AND d.status IN ('retrieved', 'contract_cancelled')
   );

COMMIT;
