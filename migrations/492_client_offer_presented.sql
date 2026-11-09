-- 492: Clients whose device-demo offer was presented (2026-11-09)
--
-- A client is FOP when a device demo reached «قُدّم العرض» (the rule in
-- buildClientLifecycleStatusSql, unchanged). That rule only reached the result
-- through the demo's open task, and migrated demo visits carry none: on the
-- staging copy 213,230 demo visit tasks, 50 linked to an open task, so 50,515
-- clients whose offer was presented stayed LEAD.
--
-- Reaching the result through the client's visits instead made every client
-- query build the whole 70k-result set (a 50-row page 15 ms → 177 ms; indexes
-- made the full-table count 5 s). Decisions:
--   D1  client_offer_presented: one row per client with a closed device-demo
--       visit task whose result is offer_presented. The rule reads it by key.
--   D2  kept by triggers on visit_task_results (result recorded / edited /
--       removed), visit_tasks (closed, re-typed, moved, removed) and
--       field_visits (client changed). Each recomputes the affected client.
--   D3  reconcile_client_offer_presented() rebuilds it set-based (≈1 s on
--       staging): called here, and by the API at boot and daily, so data copied
--       with triggers disabled (the migration team's copy) is picked up without
--       a manual step.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_offer_presented (
  client_id integer PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_offer_presented IS
  'Clients with a closed device-demo visit task whose result is offer_presented (FOP evidence). Derived: triggers + reconcile_client_offer_presented() (migration 492).';

-- ── The truth for one client (D2) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_client_offer_presented(p_client_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_client_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.field_visits fv
      JOIN public.visit_tasks vt ON vt.field_visit_id = fv.id
      JOIN public.visit_task_results r ON r.visit_task_id = vt.id
     WHERE fv.client_id = p_client_id
       AND vt.task_type = 'device_demo'
       AND vt.status = 'closed'
       AND r.final_decision = 'offer_presented'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
      INSERT INTO public.client_offer_presented (client_id) VALUES (p_client_id)
      ON CONFLICT (client_id) DO NOTHING;
    END IF;
  ELSE
    DELETE FROM public.client_offer_presented WHERE client_id = p_client_id;
  END IF;
END;
$$;

-- ── Triggers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_offer_presented_on_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client integer;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT fv.client_id INTO v_client
      FROM public.visit_tasks vt JOIN public.field_visits fv ON fv.id = vt.field_visit_id
     WHERE vt.id = OLD.visit_task_id AND vt.task_type = 'device_demo';
    PERFORM public.refresh_client_offer_presented(v_client);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT fv.client_id INTO v_client
      FROM public.visit_tasks vt JOIN public.field_visits fv ON fv.id = vt.field_visit_id
     WHERE vt.id = NEW.visit_task_id AND vt.task_type = 'device_demo';
    PERFORM public.refresh_client_offer_presented(v_client);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_offer_presented_on_result ON public.visit_task_results;
CREATE TRIGGER trg_client_offer_presented_on_result
  AFTER INSERT OR UPDATE OF final_decision, visit_task_id OR DELETE ON public.visit_task_results
  FOR EACH ROW
  EXECUTE FUNCTION public.client_offer_presented_on_result();

CREATE OR REPLACE FUNCTION public.client_offer_presented_on_visit_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.task_type = 'device_demo' THEN
    PERFORM public.refresh_client_offer_presented(
      (SELECT client_id FROM public.field_visits WHERE id = OLD.field_visit_id));
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.task_type = 'device_demo' THEN
    PERFORM public.refresh_client_offer_presented(
      (SELECT client_id FROM public.field_visits WHERE id = NEW.field_visit_id));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_offer_presented_on_visit_task ON public.visit_tasks;
CREATE TRIGGER trg_client_offer_presented_on_visit_task
  AFTER UPDATE OF status, task_type, field_visit_id OR DELETE ON public.visit_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.client_offer_presented_on_visit_task();

CREATE OR REPLACE FUNCTION public.client_offer_presented_on_visit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.visit_tasks WHERE field_visit_id = NEW.id AND task_type = 'device_demo') THEN
    PERFORM public.refresh_client_offer_presented(OLD.client_id);
    PERFORM public.refresh_client_offer_presented(NEW.client_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_offer_presented_on_visit ON public.field_visits;
CREATE TRIGGER trg_client_offer_presented_on_visit
  AFTER UPDATE OF client_id ON public.field_visits
  FOR EACH ROW
  WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id)
  EXECUTE FUNCTION public.client_offer_presented_on_visit();

-- ── Set-based rebuild (D3) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_client_offer_presented()
RETURNS TABLE (added integer, removed integer)
LANGUAGE plpgsql
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS client_offer_presented_truth (client_id integer PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE client_offer_presented_truth;
  INSERT INTO client_offer_presented_truth (client_id)
  SELECT DISTINCT fv.client_id
    FROM public.field_visits fv
    JOIN public.visit_tasks vt ON vt.field_visit_id = fv.id
    JOIN public.visit_task_results r ON r.visit_task_id = vt.id
    JOIN public.clients c ON c.id = fv.client_id
   WHERE vt.task_type = 'device_demo'
     AND vt.status = 'closed'
     AND r.final_decision = 'offer_presented';

  WITH ins AS (
    INSERT INTO public.client_offer_presented (client_id)
    SELECT t.client_id FROM client_offer_presented_truth t
    ON CONFLICT (client_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO added FROM ins;

  WITH del AS (
    DELETE FROM public.client_offer_presented x
     WHERE NOT EXISTS (SELECT 1 FROM client_offer_presented_truth t WHERE t.client_id = x.client_id)
    RETURNING 1
  )
  SELECT count(*)::int INTO removed FROM del;

  RETURN NEXT;
END;
$$;

SELECT * FROM public.reconcile_client_offer_presented();

COMMIT;
