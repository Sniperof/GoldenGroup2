BEGIN;

-- ── Seed Arabic mojibake repair ────────────────────────────────────────────
-- 001_initial_schema.sql (a pg_dump) stored some Arabic seed text as UTF-8
-- bytes misread as Windows-1256, so a fresh install shows e.g. 'ظ…ط¯ظٹط±'
-- instead of 'مدير النظام' and the `major:<qualification>` system lists never
-- match the clean keys the UI builds. Until now this was fixed by hand with
-- scripts/fix-mojibake.sql; this migration makes every install come out clean.
--
-- Scope: the seed tables a full scan of every text/json column on a fresh
-- database found affected (system_lists, emergency_action_types, roles,
-- permissions, system_settings, task_type_config), plus geo_units and branches
-- which the manual script also covered.
--
-- Recovery: convert_from(convert_to(x, 'WIN1256'), 'UTF8'). A value is changed
-- only when it holds a character outside ASCII + the Arabic block AND that
-- round trip succeeds AND changes it. Real Arabic text never decodes as valid
-- UTF-8 this way, so clean rows (and legitimate punctuation such as — « »)
-- are left untouched, and the migration is a no-op on an already-fixed DB.
--
-- Unique collisions: when the repaired value already exists as a clean row
-- (a later migration re-seeded it, e.g. survey_skip_reasons 'أخرى'), the
-- garbled system_lists row is deactivated instead of deleted, since stored
-- answers may still reference it; a colliding geo_units row is left as is.

CREATE FUNCTION pg_temp.try_demojibake(s TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF s IS NULL OR s !~ U&'[^\0001-\007f\0600-\06ff]' THEN RETURN s; END IF;
  RETURN convert_from(convert_to(s, 'WIN1256'), 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN s;
END;
$$;

CREATE FUNCTION pg_temp.is_mojibake(s TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NOT NULL
     AND s ~ U&'[^\0001-\007f\0600-\06ff]'
     AND pg_temp.try_demojibake(s) IS DISTINCT FROM s;
$$;

-- ── 1) Tables with no unique constraint on the repaired columns ───────────
UPDATE public.emergency_action_types
   SET arabic_label = pg_temp.try_demojibake(arabic_label)
 WHERE pg_temp.is_mojibake(arabic_label);

UPDATE public.permissions
   SET display_name = pg_temp.try_demojibake(display_name)
 WHERE pg_temp.is_mojibake(display_name);

UPDATE public.system_settings
   SET description = pg_temp.try_demojibake(description)
 WHERE pg_temp.is_mojibake(description);

UPDATE public.task_type_config
   SET arabic_label = pg_temp.try_demojibake(arabic_label)
 WHERE pg_temp.is_mojibake(arabic_label);

UPDATE public.roles
   SET display_name     = pg_temp.try_demojibake(display_name),
       description      = pg_temp.try_demojibake(description),
       protected_reason = pg_temp.try_demojibake(protected_reason)
 WHERE pg_temp.is_mojibake(display_name)
    OR pg_temp.is_mojibake(description)
    OR pg_temp.is_mojibake(protected_reason);

UPDATE public.branches
   SET name             = pg_temp.try_demojibake(name),
       detailed_address = pg_temp.try_demojibake(detailed_address)
 WHERE pg_temp.is_mojibake(name)
    OR pg_temp.is_mojibake(detailed_address);

-- ── 2) system_lists — UNIQUE (category, value) ─────────────────────────────
DO $$
DECLARE
  r RECORD;
  fixed_count INT := 0;
  retired_count INT := 0;
BEGIN
  FOR r IN
    SELECT id, category, value
      FROM public.system_lists
     WHERE pg_temp.is_mojibake(category) OR pg_temp.is_mojibake(value)
     ORDER BY id
  LOOP
    BEGIN
      UPDATE public.system_lists
         SET category = pg_temp.try_demojibake(r.category),
             value    = pg_temp.try_demojibake(r.value)
       WHERE id = r.id;
      fixed_count := fixed_count + 1;
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.system_lists SET is_active = FALSE WHERE id = r.id;
      RAISE NOTICE 'system_lists id=% deactivated: clean duplicate (%, %) already exists',
        r.id, pg_temp.try_demojibake(r.category), pg_temp.try_demojibake(r.value);
      retired_count := retired_count + 1;
    END;
  END LOOP;
  RAISE NOTICE 'system_lists: repaired=%, deactivated duplicates=%', fixed_count, retired_count;
END $$;

-- ── 3) geo_units — UNIQUE (lower(name), level, parent) ────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, name FROM public.geo_units WHERE pg_temp.is_mojibake(name) ORDER BY id
  LOOP
    BEGIN
      UPDATE public.geo_units SET name = pg_temp.try_demojibake(r.name) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'geo_units id=% left unchanged: clean duplicate "%" already exists',
        r.id, pg_temp.try_demojibake(r.name);
    END;
  END LOOP;
END $$;

DROP FUNCTION pg_temp.is_mojibake(TEXT);
DROP FUNCTION pg_temp.try_demojibake(TEXT);

COMMIT;
