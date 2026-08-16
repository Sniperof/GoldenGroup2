-- 403_web_login_device_policy_setting.sql
--
-- "Which roles may use the staff web app from a phone or tablet."
--
-- The value is a comma-separated list of `roles.team_slot_type` values
-- (SUPERVISOR / TECHNICIAN / TRAINEE / TELEMARKETER). The criterion is the
-- role's team slot rather than its name so that a supervisor or technician role
-- created later inherits the rule with no code change.
--
-- SHIPPED EMPTY ON PURPOSE. Empty = the feature is off and nothing changes:
-- the middleware does not even classify the device. Turning it on is an
-- explicit admin act, taken after watching which roles really do use a phone.
--
-- OPERATIONS MUST KNOW BEFORE ENABLING: the policy has no exemption, not even
-- for the super admin. Once this value is non-empty, nobody can clear it from a
-- phone or tablet — the settings screen sits behind the same gate. The escape
-- hatches are any desktop browser, or:
--
--   UPDATE system_settings SET value = '' WHERE key = 'web_login_allowed_team_slots';
--
-- This is a discipline control, not a security boundary: "Request desktop site"
-- in any mobile browser bypasses it, by design and by acceptance.

BEGIN;

INSERT INTO system_settings (key, value, value_type, category, description, is_editable)
VALUES (
  'web_login_allowed_team_slots',
  '',
  'string',
  'security',
  'خانات الفريق المسموح لها بالدخول إلى نظام الويب من الهاتف أو الجهاز اللوحي، مفصولة بفواصل (مثال: SUPERVISOR,TECHNICIAN). القيمة الفارغة تعني عدم وجود أي تقييد. لا استثناء لأحد بما في ذلك مدير النظام.',
  TRUE
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
