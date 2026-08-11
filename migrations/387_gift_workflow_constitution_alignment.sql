-- ============================================================
-- 387_gift_workflow_constitution_alignment.sql
-- ============================================================
-- Align the gifts runtime with the approved constitution:
--   * distinct beneficiary identities
--   * promised quantity separated from frozen approved quantity
--   * similar promises warn but never collide at DB level
--   * explicit many-record gift-delivery task membership
--   * auditable condition/approval/manual-delivery transitions
--   * dedicated pre-schedule cancellation reasons
--   * GLOBAL-only manual-delivery reopening capability
-- ============================================================

BEGIN;

ALTER TABLE public.gift_records
  ADD COLUMN IF NOT EXISTS promised_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS condition_verified_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS manual_delivery_method_id INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_delivery_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_delivery_branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL;

UPDATE public.gift_records
   SET promised_quantity = COALESCE(promised_quantity, approved_quantity, 1)
 WHERE promised_quantity IS NULL;

ALTER TABLE public.gift_records
  ALTER COLUMN promised_quantity SET NOT NULL,
  ALTER COLUMN approved_quantity DROP NOT NULL,
  ALTER COLUMN approved_quantity DROP DEFAULT;

UPDATE public.gift_records
   SET approved_quantity = NULL
 WHERE status = 'promised';

ALTER TABLE public.gift_records
  DROP CONSTRAINT IF EXISTS gift_records_quantity_positive_check,
  DROP CONSTRAINT IF EXISTS gift_records_promised_quantity_positive_check,
  DROP CONSTRAINT IF EXISTS gift_records_approved_quantity_positive_check,
  DROP CONSTRAINT IF EXISTS gift_records_approved_quantity_state_check,
  ADD CONSTRAINT gift_records_promised_quantity_positive_check
    CHECK (promised_quantity > 0),
  ADD CONSTRAINT gift_records_approved_quantity_positive_check
    CHECK (approved_quantity IS NULL OR approved_quantity > 0),
  ADD CONSTRAINT gift_records_approved_quantity_state_check
    CHECK (
      (status = 'promised' AND approved_quantity IS NULL)
      OR
      (status IN (
        'approved_for_delivery',
        'delivery_task_created',
        'delivered',
        'delivered_manually',
        'refused'
      ) AND approved_quantity IS NOT NULL)
      OR
      status = 'cancelled'
    );

UPDATE public.gift_records
   SET beneficiary_type = CASE
         WHEN beneficiary_employee_id IS NOT NULL THEN 'employee_referrer'
         ELSE 'personal_referrer'
       END
 WHERE beneficiary_type = 'employee_or_personal';

ALTER TABLE public.gift_records
  DROP CONSTRAINT IF EXISTS gift_records_beneficiary_type_check,
  DROP CONSTRAINT IF EXISTS gift_records_client_beneficiary_check,
  DROP CONSTRAINT IF EXISTS gift_records_referrer_customer_check,
  DROP CONSTRAINT IF EXISTS gift_records_beneficiary_identity_check,
  ADD CONSTRAINT gift_records_beneficiary_type_check
    CHECK (beneficiary_type IN (
      'contract_customer',
      'customer_referrer',
      'employee_referrer',
      'personal_referrer'
    )),
  ADD CONSTRAINT gift_records_beneficiary_identity_check
    CHECK (
      (beneficiary_type IN ('contract_customer', 'customer_referrer')
        AND beneficiary_client_id IS NOT NULL
        AND beneficiary_employee_id IS NULL)
      OR
      (beneficiary_type = 'employee_referrer'
        AND beneficiary_employee_id IS NOT NULL
        AND beneficiary_client_id IS NULL)
      OR
      (beneficiary_type = 'personal_referrer'
        AND beneficiary_client_id IS NULL
        AND beneficiary_employee_id IS NULL)
    );

DROP INDEX IF EXISTS public.uq_gift_records_open_promise;

CREATE TABLE IF NOT EXISTS public.gift_delivery_task_records (
  id                    BIGSERIAL PRIMARY KEY,
  open_task_id          INTEGER NOT NULL REFERENCES public.open_tasks(id) ON DELETE RESTRICT,
  gift_record_id        INTEGER NOT NULL REFERENCES public.gift_records(id) ON DELETE RESTRICT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  linked_by             INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  linked_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  detached_by           INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  detached_at           TIMESTAMP WITH TIME ZONE,
  detachment_reason     TEXT,
  CONSTRAINT gift_delivery_task_records_pair_unique
    UNIQUE (open_task_id, gift_record_id),
  CONSTRAINT gift_delivery_task_records_detachment_check
    CHECK (
      (is_active = TRUE AND detached_at IS NULL)
      OR
      (is_active = FALSE AND detached_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_delivery_task_records_active_record
  ON public.gift_delivery_task_records (gift_record_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_gift_delivery_task_records_task
  ON public.gift_delivery_task_records (open_task_id);

INSERT INTO public.gift_delivery_task_records (
  open_task_id,
  gift_record_id,
  is_active,
  linked_by,
  linked_at
)
SELECT gr.delivery_task_id,
       gr.id,
       TRUE,
       gr.updated_by,
       COALESCE(gr.updated_at, gr.created_at, NOW())
  FROM public.gift_records gr
 WHERE gr.delivery_task_id IS NOT NULL
ON CONFLICT (open_task_id, gift_record_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.gift_record_events (
  id                    BIGSERIAL PRIMARY KEY,
  gift_record_id        INTEGER NOT NULL REFERENCES public.gift_records(id) ON DELETE CASCADE,
  event_type            VARCHAR(80) NOT NULL,
  actor_user_id         INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  previous_status       VARCHAR(50),
  new_status            VARCHAR(50),
  reason                TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_record_events_record_created
  ON public.gift_record_events (gift_record_id, created_at DESC);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_promise_conditions', 'other', TRUE, 80,
       '{"label":"أخرى","requiresNotes":true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists
   WHERE category = 'gift_promise_conditions'
     AND value = 'other'
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_promise_conditions', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('name_list_referral_sale', 90, '{"label":"شراء زبون من لائحة الأسماء"}'),
  ('direct_referral_sale', 100, '{"label":"شراء الزبون المقترح مباشرة"}'),
  ('candidate_referral_sale', 110, '{"label":"شراء الاسم المقترح"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'gift_promise_conditions'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_manual_delivery_methods', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('company_pickup', 10, '{"label":"استلام في الشركة"}'),
  ('direct_handover', 20, '{"label":"تسليم مباشر"}'),
  ('contract_handover', 30, '{"label":"التسليم ضمن منفعة عقد"}'),
  ('other', 40, '{"label":"أخرى","requiresNotes":true}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'gift_manual_delivery_methods'
     AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_delivery_task_cancellation_reasons', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('delivery_cancelled', 10, '{"label":"إلغاء إجراء التسليم"}'),
  ('wrong_grouping', 20, '{"label":"تجميع غير صحيح"}'),
  ('duplicate_task', 30, '{"label":"مهمة مكررة"}'),
  ('data_correction', 40, '{"label":"تصحيح بيانات"}'),
  ('other', 50, '{"label":"أخرى"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.system_lists sl
   WHERE sl.category = 'gift_delivery_task_cancellation_reasons'
     AND sl.value = v.value
);

INSERT INTO public.permissions (
  key,
  module,
  sub_module,
  action,
  display_name,
  display_order,
  allowed_scopes
)
VALUES (
  'contract_gifts.reopen_manual_delivery',
  'contracts',
  'gifts',
  'reopen_manual_delivery',
  'إعادة فتح تسليم هدية يدوي',
  665,
  ARRAY['GLOBAL']::text[]
)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

WITH target_permission AS (
  SELECT id
    FROM public.permissions
   WHERE key = 'contract_gifts.reopen_manual_delivery'
),
source_roles AS (
  SELECT DISTINCT rpg.role_id
    FROM public.role_permission_grants rpg
    JOIN public.permissions p ON p.id = rpg.permission_id
   WHERE p.key = 'field_visits.reopen_closed'
     AND rpg.scope_type = 'GLOBAL'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sr.role_id, tp.id, 'GLOBAL'
  FROM source_roles sr
 CROSS JOIN target_permission tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = 'GLOBAL';

COMMIT;
