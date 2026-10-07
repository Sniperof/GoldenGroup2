BEGIN;

-- ── Keep mediator-name snapshots in sync with the mediator's current name ────
-- A mediator (وسيط) is stored as type + entity id + a NAME COPY taken at
-- referral time. Renaming the mediator client/employee left every copy stale,
-- so "who referred this client" showed the old name (client note, 2026-10).
-- The copies are now kept current: when clients.name / employees.name changes,
-- every snapshot that points at that record (same type AND id) is rewritten.
-- This supersedes the "name at registration time" meaning of referrer_name /
-- referral_name_snapshot. Personal / Unknown mediators have no record and keep
-- their typed name. No backfill: existing data is test data (decided 2026-10-07).
--
-- Covered copies (type is checked everywhere — an employee id can equal a
-- client id):
--   clients.referrer_name (+ referral_entity_id / legacy referrer_id)
--   clients.referrers[]           (name, referrerName)
--   contracts.contract_referrers[] (name, referrerName)
--   candidates.referral_name_snapshot
--   referral_sheets.referral_name_snapshot
--   employees.referrer_name
--   client_referral_attributions.referrer_name
--
-- The triggers fire only on UPDATE OF name and never write a `name` column,
-- so they cannot re-trigger themselves.

-- Rewrites the name of every element of a referrers JSON array that points at
-- (kind, entity_id). Elements carry the id in referralEntityId (and, for
-- record-backed mediators, also in id) and the type in referrerType / type.
CREATE OR REPLACE FUNCTION public.mediator_referrers_renamed(arr jsonb, kind text, entity_id integer, new_name text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(
           CASE
             WHEN COALESCE(elem->>'referrerType', elem->>'type') = kind
              AND COALESCE(elem->>'referralEntityId', elem->>'id') = entity_id::text
             THEN elem || jsonb_build_object('name', new_name, 'referrerName', new_name)
             ELSE elem
           END
           ORDER BY ord
         ), '[]'::jsonb)
  FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(elem, ord)
$$;

-- jsonpath filter: does the array hold an element pointing at (kind, id)?
-- .double() accepts the id stored as a number or a numeric string.
CREATE OR REPLACE FUNCTION public.mediator_referrers_points_at(arr jsonb, kind text, entity_id integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_path_exists(
    arr,
    '$[*] ? ((@.referrerType == $kind || @.type == $kind) && (@.referralEntityId.double() == $id || @.id.double() == $id))',
    jsonb_build_object('kind', kind, 'id', entity_id)
  ), false)
$$;

-- ── Client renamed ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_client_mediator_name()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.clients
     SET referrer_name = NEW.name
   WHERE referrer_type = 'Client'
     AND COALESCE(referral_entity_id, referrer_id) = NEW.id
     AND referrer_name IS DISTINCT FROM NEW.name;

  UPDATE public.clients
     SET referrers = public.mediator_referrers_renamed(referrers, 'Client', NEW.id, NEW.name)
   WHERE public.mediator_referrers_points_at(referrers, 'Client', NEW.id);

  UPDATE public.contracts
     SET contract_referrers = public.mediator_referrers_renamed(contract_referrers, 'Client', NEW.id, NEW.name)
   WHERE public.mediator_referrers_points_at(contract_referrers, 'Client', NEW.id);

  UPDATE public.candidates
     SET referral_name_snapshot = NEW.name
   WHERE referral_type = 'Client'
     AND referral_entity_id = NEW.id
     AND referral_name_snapshot IS DISTINCT FROM NEW.name;

  UPDATE public.referral_sheets
     SET referral_name_snapshot = NEW.name
   WHERE referral_type = 'Client'
     AND referral_entity_id = NEW.id
     AND referral_name_snapshot IS DISTINCT FROM NEW.name;

  UPDATE public.employees
     SET referrer_name = NEW.name
   WHERE referrer_type = 'Client'
     AND referral_entity_id = NEW.id
     AND referrer_name IS DISTINCT FROM NEW.name;

  UPDATE public.client_referral_attributions
     SET referrer_name = NEW.name
   WHERE referrer_client_id = NEW.id
     AND referrer_name IS DISTINCT FROM NEW.name;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_sync_mediator_name ON public.clients;
CREATE TRIGGER clients_sync_mediator_name
  AFTER UPDATE OF name ON public.clients
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.tg_sync_client_mediator_name();

-- ── Employee renamed ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_employee_mediator_name()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.clients
     SET referrer_name = NEW.name
   WHERE referrer_type = 'Employee'
     AND COALESCE(referral_entity_id, referrer_id) = NEW.id
     AND referrer_name IS DISTINCT FROM NEW.name;

  UPDATE public.clients
     SET referrers = public.mediator_referrers_renamed(referrers, 'Employee', NEW.id, NEW.name)
   WHERE public.mediator_referrers_points_at(referrers, 'Employee', NEW.id);

  UPDATE public.contracts
     SET contract_referrers = public.mediator_referrers_renamed(contract_referrers, 'Employee', NEW.id, NEW.name)
   WHERE public.mediator_referrers_points_at(contract_referrers, 'Employee', NEW.id);

  UPDATE public.candidates
     SET referral_name_snapshot = NEW.name
   WHERE referral_type = 'Employee'
     AND referral_entity_id = NEW.id
     AND referral_name_snapshot IS DISTINCT FROM NEW.name;

  UPDATE public.referral_sheets
     SET referral_name_snapshot = NEW.name
   WHERE referral_type = 'Employee'
     AND referral_entity_id = NEW.id
     AND referral_name_snapshot IS DISTINCT FROM NEW.name;

  UPDATE public.employees
     SET referrer_name = NEW.name
   WHERE referrer_type = 'Employee'
     AND referral_entity_id = NEW.id
     AND referrer_name IS DISTINCT FROM NEW.name;

  UPDATE public.client_referral_attributions
     SET referrer_name = NEW.name
   WHERE referrer_employee_id = NEW.id
     AND referrer_name IS DISTINCT FROM NEW.name;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employees_sync_mediator_name ON public.employees;
CREATE TRIGGER employees_sync_mediator_name
  AFTER UPDATE OF name ON public.employees
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.tg_sync_employee_mediator_name();

COMMIT;
