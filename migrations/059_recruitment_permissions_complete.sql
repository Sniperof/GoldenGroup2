-- ============================================================
-- Migration 059: Complete missing recruitment permissions
-- - Adds 30 missing permissions for vacancies, interviews,
--   training, and job applications
-- - Grants to SYSTEM_ADMIN (GLOBAL) + template roles (BRANCH)
-- ============================================================

-- -----------------------------------------------------------
-- 1. Vacancies permissions (5)
-- -----------------------------------------------------------
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('jobs.vacancies.view_list',     'jobs', 'vacancies', 'view_list',     'عرض الوظائف الشاغرة',      1, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.vacancies.view_detail',   'jobs', 'vacancies', 'view_detail',   'عرض تفاصيل وظيفة شاغرة', 2, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.vacancies.create',        'jobs', 'vacancies', 'create',        'إنشاء وظيفة شاغرة',       3, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.vacancies.edit',          'jobs', 'vacancies', 'edit',          'تعديل وظيفة شاغرة',       4, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.vacancies.change_status', 'jobs', 'vacancies', 'change_status', 'تغيير حالة وظيفة شاغرة',  5, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------
-- 2. Interviews permissions (6)
-- -----------------------------------------------------------
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('jobs.interviews.view_list',      'jobs', 'interviews', 'view_list',      'عرض المقابلات',          10, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.interviews.view_detail',    'jobs', 'interviews', 'view_detail',    'عرض تفاصيل مقابلة',      11, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.interviews.schedule',       'jobs', 'interviews', 'schedule',       'جدولة مقابلة',           12, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.interviews.edit',           'jobs', 'interviews', 'edit',           'تعديل مقابلة',           13, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.interviews.record_result',  'jobs', 'interviews', 'record_result',  'تسجيل نتيجة مقابلة',     14, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.interviews.view_eligible',  'jobs', 'interviews', 'view_eligible',  'عرض المرشحين المؤهلين',  15, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------
-- 3. Training permissions (9)
-- -----------------------------------------------------------
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('jobs.training.view_list',           'jobs', 'training', 'view_list',           'عرض الدورات التدريبية',        20, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.view_detail',         'jobs', 'training', 'view_detail',         'عرض تفاصيل دورة تدريبية',     21, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.create',              'jobs', 'training', 'create',              'إنشاء دورة تدريبية',           22, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.start',               'jobs', 'training', 'start',               'بدء دورة تدريبية',             23, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.record_attendance',   'jobs', 'training', 'record_attendance',   'تسجيل حضور دورة',              24, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.complete',            'jobs', 'training', 'complete',            'إنهاء دورة تدريبية',           25, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.record_result',       'jobs', 'training', 'record_result',       'تسجيل نتيجة متدرب',            26, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.add_trainees',        'jobs', 'training', 'add_trainees',        'إضافة متدربين لدورة',          27, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.training.view_eligible',       'jobs', 'training', 'view_eligible',       'عرض المرشحين المؤهلين للتدريب', 28, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------
-- 4. Job applications permissions (11)
-- -----------------------------------------------------------
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('jobs.applications.view_list',        'jobs', 'applications', 'view_list',        'عرض طلبات التوظيف',          30, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.create',           'jobs', 'applications', 'create',           'إنشاء طلب توظيف',            31, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.view_detail',      'jobs', 'applications', 'view_detail',      'عرض تفاصيل طلب توظيف',       32, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.change_stage',     'jobs', 'applications', 'change_stage',     'تغيير مرحلة طلب التوظيف',    33, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.hire',             'jobs', 'applications', 'hire',             'توظيف مرشح',                 34, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.record_decision',  'jobs', 'applications', 'record_decision',  'تسجيل قرار التوظيف',         35, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.escalate',         'jobs', 'applications', 'escalate',         'تصعيد طلب توظيف',            36, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.edit_notes',       'jobs', 'applications', 'edit_notes',       'تعديل ملاحظات طلب التوظيف',  37, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.archive',          'jobs', 'applications', 'archive',          'أرشفة طلب توظيف',            38, ARRAY['GLOBAL','BRANCH','ASSIGNED']),
  ('jobs.applications.view_audit_logs',  'jobs', 'applications', 'view_audit_logs',  'عرض سجل تدقيق طلب التوظيف',  39, ARRAY['GLOBAL','BRANCH','ASSIGNED'])
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------
-- 5. Grant to SYSTEM_ADMIN with GLOBAL scope
-- -----------------------------------------------------------
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'GLOBAL'
  FROM roles r
  JOIN permissions p ON p.key LIKE 'jobs.%'
 WHERE r.name = 'SYSTEM_ADMIN'
   AND r.is_template = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- -----------------------------------------------------------
-- 6. Grant to all template roles with BRANCH scope
-- -----------------------------------------------------------
INSERT INTO role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM roles r
  JOIN permissions p ON p.key LIKE 'jobs.%'
 WHERE r.is_template = TRUE
   AND r.name <> 'SYSTEM_ADMIN'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET scope_type = EXCLUDED.scope_type,
      updated_at = NOW();
