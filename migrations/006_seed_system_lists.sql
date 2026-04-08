-- ============================================================
-- Migration 006: Seed system_lists (production-safe)
--
-- WHY this seed belongs in production:
--   These are not demo/mock data — they are the canonical lookup
--   values the application UI depends on at runtime:
--   job titles, education levels, academic majors, application
--   sources, and foreign languages. Without them, dropdowns in
--   the recruitment module are empty.
--
-- ON CONFLICT DO NOTHING makes every INSERT fully idempotent.
-- The UNIQUE constraint (category, value) was added in 005.
-- ============================================================

INSERT INTO system_lists (category, value, display_order) VALUES
  -- Job titles
  ('job_title', 'مشرفة',              1),
  ('job_title', 'فني',                2),
  ('job_title', 'تيلماركتر',          3),
  ('job_title', 'فني صيانة أجهزة',    4),
  ('job_title', 'مندوب مبيعات',       5),
  ('job_title', 'فني تركيب',          6),
  ('job_title', 'مسؤول خدمة العملاء', 7),
  ('job_title', 'محاسب',              8),
  -- Education levels (certificates)
  ('certificate', 'ابتدائية',   1),
  ('certificate', 'متوسطة',    2),
  ('certificate', 'إعدادية',   3),
  ('certificate', 'دبلوم',     4),
  ('certificate', 'بكالوريوس', 5),
  ('certificate', 'ماجستير',   6),
  ('certificate', 'دكتوراه',   7),
  -- Academic majors per certificate level
  ('major:دبلوم',     'تقنيات حاسبات',   1),
  ('major:دبلوم',     'إدارة أعمال',     2),
  ('major:دبلوم',     'محاسبة',          3),
  ('major:بكالوريوس', 'هندسة حاسبات',   1),
  ('major:بكالوريوس', 'هندسة كهرباء',   2),
  ('major:بكالوريوس', 'إدارة أعمال',    3),
  ('major:بكالوريوس', 'محاسبة',         4),
  ('major:ماجستير',   'هندسة حاسبات',   1),
  ('major:ماجستير',   'إدارة أعمال',    2),
  ('major:دكتوراه',   'هندسة حاسبات',   1),
  -- Application sources
  ('application_source', 'إنترنت (Website)', 1),
  ('application_source', 'تسجيل داخلي',     2),
  ('application_source', 'نماذج ورقية',     3),
  ('application_source', 'صفحة فيسبوك',     4),
  -- Foreign languages
  ('foreign_language', 'الإنجليزية', 1),
  ('foreign_language', 'الفرنسية',   2),
  ('foreign_language', 'الكردية',    3),
  ('foreign_language', 'التركية',    4),
  ('foreign_language', 'الألمانية',  5)
ON CONFLICT (category, value) DO NOTHING;
