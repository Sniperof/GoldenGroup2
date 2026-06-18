-- ----------------------------------------------------------------------------
-- Demojibake fix — recovers Arabic in columns where 001_initial_schema.sql
-- (a pg_dump) stored UTF-8 bytes that had been misread as Windows-1256.
--
-- Recovery transform: convert_from(convert_to(x, 'WIN1256'), 'UTF8')
--
-- Detection predicate: value contains at least one character that is NOT
-- ASCII and NOT in the Arabic block (U+0600-U+06FF). Legitimate seed text
-- only contains those two ranges, so any other codepoint (Latin-1 supplement,
-- General Punctuation, Spacing Modifiers, etc.) is a reliable mojibake marker.
-- The fix is idempotent: running twice is a no-op on already-clean rows.
-- ----------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.try_demojibake(s TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  -- Cheap pre-filter: any char outside ASCII + Arabic block might be mojibake.
  IF s !~ U&'[^\0001-\007f\0600-\06ff]' THEN RETURN s; END IF;
  RETURN convert_from(convert_to(s, 'WIN1256'), 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN s;
END;
$$;

-- True mojibake test: the round-trip actually changes the value. This
-- eliminates false positives from legitimate punctuation like em-dash (—)
-- whose WIN1256 byte alone is not valid UTF-8, so convert_from raises and
-- try_demojibake returns the input unchanged.
CREATE OR REPLACE FUNCTION pg_temp.is_mojibake(s TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT s IS NOT NULL
     AND s ~ U&'[^\0001-\007f\0600-\06ff]'
     AND pg_temp.try_demojibake(s) IS DISTINCT FROM s;
$$;

-- single-column UPDATEs ------------------------------------------------------
UPDATE geo_units              SET name         = pg_temp.try_demojibake(name)         WHERE pg_temp.is_mojibake(name);
UPDATE emergency_action_types SET arabic_label = pg_temp.try_demojibake(arabic_label) WHERE pg_temp.is_mojibake(arabic_label);
UPDATE permissions            SET display_name = pg_temp.try_demojibake(display_name) WHERE pg_temp.is_mojibake(display_name);
UPDATE system_settings        SET description  = pg_temp.try_demojibake(description)  WHERE pg_temp.is_mojibake(description);
UPDATE task_type_config       SET arabic_label = pg_temp.try_demojibake(arabic_label) WHERE pg_temp.is_mojibake(arabic_label);

-- system_lists (per-row, with unique-violation skip) -------------------------
DO $$
DECLARE
  r RECORD;
  ok_count INT := 0;
  skip_count INT := 0;
BEGIN
  FOR r IN
    SELECT id, category, value
      FROM system_lists
     WHERE pg_temp.is_mojibake(category)
        OR pg_temp.is_mojibake(value)
     ORDER BY id
  LOOP
    BEGIN
      UPDATE system_lists
         SET category = pg_temp.try_demojibake(r.category),
             value    = pg_temp.try_demojibake(r.value)
       WHERE id = r.id;
      ok_count := ok_count + 1;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'system_lists id=% skipped (clean duplicate exists): (%, %)',
        r.id, pg_temp.try_demojibake(r.category), pg_temp.try_demojibake(r.value);
      skip_count := skip_count + 1;
    END;
  END LOOP;
  RAISE NOTICE 'system_lists: fixed=%, skipped=%', ok_count, skip_count;
END $$;

-- roles (per-row, with unique-violation skip) --------------------------------
DO $$
DECLARE
  r RECORD;
  ok_count INT := 0;
  skip_count INT := 0;
BEGIN
  FOR r IN
    SELECT id, display_name, description, protected_reason
      FROM roles
     WHERE pg_temp.is_mojibake(display_name)
        OR pg_temp.is_mojibake(description)
        OR pg_temp.is_mojibake(protected_reason)
     ORDER BY id
  LOOP
    BEGIN
      UPDATE roles
         SET display_name     = pg_temp.try_demojibake(r.display_name),
             description      = pg_temp.try_demojibake(r.description),
             protected_reason = pg_temp.try_demojibake(r.protected_reason)
       WHERE id = r.id;
      ok_count := ok_count + 1;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'roles id=% skipped (clean duplicate exists)', r.id;
      skip_count := skip_count + 1;
    END;
  END LOOP;
  RAISE NOTICE 'roles: fixed=%, skipped=%', ok_count, skip_count;
END $$;

COMMIT;

-- post-fix sanity check ------------------------------------------------------
SELECT 'system_lists' AS what, id, category, value FROM system_lists ORDER BY id LIMIT 10;
SELECT 'remaining mojibake (any column)' AS what,
       (SELECT count(*) FROM permissions   WHERE pg_temp.is_mojibake(display_name)) AS permissions,
       (SELECT count(*) FROM system_lists  WHERE pg_temp.is_mojibake(category) OR pg_temp.is_mojibake(value)) AS system_lists,
       (SELECT count(*) FROM geo_units     WHERE pg_temp.is_mojibake(name)) AS geo_units,
       (SELECT count(*) FROM roles         WHERE pg_temp.is_mojibake(display_name) OR pg_temp.is_mojibake(description) OR pg_temp.is_mojibake(protected_reason)) AS roles;
