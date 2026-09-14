BEGIN;

WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.service.dues.view', 'reports', 'service', 'view', 'عرض تقرير الاستحقاقات', 516, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[]),
    ('reports.service.dues.export', 'reports', 'service', 'export', 'تصدير تقرير الاستحقاقات إلى Excel', 517, ARRAY['GLOBAL','BRANCH','ASSIGNED']::text[])
)
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
SELECT key, module, sub_module, action, display_name, display_order, allowed_scopes
FROM source_permissions
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;

-- Baseline العرض محافظ: من يملك عرض العقود يأخذ عرض التقرير بالنطاق نفسه.
-- التصدير مستقل ولا يمنح تلقائياً.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'contracts.view_list'
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.service.dues.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_contract_installments_due_confirmed
  ON public.contract_installments (due_date, contract_id, id)
  WHERE confirmed IS TRUE;

CREATE INDEX IF NOT EXISTS idx_contract_payment_entries_installment_received
  ON public.contract_payment_entries (installment_id, received_at DESC, id DESC)
  WHERE installment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_open_tasks_collection_installment_created
  ON public.open_tasks (installment_id, created_at DESC, id DESC)
  WHERE task_type = 'installment_collection' AND installment_id IS NOT NULL;

COMMIT;
