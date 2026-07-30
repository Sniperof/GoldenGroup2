-- ============================================================
-- 397_contract_cancel_device_effect.sql
-- ============================================================
-- الأثر الموحّد لإلغاء العقد على الجهاز والصيانة (خطة إلغاء العقد):
--   1) حالة جهاز نهائية جديدة `contract_cancelled` تُسقط الجهاز من كل
--      مسارات توليد/تسجيل الصيانة الدورية (كلها تحرس على status='active').
--      ليست `out_of_service` (تعني مفكوكاً ومؤهلاً للسحب/النقل) ولا
--      `retrieved` (تُطلق trigger استرجاع يُلغي الكفالة قسراً).
--   2) قائمة مُدارة لأسباب الإلغاء ضمن إدارة القوائم (قسم العقود)،
--      قيمتها تُخزَّن نصّاً في contracts.cancellation_reason القائم.
--   3) مواءمة trigger الكفالة: عند إلغاء العقد تُلغى كفالة العقد
--      **بلا شرط** (الإلغاء لا يُتاح إلا لعقد غير مستوفى، والجهاز يخرج
--      من الخدمة؛ فإبقاء كفالة "فعّالة" على جهاز ميت تناقض).
-- ============================================================

BEGIN;

-- 1) حالة الجهاز النهائية الجديدة ─────────────────────────────
ALTER TABLE public.installed_devices
  DROP CONSTRAINT IF EXISTS installed_devices_status_check;

ALTER TABLE public.installed_devices
  ADD CONSTRAINT installed_devices_status_check
  CHECK ((status)::text = ANY (ARRAY[
    'registered', 'pending_delivery', 'delivered', 'installed', 'active',
    'faulty', 'in_workshop', 'ready', 'out_of_service', 'retrieved',
    'contract_cancelled'
  ]::text[]));

-- 2) قائمة أسباب إلغاء العقد (system_lists) ───────────────────
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'contract_cancellation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('device_upgrade_replacement',        10, '{"label":"شراء جهاز جديد واستبدال القديم"}'),
  ('device_damaged',                    20, '{"label":"تلف الجهاز"}'),
  ('sold_to_third_party_untraceable',   30, '{"label":"بيع لطرف آخر تعذّر توثيق بياناته"}'),
  ('purchase_cancelled_within_grace',   40, '{"label":"إلغاء الشراء ضمن المهلة بموافقة الشركة"}'),
  ('other',                             99, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
  WHERE sl.category = 'contract_cancellation_reasons' AND sl.value = v.value
);

-- 3) مواءمة trigger الكفالة: إلغاء بلا شرط ────────────────────
CREATE OR REPLACE FUNCTION public.trg_warranty_on_contract_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    -- كفالة العقد لكل جهاز مرتبط بهذا العقد تُلغى بلا شرط.
    UPDATE device_warranties dw
       SET status              = 'cancelled',
           cancellation_reason = 'contract_cancelled',
           cancelled_at        = NOW()
     WHERE dw.device_id IN (SELECT id FROM installed_devices WHERE contract_id = NEW.id)
       AND dw.warranty_type = 'contract'
       AND dw.status IN ('pending', 'active');
  END IF;
  RETURN NULL;
END;
$function$;

COMMIT;
