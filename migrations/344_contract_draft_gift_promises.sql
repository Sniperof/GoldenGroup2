-- ============================================================
-- 344_contract_draft_gift_promises.sql
-- ============================================================
-- وعود الهدايا المُدخَلة أثناء إنشاء العقد تُحفظ كمسودة على العقد، ولا تُنشأ
-- كـ gift_records إلا عند اعتماد العقد (POST /contracts/:id/approve) — تماماً
-- كما draft_device_payload يُطبَّق عند الاعتماد. هذا يطابق قرار المستخدم:
-- لا يُنشأ الوعد للعقد المسودة، بل عند الاعتماد فقط.
-- ============================================================

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS draft_gift_promises jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
