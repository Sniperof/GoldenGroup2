-- Scan all public.* text/varchar columns for rows that look like mojibake
-- (UTF-8 strings containing Latin-1 Supplement codepoints U+0080-U+00FF,
--  which never appear in well-formed Arabic seed data).
\set ON_ERROR_STOP off
DO $$
DECLARE
  r RECORD;
  sql_text TEXT;
  affected_count INT;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('text','character varying','character')
  LOOP
    sql_text := format(
      'SELECT count(*) FROM %I.%I WHERE %I ~ $regex$[-ÿ]$regex$',
      r.table_schema, r.table_name, r.column_name);
    BEGIN
      EXECUTE sql_text INTO affected_count;
      IF affected_count > 0 THEN
        RAISE NOTICE '%.% : % rows', r.table_name, r.column_name, affected_count;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END
$$;
