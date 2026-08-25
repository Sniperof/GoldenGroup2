-- 435_device_delivery_suspension.sql
-- Adds the explicit pre-delivery administrative hold. The state belongs to
-- installed_devices only; contracts, receivables and collection tasks are not
-- changed by entering or leaving it.

BEGIN;

ALTER TABLE public.installed_devices
  DROP CONSTRAINT IF EXISTS installed_devices_status_check;

ALTER TABLE public.installed_devices
  ADD CONSTRAINT installed_devices_status_check
  CHECK (status IN (
    'registered', 'pending_delivery', 'delivery_suspended', 'delivered',
    'installed', 'active', 'faulty', 'in_workshop', 'ready',
    'out_of_service', 'retrieved', 'contract_cancelled'
  ));

INSERT INTO public.permissions (
  key, module, sub_module, action, display_name, display_order, allowed_scopes
)
VALUES (
  'installed_devices.delivery_suspension.manage',
  'devices',
  'installed_devices',
  'delivery_suspension_manage',
  'تعليق تسليم الجهاز وإعادته',
  224,
  ARRAY['GLOBAL','BRANCH']
)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- The grant is deliberately not copied from contracts.edit. It is an
-- independent operational decision and must be assigned explicitly.

CREATE OR REPLACE FUNCTION public.guard_suspended_device_delivery_task()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  current_device_status text;
BEGIN
  IF NEW.task_type = 'device_delivery'
     AND NEW.device_id IS NOT NULL
     AND NEW.status NOT IN ('completed', 'closed', 'cancelled') THEN
    SELECT status
      INTO current_device_status
      FROM public.installed_devices
     WHERE id = NEW.device_id
     FOR KEY SHARE;

    IF current_device_status = 'delivery_suspended' THEN
      RAISE EXCEPTION 'cannot create or reactivate delivery work for a suspended device'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_suspended_device_delivery_task ON public.open_tasks;
CREATE TRIGGER trg_guard_suspended_device_delivery_task
BEFORE INSERT OR UPDATE OF device_id, task_type, status
ON public.open_tasks
FOR EACH ROW
EXECUTE FUNCTION public.guard_suspended_device_delivery_task();

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT v.category, v.value, TRUE, v.display_order, v.metadata::jsonb
FROM (VALUES
  (
    'device_delivery_failure_reasons',
    'delivery_suspended_customer_absent',
    6,
    '{"label":"تعليق التسليم لغياب الزبون","systemReason":"delivery_suspended_customer_absent"}'
  ),
  (
    'visit_cancellation_reasons',
    'delivery_suspended_customer_absent',
    7,
    '{"label":"تعليق التسليم لغياب الزبون","systemReason":"delivery_suspended_customer_absent"}'
  )
) AS v(category, value, display_order, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = v.category AND sl.value = v.value
);

COMMIT;
