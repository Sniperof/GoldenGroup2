-- ============================================================
-- 350_reporting_foundation.sql
-- ============================================================
-- أساس طبقة التقارير والمؤشرات (دستور reporting-analytics §6/§7).
-- يُنشئ:
--   1) metric_cache — كاش المؤشرات على الخادم (§7.2). يُخدم منه الـ widget
--      دون لمس جداول الحقيقة. التحديث محكوم بفترة الأدمن (dashboard_metric_refresh_hours)
--      أو يدويًا. مفتاح الكاش = (metric_key, scope_signature) حيث scope_signature
--      بصمة مُطبّعة من (النطاق + الفرع/الإسناد + المدى الزمني الخشِن).
--   2) user_dashboard_layouts — تخطيط الداشبورد لكل مستخدم (§6.3) كـ JSONB واحد.
--   3) الإعداد dashboard_metric_refresh_hours في system_settings (§7.3).
-- لا صلاحيات جديدة: المؤشرات تعيد استخدام صلاحيات عرض القوائم القائمة (§5 قرار 4).
-- ============================================================

BEGIN;

-- 1) كاش المؤشرات ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metric_cache (
  id              SERIAL PRIMARY KEY,
  metric_key      VARCHAR(80)  NOT NULL,
  scope_signature VARCHAR(220) NOT NULL,
  value           JSONB        NOT NULL,
  computed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  computed_by     INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_cache_key
  ON public.metric_cache (metric_key, scope_signature);
CREATE INDEX IF NOT EXISTS idx_metric_cache_computed_at
  ON public.metric_cache (computed_at);

-- 2) تخطيط الداشبورد لكل مستخدم --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_dashboard_layouts (
  user_id    INTEGER PRIMARY KEY REFERENCES public.hr_users(id) ON DELETE CASCADE,
  layout     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) فترة تحديث الكاش (بالساعات) — يضبطها الأدمن من واجهة الإعدادات ------------------
INSERT INTO public.system_settings (key, value, value_type, category, description, is_editable, updated_at)
VALUES (
  'dashboard_metric_refresh_hours', '6', 'integer', 'dashboard',
  'فترة (بالساعات) صلاحية كاش مؤشرات الداشبورد قبل إعادة الحساب من قاعدة البيانات (reporting-analytics §7.3)',
  TRUE, NOW()
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
