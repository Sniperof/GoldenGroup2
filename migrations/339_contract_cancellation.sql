-- ============================================================
-- 339_contract_cancellation.sql
-- ============================================================
-- أعمدة إلغاء العقد. الإلغاء عملية صريحة عبر POST /api/contracts/:id/cancel
-- (لا عبر PUT الذي يرفض تعديل غير المسوّدة). عند الإلغاء:
--   - status → cancelled (+ السبب/الوقت/المنفّذ).
--   - تُلغى مهام تسديد الذمم المفتوحة للعقد تلقائياً.
--   - يُبطَل المتبقّي مالياً في financial_movements (discount) فيصبح المستحق=0،
--     ويبقى المدفوع مسجّلاً (الاسترجاع النقدي حركة refund منفصلة عند حدوثه — DEC-CT-08).
-- ============================================================

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cancelled_by        INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL;

COMMIT;
