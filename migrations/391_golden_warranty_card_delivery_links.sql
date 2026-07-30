-- ============================================================
-- 391_golden_warranty_card_delivery_links.sql
-- ============================================================
-- A golden-warranty card task is created manually and may bundle several
-- warranties.  The task must target exact warranty rows, not merely devices:
--   active    = the current delivery attempt
--   cancelled = a historical cancelled attempt; a retry is allowed
--   delivered = successful delivery; no later attempt is allowed
-- ============================================================

-- Card delivery allows more than one task per client because uniqueness belongs
-- to the selected warranty rows. Keep the existing client/type guard unchanged
-- for all other task types.
DROP INDEX IF EXISTS public.idx_open_tasks_unique_active_per_client;
CREATE UNIQUE INDEX idx_open_tasks_unique_active_per_client
  ON public.open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type NOT IN (
      'emergency_maintenance',
      'device_delivery',
      'installment_collection',
      'periodic_maintenance',
      'golden_warranty_card_delivery'
    );

CREATE TABLE IF NOT EXISTS public.open_task_golden_warranties (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES public.open_tasks(id) ON DELETE RESTRICT,
  warranty_id INTEGER NOT NULL REFERENCES public.device_warranties(id) ON DELETE RESTRICT,
  link_status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT open_task_golden_warranties_task_warranty_uk UNIQUE (task_id, warranty_id),
  CONSTRAINT open_task_golden_warranties_status_ck
    CHECK (link_status IN ('active', 'cancelled', 'delivered'))
);

CREATE INDEX IF NOT EXISTS idx_open_task_golden_warranties_task
  ON public.open_task_golden_warranties(task_id);

CREATE INDEX IF NOT EXISTS idx_open_task_golden_warranties_warranty
  ON public.open_task_golden_warranties(warranty_id);

-- Backfill successful links already recorded on the warranty snapshot.
INSERT INTO public.open_task_golden_warranties (task_id, warranty_id, link_status)
SELECT ot.id, w.id, 'delivered'
  FROM public.device_warranties w
  JOIN public.open_tasks ot ON ot.id = w.card_delivery_task_id
 WHERE w.warranty_type = 'golden'
   AND ot.task_type = 'golden_warranty_card_delivery'
ON CONFLICT (task_id, warranty_id) DO UPDATE
  SET link_status = 'delivered',
      updated_at = NOW();

-- Backfill current/cancelled attempts from their installed-device links.  A
-- completed task is intentionally accepted only through the successful
-- card_delivery_task_id snapshot above; completion without that snapshot is
-- not silently reclassified as a successful delivery.
WITH task_devices AS (
  SELECT ot.id AS task_id, ot.status, otid.installed_device_id
    FROM public.open_tasks ot
    JOIN public.open_task_installed_devices otid ON otid.task_id = ot.id
   WHERE ot.task_type = 'golden_warranty_card_delivery'
  UNION
  SELECT ot.id AS task_id, ot.status, ot.device_id AS installed_device_id
    FROM public.open_tasks ot
   WHERE ot.task_type = 'golden_warranty_card_delivery'
     AND ot.device_id IS NOT NULL
),
candidate_links AS (
  SELECT DISTINCT td.task_id,
         w.id AS warranty_id,
         CASE WHEN td.status = 'cancelled' THEN 'cancelled' ELSE 'active' END AS link_status
    FROM task_devices td
    JOIN public.device_warranties w ON w.device_id = td.installed_device_id
   WHERE w.warranty_type = 'golden'
     AND w.status = 'active'
     AND (
       td.status = 'cancelled'
       OR td.status IN (
         'open', 'needs_follow_up', 'assigned', 'in_scheduling',
         'scheduled', 'waiting_execution', 'in_execution', 'ended'
       )
     )
)
INSERT INTO public.open_task_golden_warranties (task_id, warranty_id, link_status)
SELECT task_id, warranty_id, link_status
  FROM candidate_links
ON CONFLICT (task_id, warranty_id) DO NOTHING;

-- One current attempt or one successful delivery is allowed per warranty.
-- Cancelled attempts remain as history and do not block a manual retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_golden_warranty_one_current_card_delivery
  ON public.open_task_golden_warranties(warranty_id)
  WHERE link_status IN ('active', 'delivered');

CREATE OR REPLACE FUNCTION public.sync_golden_warranty_card_links_from_task_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.task_type <> 'golden_warranty_card_delivery'
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    UPDATE public.open_task_golden_warranties
       SET link_status = 'cancelled',
           updated_at = NOW()
     WHERE task_id = NEW.id
       AND link_status = 'active';
  ELSIF NEW.status IN ('completed', 'closed')
        AND EXISTS (
          SELECT 1
            FROM public.open_task_golden_warranties
           WHERE task_id = NEW.id
             AND link_status = 'active'
        ) THEN
    RAISE EXCEPTION
      'golden warranty card task % cannot close before its warranty links are delivered',
      NEW.id
      USING ERRCODE = '23514',
            CONSTRAINT = 'golden_warranty_card_task_requires_delivered_links';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_golden_warranty_card_links_from_task_status
  ON public.open_tasks;
CREATE TRIGGER trg_sync_golden_warranty_card_links_from_task_status
BEFORE UPDATE OF status ON public.open_tasks
FOR EACH ROW
EXECUTE FUNCTION public.sync_golden_warranty_card_links_from_task_status();
