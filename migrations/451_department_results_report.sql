BEGIN;

-- ── 1) Report permissions ───────────────────────────────────────────────────
WITH source_permissions(key, module, sub_module, action, display_name, display_order, allowed_scopes) AS (
  VALUES
    ('reports.performance.department_results.view', 'reports', 'performance', 'view', 'عرض تقرير نتائج حسب القسم', 518, ARRAY['GLOBAL','BRANCH']::text[]),
    ('reports.performance.department_results.export', 'reports', 'performance', 'export', 'تصدير تقرير نتائج حسب القسم إلى Excel', 519, ARRAY['GLOBAL','BRANCH']::text[])
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

-- Conservative baseline: roles already allowed to view contract records get the
-- report at no broader scope. ASSIGNED grants are skipped (the row grain is a
-- department, so the report declares no ASSIGNED scope) and export is not granted.
WITH source_grants AS (
  SELECT grant_row.role_id, grant_row.scope_type
    FROM public.role_permission_grants grant_row
    JOIN public.permissions permission ON permission.id = grant_row.permission_id
   WHERE permission.key = 'contracts.view_list'
     AND grant_row.scope_type IN ('GLOBAL', 'BRANCH')
), report_permission AS (
  SELECT id FROM public.permissions WHERE key = 'reports.performance.department_results.view'
)
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grants.role_id, report_permission.id, source_grants.scope_type
  FROM source_grants CROSS JOIN report_permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── 2) Sale family and sale points on the device model ──────────────────────
-- The report carries six fixed family columns and a sales-points total, and the
-- schema had neither concept: device_models.category holds only Industrial/صناعي
-- (a different axis) and brand is empty for 40 of 58 models. The family is stored
-- as a CHECK-guarded code so a renamed model keeps its family, and the points are
-- stored per model so a future model can carry its own weight. Both are seeded by
-- the model-by-model mapping the user approved on 2026-09-02 — never by matching
-- the model name at query time.
ALTER TABLE public.device_models
  ADD COLUMN IF NOT EXISTS sale_family VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sale_points NUMERIC(4,2);

ALTER TABLE public.device_models
  DROP CONSTRAINT IF EXISTS device_models_sale_family_check;
ALTER TABLE public.device_models
  ADD CONSTRAINT device_models_sale_family_check
  CHECK (sale_family IS NULL OR sale_family IN
    ('challenger', 'aquanova', 'double_membrane', 'softener', 'station', 'safe_life', 'golden'));

ALTER TABLE public.device_models
  DROP CONSTRAINT IF EXISTS device_models_sale_points_check;
ALTER TABLE public.device_models
  ADD CONSTRAINT device_models_sale_points_check
  CHECK (sale_points IS NULL OR sale_points > 0);

COMMENT ON COLUMN public.device_models.sale_family IS
  'عائلة البيع لتقارير النتائج. تُسنَد إداريًا موديلًا موديلًا، ولا تُشتق من الاسم.';
COMMENT ON COLUMN public.device_models.sale_points IS
  'وزن نقاط البيعة. الموديل بلا وزن لا يدخل مجموع النقاط ولا يُحسب بواحد افتراضًا.';

-- The approved mapping (ids are stable): one point for challenger, aquanova,
-- softener and station; half a point for golden and safe life (two sales = one
-- point). Every other model stays unweighted and unfamilied on purpose, including
-- the GG*/G.RO/UV GRO devices the user explicitly excluded.
WITH mapping(model_id, family, points) AS (
  VALUES
    (1022, 'challenger', 1.00),   -- تشالنجر (غير نشط)
    (1195, 'challenger', 1.00),   -- Challenger
    (1198, 'challenger', 1.00),   -- Challenger + Alkaline
    (2396, 'challenger', 1.00),   -- تشالنجر هديةتركيب شهر
    (2414, 'challenger', 1.00),   -- تشالنجر زرعة
    (2463, 'challenger', 1.00),   -- فلتر تشالنجر مع الكالاين القوي الاول
    (2462, 'aquanova', 1.00),     -- اكوانوفا
    (1014, 'softener', 1.00),     -- Softener
    (2378, 'softener', 1.00),     -- سوفتنر صناعي 13 ليتر
    (1200, 'station', 1.00),      -- محطة تنقية
    (1256, 'station', 1.00),      -- محطة RO
    (2341, 'station', 1.00),      -- محطة RO (600 غالون)
    (2375, 'golden', 0.50),       -- غولدن غروب بدون اشعة
    (2376, 'golden', 0.50),       -- غولدن غروب مع اشعة
    (1300, 'safe_life', 0.50),    -- فلتر RO سيف لايف
    (1301, 'safe_life', 0.50)     -- سيف لايف + UV
)
UPDATE public.device_models model
   SET sale_family = mapping.family,
       sale_points = mapping.points
  FROM mapping
 WHERE model.id = mapping.model_id;

-- ── 3) Index for the one unindexed path this report walks ───────────────────
-- Scheduled and executed demo tasks are reached by task type inside a period; the
-- other paths are already served (idx_visit_tasks_field_visit, uq_visit_task_results_task,
-- idx_contracts_branch_contract_date, idx_visit_task_results_closed_at, idx_fm_contract).
CREATE INDEX IF NOT EXISTS idx_visit_tasks_type_visit
  ON public.visit_tasks (task_type, field_visit_id);

COMMIT;
