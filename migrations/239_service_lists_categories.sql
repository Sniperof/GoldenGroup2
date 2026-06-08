-- ============================================================
-- 239_service_lists_categories.sql
-- ============================================================
-- Phase 0.1 — Seed 5 new system_lists categories for the
-- Service Requests + Diagnosed Problems lifecycle.
--
-- Categories created (admin-managed from /system-lists UI):
--   1. diagnosis_problem_types         — ٠.١٩ + P-MAINT-12
--   2. service_partial_reasons         — المحور 10 (partially_resolved)
--   3. service_unresolved_reasons      — المحور 10 (unresolved)
--   4. reopen_reasons                  — ٠.٤.ب (SR-REOPEN-03)
--   5. emergency_uniqueness_override_reasons — EM-UNIQ-04 (split path)
--
-- Seeding strategy (per device-demo precedent in migration 235):
--   - Only minimal seeds ("أخرى" + 1-2 essentials) so the admin owns
--     the curation from the /system-lists UI.
--   - ON CONFLICT guard on (category, value) to be idempotent —
--     no explicit IDs (sequence-driven to avoid PK collisions).
--
-- Reference: docs/constitution/features/tasks/maintenance.md §٠.١٩,
--            §٠.٤.ب, §EM-UNIQ-04, §المحور 10
-- ============================================================

BEGIN;

-- Guarantee a partial UNIQUE on (category, value) so the ON CONFLICT
-- below works deterministically. If the index already exists from a
-- prior migration, this is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS system_lists_category_value_unique
  ON public.system_lists (category, value);

-- 1) diagnosis_problem_types  (٠.١٩ — لائحة الأعطال)
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('diagnosis_problem_types', 'أخرى',                 true, 999, '{}'::jsonb),
  ('diagnosis_problem_types', 'تسرّب ماء',            true, 1,   '{}'::jsonb),
  ('diagnosis_problem_types', 'انخفاض ضغط',           true, 2,   '{}'::jsonb),
  ('diagnosis_problem_types', 'TDS مرتفع',             true, 3,   '{}'::jsonb),
  ('diagnosis_problem_types', 'عطل في المضخّة',       true, 4,   '{}'::jsonb),
  ('diagnosis_problem_types', 'عطل في المُمبرين',     true, 5,   '{}'::jsonb)
ON CONFLICT (category, value) DO NOTHING;

-- 2) service_partial_reasons  (المحور 10 — partially_resolved)
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('service_partial_reasons', 'أخرى',                          true, 999, '{}'::jsonb),
  ('service_partial_reasons', 'قطعة غير متوفّرة في المستودع',  true, 1,   '{}'::jsonb),
  ('service_partial_reasons', 'عطل ثانوي مكتشف يحتاج زيارة',   true, 2,   '{}'::jsonb)
ON CONFLICT (category, value) DO NOTHING;

-- 3) service_unresolved_reasons  (المحور 10 — unresolved)
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('service_unresolved_reasons', 'أخرى',                       true, 999, '{}'::jsonb),
  ('service_unresolved_reasons', 'يحتاج ورشة',                 true, 1,   '{}'::jsonb),
  ('service_unresolved_reasons', 'يحتاج تبديل جهاز',           true, 2,   '{}'::jsonb)
ON CONFLICT (category, value) DO NOTHING;

-- 4) reopen_reasons  (٠.٤.ب — SR-REOPEN-03)
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('reopen_reasons', 'أخرى',                                   true, 999, '{}'::jsonb),
  ('reopen_reasons', 'العطل تكرَّر بعد النصيحة الهاتفية',      true, 1,   '{}'::jsonb),
  ('reopen_reasons', 'الزبون عاد عن قرار الإلغاء',             true, 2,   '{}'::jsonb),
  ('reopen_reasons', 'تقييم الرفض تغيَّر',                     true, 3,   '{}'::jsonb)
ON CONFLICT (category, value) DO NOTHING;

-- 5) emergency_uniqueness_override_reasons  (EM-UNIQ-04 — split path)
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('emergency_uniqueness_override_reasons', 'أخرى',                                 true, 999, '{}'::jsonb),
  ('emergency_uniqueness_override_reasons', 'عطل مختلف يحتاج تخصّصاً آخر',          true, 1,   '{}'::jsonb),
  ('emergency_uniqueness_override_reasons', 'فترة زمنية مختلفة',                    true, 2,   '{}'::jsonb),
  ('emergency_uniqueness_override_reasons', 'معدّات مختلفة',                        true, 3,   '{}'::jsonb)
ON CONFLICT (category, value) DO NOTHING;

COMMIT;
