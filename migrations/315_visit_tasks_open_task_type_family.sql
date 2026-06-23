-- ============================================================
-- 315_visit_tasks_open_task_type_family.sql
-- ============================================================
-- visit_tasks is the execution projection for open_tasks. Its task_type/task_family
-- constraints must not enumerate a stale subset of task_type_config; otherwise any
-- new operational task type can be created but fail when scheduled into a visit or
-- when a visit task is added during field work.
--
-- Keep only structural checks here. The authoritative catalog remains
-- task_type_config/open_tasks validation.
-- ============================================================

ALTER TABLE public.visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_task_type_check;

ALTER TABLE public.visit_tasks
  ADD CONSTRAINT visit_tasks_task_type_check
  CHECK (length(btrim(task_type::text)) > 0);

ALTER TABLE public.visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_task_family_check;

ALTER TABLE public.visit_tasks
  ADD CONSTRAINT visit_tasks_task_family_check
  CHECK (length(btrim(task_family::text)) > 0);
