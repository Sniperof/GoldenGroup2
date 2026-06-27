-- ============================================================
-- 322_gifts_foundation.sql
-- ============================================================
-- Foundation for gift tracking:
--   - gift_definitions
--   - gift_records
--   - gift_record_sources
--   - gift_delivery result side table
--   - contract_gifts.* permissions and baseline grants
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.gift_definitions (
  id                                  SERIAL PRIMARY KEY,
  name                                VARCHAR(255) NOT NULL UNIQUE,
  description                         TEXT,
  kind                                VARCHAR(50) NOT NULL DEFAULT 'standard_gift',
  default_unit_label                  VARCHAR(100) NOT NULL DEFAULT 'هدية',
  is_active                           BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_acknowledgement_required   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by                          INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  updated_by                          INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at                          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT gift_definitions_kind_check
    CHECK (kind IN ('standard_gift', 'gift_contract')),
  CONSTRAINT gift_definitions_ack_required_check
    CHECK (delivery_acknowledgement_required = TRUE)
);

CREATE TABLE IF NOT EXISTS public.gift_records (
  id                         SERIAL PRIMARY KEY,
  gift_definition_id          INTEGER NOT NULL REFERENCES public.gift_definitions(id) ON DELETE RESTRICT,
  beneficiary_type            VARCHAR(50) NOT NULL,
  beneficiary_client_id       INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
  beneficiary_employee_id     INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
  beneficiary_name_snapshot   VARCHAR(255) NOT NULL,
  customer_id                 INTEGER REFERENCES public.clients(id) ON DELETE SET NULL,
  contract_id                 INTEGER REFERENCES public.contracts(id) ON DELETE SET NULL,
  condition_id                INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  condition_label             VARCHAR(255) NOT NULL,
  condition_status            VARCHAR(50) NOT NULL DEFAULT 'pending',
  status                      VARCHAR(50) NOT NULL DEFAULT 'promised',
  approved_quantity           INTEGER NOT NULL DEFAULT 1,
  source_branch_id            INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  responsible_branch_id       INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  assigned_user_id            INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  delivery_task_id            INTEGER REFERENCES public.open_tasks(id) ON DELETE SET NULL,
  manual_delivered_at         TIMESTAMP WITH TIME ZONE,
  manual_delivered_by         INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  manual_delivery_notes       TEXT,
  cancellation_reason         TEXT,
  created_by                  INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  updated_by                  INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT gift_records_beneficiary_type_check
    CHECK (beneficiary_type IN ('contract_customer', 'customer_referrer', 'employee_or_personal')),
  CONSTRAINT gift_records_condition_status_check
    CHECK (condition_status IN ('pending', 'met', 'not_met')),
  CONSTRAINT gift_records_status_check
    CHECK (status IN (
      'promised',
      'approved_for_delivery',
      'delivery_task_created',
      'delivered',
      'delivered_manually',
      'cancelled',
      'refused'
    )),
  CONSTRAINT gift_records_quantity_positive_check
    CHECK (approved_quantity > 0),
  CONSTRAINT gift_records_client_beneficiary_check
    CHECK (
      beneficiary_type <> 'contract_customer'
      OR beneficiary_client_id IS NOT NULL
    ),
  CONSTRAINT gift_records_referrer_customer_check
    CHECK (
      beneficiary_type <> 'customer_referrer'
      OR beneficiary_client_id IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS public.gift_record_sources (
  id                   SERIAL PRIMARY KEY,
  gift_record_id        INTEGER NOT NULL REFERENCES public.gift_records(id) ON DELETE CASCADE,
  source_type           VARCHAR(50) NOT NULL,
  contract_id           INTEGER REFERENCES public.contracts(id) ON DELETE SET NULL,
  referral_sheet_id     INTEGER REFERENCES public.referral_sheets(id) ON DELETE SET NULL,
  direct_referral_id    INTEGER REFERENCES public.direct_suggestions(id) ON DELETE SET NULL,
  source_label          VARCHAR(255) NOT NULL,
  quantity              INTEGER NOT NULL DEFAULT 1,
  notes                 TEXT,
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT gift_record_sources_source_type_check
    CHECK (source_type IN ('contract', 'name_list', 'direct_referral')),
  CONSTRAINT gift_record_sources_quantity_positive_check
    CHECK (quantity > 0),
  CONSTRAINT gift_record_sources_one_reference_check
    CHECK (
      (source_type = 'contract' AND contract_id IS NOT NULL)
      OR (source_type = 'name_list' AND referral_sheet_id IS NOT NULL)
      OR (source_type = 'direct_referral' AND direct_referral_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_record_sources_contract
  ON public.gift_record_sources (gift_record_id, contract_id)
  WHERE source_type = 'contract' AND contract_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_record_sources_name_list
  ON public.gift_record_sources (gift_record_id, referral_sheet_id)
  WHERE source_type = 'name_list' AND referral_sheet_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_record_sources_direct_referral
  ON public.gift_record_sources (gift_record_id, direct_referral_id)
  WHERE source_type = 'direct_referral' AND direct_referral_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_records_definition ON public.gift_records (gift_definition_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_beneficiary_client ON public.gift_records (beneficiary_client_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_beneficiary_employee ON public.gift_records (beneficiary_employee_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_contract ON public.gift_records (contract_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_condition_id ON public.gift_records (condition_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_status ON public.gift_records (status);
CREATE INDEX IF NOT EXISTS idx_gift_records_condition_status ON public.gift_records (condition_status);
CREATE INDEX IF NOT EXISTS idx_gift_records_source_branch ON public.gift_records (source_branch_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_responsible_branch ON public.gift_records (responsible_branch_id);
CREATE INDEX IF NOT EXISTS idx_gift_records_assigned_user ON public.gift_records (assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_gift_record_sources_record ON public.gift_record_sources (gift_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_records_open_promise
  ON public.gift_records (
    gift_definition_id,
    beneficiary_type,
    COALESCE(beneficiary_client_id, 0),
    COALESCE(beneficiary_employee_id, 0),
    COALESCE(condition_id, 0)
  )
  WHERE status = 'promised';

INSERT INTO public.gift_definitions (
  name, description, kind, default_unit_label, is_active, delivery_acknowledgement_required
)
SELECT v.name, v.description, v.kind, v.default_unit_label, TRUE, TRUE
FROM (VALUES
  (
    'عقد هدية / تمليك بلا مقابل',
    'تعريف خاص للعقود التي يكون saleSubtype فيها free. لا يجوز حذفه حذفاً صلباً.',
    'gift_contract',
    'عقد'
  ),
  (
    'هدية عامة',
    'تعريف عام للهدايا التي لا تحتاج مخزوناً أو مستلزمات تسليم خاصة.',
    'standard_gift',
    'هدية'
  )
) AS v(name, description, kind, default_unit_label)
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    kind = EXCLUDED.kind,
    default_unit_label = EXCLUDED.default_unit_label,
    delivery_acknowledgement_required = TRUE,
    updated_at = NOW();

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_promise_conditions', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('contract_referrer_gift', 1),
  ('cash_contract', 2),
  ('after_second_installment', 3),
  ('multiple_contracts', 4),
  ('administrative_commitment', 5),
  ('branch_manager_decision', 6),
  ('gift_contract', 7)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
  WHERE sl.category = 'gift_promise_conditions'
    AND sl.value = v.value
);

CREATE TABLE IF NOT EXISTS public.visit_task_gift_delivery_results (
  id                         SERIAL PRIMARY KEY,
  visit_task_result_id        INTEGER NOT NULL REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  gift_record_id              INTEGER NOT NULL REFERENCES public.gift_records(id) ON DELETE RESTRICT,
  gift_definition_id          INTEGER NOT NULL REFERENCES public.gift_definitions(id) ON DELETE RESTRICT,
  approved_quantity_snapshot  INTEGER NOT NULL,
  unit_label_snapshot         VARCHAR(100) NOT NULL,
  final_decision              VARCHAR(100) NOT NULL,
  customer_acknowledged       BOOLEAN NOT NULL DEFAULT FALSE,
  refusal_reason_id           INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  reschedule_reason_id        INTEGER REFERENCES public.system_lists(id) ON DELETE SET NULL,
  rescheduled_date            DATE,
  notes                       TEXT,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT visit_task_gift_delivery_decision_check
    CHECK (final_decision IN ('delivered_successfully', 'refused_gift', 'rescheduled')),
  CONSTRAINT visit_task_gift_delivery_quantity_check
    CHECK (approved_quantity_snapshot > 0),
  CONSTRAINT visit_task_gift_delivery_success_ack_check
    CHECK (final_decision <> 'delivered_successfully' OR customer_acknowledged = TRUE),
  CONSTRAINT visit_task_gift_delivery_refusal_reason_check
    CHECK (final_decision <> 'refused_gift' OR refusal_reason_id IS NOT NULL),
  CONSTRAINT visit_task_gift_delivery_reschedule_reason_check
    CHECK (final_decision <> 'rescheduled' OR (reschedule_reason_id IS NOT NULL AND rescheduled_date IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_task_gift_delivery_result_record
  ON public.visit_task_gift_delivery_results (visit_task_result_id, gift_record_id);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_delivery_refusal_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('customer_refused', 1),
  ('beneficiary_unavailable', 2),
  ('wrong_beneficiary', 3),
  ('other', 4)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
  WHERE sl.category = 'gift_delivery_refusal_reasons'
    AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'gift_delivery_reschedule_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('beneficiary_requested', 1),
  ('not_at_location', 2),
  ('needs_coordination', 3),
  ('other', 4)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
  WHERE sl.category = 'gift_delivery_reschedule_reasons'
    AND sl.value = v.value
);

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('contract_gifts.view', 'contracts', 'gifts', 'view',
      'عرض سجلات الهدايا', 610, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('contract_gifts.manage', 'contracts', 'gifts', 'manage',
      'إنشاء وتعديل وعود الهدايا', 620, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('contract_gifts.verify_condition', 'contracts', 'gifts', 'verify_condition',
      'تحديث تحقق شرط الهدية', 630, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('contract_gifts.approve_delivery', 'contracts', 'gifts', 'approve_delivery',
      'اعتماد الهدية للتسليم', 640, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('contract_gifts.create_delivery_task', 'contracts', 'gifts', 'create_delivery_task',
      'إنشاء مهمة تسليم هدية', 650, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('contract_gifts.manual_delivery', 'contracts', 'gifts', 'manual_delivery',
      'تأكيد تسليم هدية يدوياً', 660, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
    ('contract_gifts.cancel', 'contracts', 'gifts', 'cancel',
      'إلغاء سجل هدية', 670, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

WITH view_permission AS (
  SELECT id FROM public.permissions WHERE key = 'contract_gifts.view'
),
source_grants AS (
  SELECT rpg.role_id,
         CASE
           WHEN BOOL_OR(rpg.scope_type = 'GLOBAL') THEN 'GLOBAL'
           WHEN BOOL_OR(rpg.scope_type = 'BRANCH') THEN 'BRANCH'
           ELSE 'ASSIGNED'
         END AS scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'contracts.view_list'
  GROUP BY rpg.role_id
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, vp.id, sg.scope_type
FROM source_grants sg CROSS JOIN view_permission vp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

WITH target_permissions AS (
  SELECT id FROM public.permissions
  WHERE key IN (
    'contract_gifts.manage',
    'contract_gifts.verify_condition',
    'contract_gifts.approve_delivery',
    'contract_gifts.manual_delivery',
    'contract_gifts.cancel'
  )
),
source_grants AS (
  SELECT rpg.role_id,
         CASE
           WHEN BOOL_OR(rpg.scope_type = 'GLOBAL') THEN 'GLOBAL'
           WHEN BOOL_OR(rpg.scope_type = 'BRANCH') THEN 'BRANCH'
           ELSE 'ASSIGNED'
         END AS scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key = 'contracts.edit'
  GROUP BY rpg.role_id
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.id, sg.scope_type
FROM source_grants sg CROSS JOIN target_permissions tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

WITH target_permission AS (
  SELECT id FROM public.permissions WHERE key = 'contract_gifts.create_delivery_task'
),
source_grants AS (
  SELECT rpg.role_id,
         CASE
           WHEN BOOL_OR(rpg.scope_type = 'GLOBAL') THEN 'GLOBAL'
           WHEN BOOL_OR(rpg.scope_type = 'BRANCH') THEN 'BRANCH'
           ELSE 'ASSIGNED'
         END AS scope_type
  FROM public.role_permission_grants rpg
  JOIN public.permissions p ON p.id = rpg.permission_id
  WHERE p.key IN ('contracts.close', 'contracts.edit')
  GROUP BY rpg.role_id
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT sg.role_id, tp.id, sg.scope_type
FROM source_grants sg CROSS JOIN target_permission tp
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = CASE
  WHEN role_permission_grants.scope_type = 'GLOBAL' OR EXCLUDED.scope_type = 'GLOBAL' THEN 'GLOBAL'
  WHEN role_permission_grants.scope_type = 'BRANCH' OR EXCLUDED.scope_type = 'BRANCH' THEN 'BRANCH'
  ELSE 'ASSIGNED'
END;

COMMIT;
