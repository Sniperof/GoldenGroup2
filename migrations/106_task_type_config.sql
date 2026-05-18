-- 106_task_type_config.sql
-- Creates task_type_config table with seed data for all 20 task types.
-- Implements G04/T06 (gap closure) and supports RA-R001 / RA-G001 (planning window N).
--
-- See docs/analysis/task-scheduling-patterns.md for full design rationale.

BEGIN;

CREATE TABLE IF NOT EXISTS task_type_config (
  task_type             VARCHAR(50)  PRIMARY KEY,
  task_family           VARCHAR(50)  NOT NULL,
  arabic_label          VARCHAR(255) NOT NULL,

  -- Scheduling behavior (see task-scheduling-patterns.md §3)
  scheduling_pattern    VARCHAR(30)  NOT NULL,
  window_basis          VARCHAR(20)  NOT NULL,
  planning_window_days  INTEGER,

  -- Operational constraints
  contract_required     BOOLEAN      NOT NULL DEFAULT TRUE,
  allow_multiple        BOOLEAN      NOT NULL DEFAULT FALSE,
  has_due_date          BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Presentation
  display_order         INTEGER      NOT NULL,
  is_active             BOOLEAN      NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT task_type_config_pattern_check
    CHECK (scheduling_pattern IN ('immediate', 'short_window', 'long_window', 'expected_window')),

  CONSTRAINT task_type_config_basis_check
    CHECK (window_basis IN ('none', 'due_date', 'expected_date')),

  CONSTRAINT task_type_config_window_consistency_check
    CHECK (
      (scheduling_pattern = 'immediate' AND window_basis = 'none' AND planning_window_days IS NULL)
      OR (scheduling_pattern = 'short_window' AND window_basis = 'due_date' AND planning_window_days IS NOT NULL)
      OR (scheduling_pattern = 'long_window' AND window_basis = 'due_date' AND planning_window_days IS NOT NULL)
      OR (scheduling_pattern = 'expected_window' AND window_basis = 'expected_date' AND planning_window_days IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS task_type_config_active_idx
  ON task_type_config (is_active, display_order);

-- Seed: 20 canonical task types (see task-scheduling-patterns.md §6)
INSERT INTO task_type_config (
  task_type, task_family, arabic_label,
  scheduling_pattern, window_basis, planning_window_days,
  contract_required, allow_multiple, has_due_date,
  display_order
) VALUES
  ('device_demo',             'marketing',   'عرض جهاز',                  'expected_window', 'expected_date', 7,    FALSE, FALSE, FALSE,  1),
  ('device_purchase',         'sales',       'شراء جهاز (توقيع عقد)',     'immediate',       'none',          NULL, TRUE,  FALSE, FALSE,  2),
  ('device_delivery',         'delivery',    'تسليم الجهاز',              'short_window',    'due_date',      3,    TRUE,  FALSE, TRUE,   3),
  ('device_installation',     'delivery',    'تركيب الجهاز',              'short_window',    'due_date',      3,    TRUE,  FALSE, TRUE,   4),
  ('device_activation',       'delivery',    'تشغيل الجهاز',              'short_window',    'due_date',      3,    TRUE,  FALSE, TRUE,   5),
  ('periodic_maintenance',    'maintenance', 'الصيانة الدورية',           'long_window',     'due_date',      30,   TRUE,  TRUE,  TRUE,   6),
  ('emergency_maintenance',   'emergency',   'الصيانة الطارئة',           'immediate',       'none',          NULL, TRUE,  TRUE,  FALSE,  7),
  ('installment_collection',  'collection',  'تحصيل قسط جهاز',            'long_window',     'due_date',      15,   TRUE,  TRUE,  TRUE,   8),
  ('maintenance_collection',  'collection',  'تحصيل ذمة صيانة',           'long_window',     'due_date',      15,   TRUE,  TRUE,  TRUE,   9),
  ('gift_delivery',           'delivery',    'تسليم هدية',                'short_window',    'due_date',      7,    FALSE, TRUE,  TRUE,   10),
  ('device_checkup',          'marketing',   'تشييك على الجهاز',          'long_window',     'due_date',      30,   TRUE,  FALSE, TRUE,   11),
  ('parts_sale',              'service',     'شراء قطعة دون تبديل',       'immediate',       'none',          NULL, TRUE,  TRUE,  FALSE,  12),
  ('device_retrieval',        'service',     'سحب الجهاز للشركة',         'immediate',       'none',          NULL, TRUE,  TRUE,  FALSE,  13),
  ('device_repair',           'service',     'فحص وإصلاح بالشركة',        'immediate',       'none',          NULL, TRUE,  TRUE,  FALSE,  14),
  ('device_return',           'service',     'إعادة الجهاز بعد الصيانة',  'short_window',    'due_date',      3,    TRUE,  TRUE,  TRUE,   15),
  ('golden_warranty',         'warranty',    'منح كفالة ذهبية',           'immediate',       'none',          NULL, TRUE,  FALSE, FALSE,  16),
  ('warranty_cancellation',   'warranty',    'إلغاء الكفالة الأساسية',    'immediate',       'none',          NULL, TRUE,  FALSE, FALSE,  17),
  ('warranty_reactivation',   'warranty',    'إعادة تفعيل الكفالة',       'immediate',       'none',          NULL, TRUE,  FALSE, FALSE,  18),
  ('device_disconnection',    'service',     'توقيف الجهاز مؤقتاً',       'immediate',       'none',          NULL, TRUE,  FALSE, FALSE,  19),
  ('device_transfer',         'service',     'نقل الجهاز لعنوان جديد',    'immediate',       'none',          NULL, TRUE,  FALSE, FALSE,  20)
ON CONFLICT (task_type) DO NOTHING;

-- Register admin permissions for managing task type configuration
INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('admin.task_types.view',   'admin', 'task_types', 'view',   'عرض إعدادات أنواع المهام',   210),
  ('admin.task_types.manage', 'admin', 'task_types', 'manage', 'إدارة إعدادات أنواع المهام', 211)
ON CONFLICT (key) DO NOTHING;

COMMIT;

