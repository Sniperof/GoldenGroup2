-- ============================================================
-- 355_seed_water_check_request_type.sql
-- ============================================================
-- The development database already enforces service_requests.request_type
-- through service_requests_request_type_fk. Seed water_check into the FK
-- target table so the mobile intake endpoint can insert rows safely.
--
-- This migration intentionally discovers the FK target instead of assuming a
-- registry table shape, because earlier registry work may exist in databases
-- even when the local branch does not include its migration file.
-- ============================================================

BEGIN;

DO $$
DECLARE
  target_schema TEXT;
  target_table TEXT;
  target_column TEXT;
  qualified_table TEXT;
  row_exists BOOLEAN;
  rec RECORD;
  value_sql TEXT;
  column_names TEXT[] := ARRAY[]::TEXT[];
  column_values TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT target_ns.nspname,
         target_cls.relname,
         target_att.attname
    INTO target_schema, target_table, target_column
    FROM pg_constraint con
    JOIN pg_class source_cls ON source_cls.oid = con.conrelid
    JOIN pg_class target_cls ON target_cls.oid = con.confrelid
    JOIN pg_namespace target_ns ON target_ns.oid = target_cls.relnamespace
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON TRUE
    JOIN pg_attribute target_att
      ON target_att.attrelid = con.confrelid
     AND target_att.attnum = fk.attnum
   WHERE con.conname = 'service_requests_request_type_fk'
     AND source_cls.relname = 'service_requests'
   ORDER BY fk.ord
   LIMIT 1;

  IF target_schema IS NULL THEN
    CREATE TABLE IF NOT EXISTS public.service_request_type_config (
      code VARCHAR(80) PRIMARY KEY,
      label_ar TEXT NOT NULL,
      label_en TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      handoff_target TEXT,
      handoff_task_type TEXT,
      form_version TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    target_schema := 'public';
    target_table := 'service_request_type_config';
    target_column := 'code';
  END IF;

  qualified_table := format('%I.%I', target_schema, target_table);

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
    qualified_table,
    target_column
  )
    INTO row_exists
    USING 'water_check';

  IF NOT row_exists THEN
    FOR rec IN
      SELECT column_name,
             data_type,
             udt_name,
             is_nullable,
             column_default
        FROM information_schema.columns
       WHERE table_schema = target_schema
         AND table_name = target_table
       ORDER BY ordinal_position
    LOOP
      value_sql := NULL;

      IF rec.column_name = target_column
         OR rec.column_name IN ('code', 'request_type', 'type_key', 'key', 'slug') THEN
        value_sql := quote_literal('water_check');

      ELSIF rec.column_name IN ('label_ar', 'arabic_label', 'display_name_ar', 'name_ar', 'title_ar') THEN
        value_sql := quote_literal('طلب فحص المياه');

      ELSIF rec.column_name IN ('label_en', 'english_label', 'display_name_en', 'name_en', 'title_en') THEN
        value_sql := quote_literal('Water Check');

      ELSIF rec.column_name IN ('label', 'name', 'display_name', 'title') THEN
        value_sql := quote_literal('طلب فحص المياه');

      ELSIF rec.column_name IN ('description', 'description_ar') THEN
        value_sql := quote_literal('طلب وارد من الموبايل لفحص المياه، يحفظ كطلب خدمة ويرتبط بفرع حسب التغطية الجغرافية.');

      ELSIF rec.column_name IN ('is_active', 'active', 'enabled', 'allow_external_names',
                                'allows_external_names', 'allow_external_parties',
                                'requires_branch', 'auto_branch_resolution_enabled',
                                'branch_resolution_enabled') THEN
        value_sql := 'TRUE';

      ELSIF rec.column_name IN ('handoff_target', 'handoff_target_type', 'target_domain',
                                'target_entity', 'handoff_entity') THEN
        value_sql := quote_literal('open_task');

      ELSIF rec.column_name IN ('handoff_task_type', 'target_task_type', 'default_task_type',
                                'task_type') THEN
        value_sql := quote_literal('device_demo');

      ELSIF rec.column_name IN ('form_version', 'default_form_version', 'current_form_version') THEN
        value_sql := quote_literal('water_check.mobile.v1');

      ELSIF rec.column_name IN ('request_family', 'family') THEN
        value_sql := quote_literal('service');

      ELSIF rec.column_name IN ('default_channel', 'channel') THEN
        value_sql := quote_literal('mobile_app');

      ELSIF rec.column_name IN ('sort_order', 'display_order', 'order_index') THEN
        value_sql := '10';

      ELSIF rec.column_name IN ('version', 'schema_version') THEN
        IF rec.data_type IN ('integer', 'bigint', 'smallint', 'numeric') THEN
          value_sql := '1';
        ELSE
          value_sql := quote_literal('water_check.mobile.v1');
        END IF;

      ELSIF rec.column_name IN ('metadata', 'config', 'definition', 'behavior_flags',
                                'handoff_policy', 'external_party_policy') THEN
        IF rec.udt_name IN ('jsonb', 'json') THEN
          value_sql := quote_literal(
            '{"formVersion":"water_check.mobile.v1","handoffTarget":"open_task","handoffTaskType":"device_demo","autoBranchResolution":true,"externalNamesAllowed":true}'
          ) || '::' || rec.udt_name;
        END IF;

      ELSIF rec.column_name IN ('created_at', 'updated_at') THEN
        value_sql := 'NOW()';
      END IF;

      IF value_sql IS NOT NULL THEN
        column_names := array_append(column_names, format('%I', rec.column_name));
        column_values := array_append(column_values, value_sql);
      ELSIF rec.is_nullable = 'NO' AND rec.column_default IS NULL THEN
        RAISE EXCEPTION
          'Cannot seed water_check request type: required column %.% has no default and no known seed value',
          qualified_table,
          rec.column_name;
      END IF;
    END LOOP;

    EXECUTE format(
      'INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%I) DO NOTHING',
      qualified_table,
      array_to_string(column_names, ', '),
      array_to_string(column_values, ', '),
      target_column
    );
  END IF;
END $$;

COMMIT;
