-- Migration 210: align open_tasks.task_family CHECK with task_type_config
-- ----------------------------------------------------------------------
-- The original CHECK only permitted (marketing | service | maintenance |
-- emergency), but task_type_config (migration 106) seeds families that
-- include 'delivery', 'sales', 'collection', and 'warranty'. The
-- contracts route INSERTs 'delivery' for the device_delivery task on
-- every new sale contract, which currently fails the constraint.
--
-- This migration replaces the CHECK with the full set of families
-- referenced by task_type_config.
-- ----------------------------------------------------------------------

BEGIN;

ALTER TABLE open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_task_family_check;

ALTER TABLE open_tasks
  ADD CONSTRAINT open_tasks_task_family_check
  CHECK (task_family IN (
    'marketing',
    'sales',
    'delivery',
    'maintenance',
    'emergency',
    'collection',
    'service',
    'warranty'
  ));

COMMIT;
