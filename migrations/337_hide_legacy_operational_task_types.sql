-- 337_hide_legacy_operational_task_types.sql
-- Hide legacy/incomplete task types from operational task surfaces.
-- Historical rows remain intact; this only prevents active selection/planning.

BEGIN;

UPDATE public.task_type_config
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE task_type IN (
   'device_purchase',
   'maintenance_collection',
   'device_repair',
   'parts_sale',
   'golden_warranty',
   'warranty_cancellation',
   'warranty_reactivation'
 );

COMMIT;
