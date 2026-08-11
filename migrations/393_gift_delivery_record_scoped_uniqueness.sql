-- Gift-delivery task uniqueness belongs to each selected gift_record through
-- gift_delivery_task_records. A client may therefore have multiple active
-- gift-delivery tasks when they represent different approved gift records.
DROP INDEX IF EXISTS public.idx_open_tasks_unique_active_per_client;

CREATE UNIQUE INDEX idx_open_tasks_unique_active_per_client
  ON public.open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type NOT IN (
      'emergency_maintenance',
      'device_delivery',
      'installment_collection',
      'periodic_maintenance',
      'golden_warranty_card_delivery',
      'gift_delivery'
    );

COMMENT ON INDEX public.idx_open_tasks_unique_active_per_client IS
  'Client/type guard for task families whose active uniqueness is client-scoped; record-scoped families are excluded.';

COMMENT ON INDEX public.uq_gift_delivery_task_records_active_record IS
  'At most one active gift-delivery attempt per gift record; cancelled links remain history and permit a manual retry.';
