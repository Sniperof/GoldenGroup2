-- Fix: Recreate system_settings table cleanly
-- Baseline migration 001_initial_schema.sql was "adopted" but this table was never created.
-- Run this, then re-run: pnpm --filter @golden-crm/api migrate

BEGIN;

-- Drop existing objects to avoid conflicts
DROP TABLE IF EXISTS public.system_settings CASCADE;
DROP SEQUENCE IF EXISTS public.system_settings_id_seq CASCADE;

-- 1. Sequence
CREATE SEQUENCE public.system_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- 2. Table
CREATE TABLE public.system_settings (
    id integer NOT NULL,
    key character varying(100) NOT NULL,
    value text,
    value_type character varying(20) DEFAULT 'string'::character varying NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    description text,
    is_editable boolean DEFAULT true,
    updated_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_settings_value_type_check CHECK (((value_type)::text = ANY ((ARRAY['integer'::character varying, 'string'::character varying, 'boolean'::character varying, 'time'::character varying, 'date'::character varying, 'json'::character varying])::text[])))
);

-- 3. Link sequence
ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;

-- 4. Default for id
ALTER TABLE public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);

-- 5. Constraints
ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_key_key UNIQUE (key);

-- 6. Index
CREATE INDEX idx_system_settings_category ON public.system_settings USING btree (category);

-- 7. Foreign key
ALTER TABLE public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;

-- 8. Seed data (from 001_initial_schema.sql)
INSERT INTO public.system_settings (id, key, value, value_type, category, description, is_editable, updated_by, created_at, updated_at)
VALUES
  (1, 'default_cooldown_days', '7', 'integer', 'telemarketing', 'المدة الافتراضية لـ cooldown عند تفعيله تلقائياً بعد نتيجة not_interested (DEC-005 D29)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03'),
  (2, 'contact_target_cleanup_time', '22:00', 'time', 'telemarketing', 'وقت تشغيل CRON يومي لإغلاق contact_targets القديمة (DEC-005 D26)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03'),
  (3, 'attempt_alert_threshold', '5', 'integer', 'telemarketing', 'عتبة محاولات الاتصال التي تُطلق تنبيهاً للمشرف. لا إغلاق قسري (DEC-006 D37)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03'),
  (4, 'visit_undocumented_alert_hours_l1', '24', 'integer', 'visits', 'بعد كم ساعة من بدء/إنهاء الزيارة بدون توثيق يُرسل تنبيه للفني (DEC-006 D38 L1)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03'),
  (5, 'visit_undocumented_alert_hours_l2', '48', 'integer', 'visits', 'بعد كم ساعة يُرسل تنبيه للمشرف + يُمنع الفني من بدء زيارة جديدة (DEC-006 D38 L2)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03'),
  (6, 'visit_undocumented_alert_hours_l3', '72', 'integer', 'visits', 'بعد كم ساعة يُصعَد لمدير الفرع (DEC-006 D38 L3)', true, NULL, '2026-06-01 01:42:50.756743+03', '2026-06-01 01:42:50.756743+03')
ON CONFLICT (key) DO NOTHING;

-- 9. Set sequence value
SELECT pg_catalog.setval('public.system_settings_id_seq', 6, true);

COMMIT;

-- 10. Mark migration 246 as applied so it won't fail on re-run
INSERT INTO schema_migrations (filename) VALUES ('246_service_requests_system_settings.sql')
ON CONFLICT (filename) DO NOTHING;
