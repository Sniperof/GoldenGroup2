-- ============================================================
-- 356_service_request_type_registry_contract.sql
-- DEF-367
-- ============================================================
-- Migration 355 can create the request-type registry with its legacy `code`
-- key, while migrations 367+ and the runtime consume the canonical
-- `request_type` contract. Normalize both clean and previously provisioned
-- databases before any canonical registry seed runs.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_request_type_config (
  request_type          VARCHAR(80) PRIMARY KEY,
  label_ar              TEXT NOT NULL,
  description_ar        TEXT NOT NULL DEFAULT '',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  display_order         INTEGER NOT NULL DEFAULT 0,
  default_form_version  TEXT NOT NULL DEFAULT '',
  form_source           TEXT NOT NULL DEFAULT 'code_seeded',
  channels              JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitter_tiers       JSONB NOT NULL DEFAULT '[]'::jsonb,
  submission_modes      JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_party_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  mismatch_policy       JSONB NOT NULL DEFAULT '{}'::jsonb,
  linkage_policy        JSONB NOT NULL DEFAULT '{}'::jsonb,
  permission_policy     JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_policy          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  has_request_type BOOLEAN;
  has_legacy_code BOOLEAN;
BEGIN
  SELECT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'service_request_type_config'
              AND column_name = 'request_type'
         ),
         EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'service_request_type_config'
              AND column_name = 'code'
         )
    INTO has_request_type, has_legacy_code;

  IF NOT has_request_type AND has_legacy_code THEN
    ALTER TABLE public.service_request_type_config
      RENAME COLUMN code TO request_type;
  ELSIF NOT has_request_type THEN
    RAISE EXCEPTION
      'Cannot normalize service_request_type_config: neither request_type nor legacy code exists'
      USING HINT = 'Reconcile the registry identity column before rerunning migration 356.';
  ELSIF has_legacy_code THEN
    RAISE EXCEPTION
      'Cannot normalize service_request_type_config: both request_type and legacy code exist'
      USING HINT = 'Reconcile the two identity columns explicitly; the migration will not guess which one is authoritative.';
  END IF;
END $$;

ALTER TABLE public.service_request_type_config
  ADD COLUMN IF NOT EXISTS description_ar TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_form_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS form_source TEXT NOT NULL DEFAULT 'code_seeded',
  ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submitter_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submission_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS external_party_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mismatch_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS linkage_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS permission_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS audit_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Legacy migration 355 made label_en mandatory, but canonical seeds no longer
-- write it. Keep the compatibility column without blocking migrations 367+.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'service_request_type_config'
       AND column_name = 'label_en'
  ) THEN
    ALTER TABLE public.service_request_type_config
      ALTER COLUMN label_en SET DEFAULT '';
  END IF;
END $$;

UPDATE public.service_request_type_config
   SET description_ar = COALESCE(description_ar, ''),
       is_active = COALESCE(is_active, TRUE),
       display_order = COALESCE(display_order, 0),
       default_form_version = COALESCE(default_form_version, ''),
       form_source = COALESCE(form_source, 'code_seeded'),
       channels = COALESCE(channels, '[]'::jsonb),
       submitter_tiers = COALESCE(submitter_tiers, '[]'::jsonb),
       submission_modes = COALESCE(submission_modes, '[]'::jsonb),
       external_party_policy = COALESCE(external_party_policy, '{}'::jsonb),
       mismatch_policy = COALESCE(mismatch_policy, '{}'::jsonb),
       linkage_policy = COALESCE(linkage_policy, '{}'::jsonb),
       permission_policy = COALESCE(permission_policy, '{}'::jsonb),
       audit_policy = COALESCE(audit_policy, '{}'::jsonb),
       created_at = COALESCE(created_at, NOW()),
       updated_at = COALESCE(updated_at, NOW());

ALTER TABLE public.service_request_type_config
  ALTER COLUMN description_ar SET DEFAULT '',
  ALTER COLUMN description_ar SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT TRUE,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN display_order SET DEFAULT 0,
  ALTER COLUMN display_order SET NOT NULL,
  ALTER COLUMN default_form_version SET DEFAULT '',
  ALTER COLUMN default_form_version SET NOT NULL,
  ALTER COLUMN form_source SET DEFAULT 'code_seeded',
  ALTER COLUMN form_source SET NOT NULL,
  ALTER COLUMN channels SET DEFAULT '[]'::jsonb,
  ALTER COLUMN channels SET NOT NULL,
  ALTER COLUMN submitter_tiers SET DEFAULT '[]'::jsonb,
  ALTER COLUMN submitter_tiers SET NOT NULL,
  ALTER COLUMN submission_modes SET DEFAULT '[]'::jsonb,
  ALTER COLUMN submission_modes SET NOT NULL,
  ALTER COLUMN external_party_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN external_party_policy SET NOT NULL,
  ALTER COLUMN mismatch_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN mismatch_policy SET NOT NULL,
  ALTER COLUMN linkage_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN linkage_policy SET NOT NULL,
  ALTER COLUMN permission_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN permission_policy SET NOT NULL,
  ALTER COLUMN audit_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN audit_policy SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.service_request_type_config
     WHERE request_type IS NULL
        OR btrim(request_type) = ''
  ) THEN
    RAISE EXCEPTION
      'Cannot normalize service_request_type_config: blank request_type values exist'
      USING HINT = 'Assign each registry row a stable request type before rerunning migration 356.';
  END IF;
END $$;

ALTER TABLE public.service_request_type_config
  ALTER COLUMN request_type SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_request_type_config_request_type_uq
  ON public.service_request_type_config (request_type);

-- The shared intake table defaults all historical rows to this type. Seed it
-- before installing the FK so clean databases and old maintenance rows agree.
INSERT INTO public.service_request_type_config
  (request_type, label_ar, description_ar, is_active, display_order,
   default_form_version, form_source, channels, submitter_tiers,
   submission_modes, external_party_policy, mismatch_policy, linkage_policy,
   permission_policy, audit_policy)
VALUES
  ('emergency_maintenance',
   'طلب صيانة طارئة',
   'طلب صيانة مستلم من قنوات الموظفين الداخلية.',
   TRUE,
   0,
   'emergency_maintenance.staff.v1',
   'code_seeded',
   '["phone","internal_button","client_detail_button","admin_manual"]'::jsonb,
   '["staff"]'::jsonb,
   '["for_another"]'::jsonb,
   '{}'::jsonb,
   '{}'::jsonb,
   '{"linkTarget":"clients","candidateLinkAllowed":false}'::jsonb,
   '{"view":"service_requests.view","review":"service_requests.review","reject":"service_requests.reject","promote":"service_requests.promote","resolve_escalation":"service_requests.resolve_escalation","archive":"service_requests.archive","create":"service_requests.create"}'::jsonb,
   '{"created":"request_created","linked":"party_linked","promoted":"promoted_to_task","rejected":"rejected_decision"}'::jsonb)
ON CONFLICT (request_type) DO NOTHING;

DO $$
DECLARE
  missing_types TEXT;
BEGIN
  SELECT string_agg(missing.request_type, ', ' ORDER BY missing.request_type)
    INTO missing_types
    FROM (
      SELECT DISTINCT sr.request_type
        FROM public.service_requests sr
        LEFT JOIN public.service_request_type_config cfg
          ON cfg.request_type = sr.request_type
       WHERE cfg.request_type IS NULL
    ) missing;

  IF missing_types IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce service request type registry: unregistered request types: %',
      missing_types
      USING HINT = 'Add reviewed registry definitions for these historical types, then rerun migration 356.';
  END IF;
END $$;

DO $$
DECLARE
  existing_definition RECORD;
BEGIN
  SELECT con.conrelid,
         con.confrelid,
         source_att.attname AS source_column,
         target_att.attname AS target_column
    INTO existing_definition
    FROM pg_constraint con
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS source_key(attnum, ord)
      ON TRUE
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS target_key(attnum, ord)
      ON target_key.ord = source_key.ord
    JOIN pg_attribute source_att
      ON source_att.attrelid = con.conrelid
     AND source_att.attnum = source_key.attnum
    JOIN pg_attribute target_att
      ON target_att.attrelid = con.confrelid
     AND target_att.attnum = target_key.attnum
   WHERE con.conname = 'service_requests_request_type_fk'
     AND con.conrelid = 'public.service_requests'::regclass
     AND con.contype = 'f'
   LIMIT 1;

  IF existing_definition.conrelid IS NULL THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_request_type_fk
      FOREIGN KEY (request_type)
      REFERENCES public.service_request_type_config(request_type)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  ELSIF existing_definition.conrelid <> 'public.service_requests'::regclass
     OR existing_definition.confrelid <> 'public.service_request_type_config'::regclass
     OR existing_definition.source_column <> 'request_type'
     OR existing_definition.target_column <> 'request_type' THEN
    RAISE EXCEPTION
      'Constraint service_requests_request_type_fk exists with a non-canonical definition'
      USING HINT = 'Reconcile the existing FK explicitly; the migration will not replace an unknown constraint.';
  END IF;
END $$;

COMMENT ON TABLE public.service_request_type_config IS
  'Canonical registry for request-type identity, intake availability, linkage, permission, and audit policies.';

COMMENT ON COLUMN public.service_request_type_config.request_type IS
  'Stable request-type identity referenced by service_requests.request_type.';

COMMIT;
