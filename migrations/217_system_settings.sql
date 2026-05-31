-- ============================================================
-- Migration 217: Create system_settings table + seed Foundation keys
-- ============================================================
-- Constitution source:
--   DEC-005 D26 — default_cooldown_days + contact_target_cleanup_time
--   DEC-006 D37 — attempt_alert_threshold
--   DEC-006 D38 — visit_undocumented_alert_hours_l1/l2/l3
--   plans/2026-05-31-execution-plan.md §DB-01
--
-- Anti-duplication note:
--   Confirmed via grep that no `system_settings` table exists in any prior
--   migration. Safe to create.
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id              SERIAL PRIMARY KEY,
  key             VARCHAR(150) NOT NULL UNIQUE,
  value           TEXT         NOT NULL,
  value_type      VARCHAR(20)  NOT NULL
                    CHECK (value_type IN ('integer','string','boolean','time','date','json')),
  category        VARCHAR(50),
  description     TEXT,
  is_editable     BOOLEAN DEFAULT TRUE,
  updated_by      INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);

-- ============================================================
-- Seed: 6 keys mandated by DEC-005 + DEC-006 with constitution defaults
-- ============================================================

INSERT INTO system_settings (key, value, value_type, category, description) VALUES
  -- DEC-005 D29: cooldown auto-activation duration (days)
  ('default_cooldown_days',
   '7',
   'integer',
   'telemarketing',
   'المدة الافتراضية لـ cooldown عند تفعيله تلقائياً بعد نتيجة not_interested (DEC-005 D29)'),

  -- DEC-005 D26: daily CRON cleanup time for stale contact_targets
  ('contact_target_cleanup_time',
   '22:00',
   'time',
   'telemarketing',
   'وقت تشغيل CRON يومي لإغلاق contact_targets القديمة (DEC-005 D26)'),

  -- DEC-006 D37: supervisor alert threshold for call attempts (no forced close)
  ('attempt_alert_threshold',
   '5',
   'integer',
   'telemarketing',
   'عتبة محاولات الاتصال التي تُطلق تنبيهاً للمشرف. لا إغلاق قسري (DEC-006 D37)'),

  -- DEC-006 D38: three-tier escalation for undocumented visits
  ('visit_undocumented_alert_hours_l1',
   '24',
   'integer',
   'visits',
   'بعد كم ساعة من بدء/إنهاء الزيارة بدون توثيق يُرسل تنبيه للفني (DEC-006 D38 L1)'),

  ('visit_undocumented_alert_hours_l2',
   '48',
   'integer',
   'visits',
   'بعد كم ساعة يُرسل تنبيه للمشرف + يُمنع الفني من بدء زيارة جديدة (DEC-006 D38 L2)'),

  ('visit_undocumented_alert_hours_l3',
   '72',
   'integer',
   'visits',
   'بعد كم ساعة يُصعَّد لمدير الفرع (DEC-006 D38 L3)')
ON CONFLICT (key) DO NOTHING;
