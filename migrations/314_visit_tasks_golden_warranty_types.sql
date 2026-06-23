-- ============================================================
-- 314_visit_tasks_golden_warranty_types.sql
-- ============================================================
-- visit_tasks.task_type has a CHECK enumerating bookable task types. Add the
-- golden-warranty types so the telemarketer can book a visit for them (the
-- unified result path already handles their outcomes). DEC-CT-17.
--
-- Idempotent / safe to re-run.
-- ============================================================

ALTER TABLE public.visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_task_type_check;

ALTER TABLE public.visit_tasks
  ADD CONSTRAINT visit_tasks_task_type_check
  CHECK (task_type::text = ANY (ARRAY[
    'device_demo', 'emergency_maintenance', 'device_delivery',
    'device_installation', 'device_activation',
    'golden_warranty_offer', 'golden_warranty_card_delivery'
  ]::text[]));
