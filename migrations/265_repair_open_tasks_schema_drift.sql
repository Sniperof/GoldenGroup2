-- Repair open_tasks schema drift caused by adopting the squashed baseline
-- against an older pre-squash database and by migrations recorded before
-- their current contents were present.

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS creation_origin varchar(50),
  ADD COLUMN IF NOT EXISTS assigned_by integer,
  ADD COLUMN IF NOT EXISTS assigned_via varchar(50),
  ADD COLUMN IF NOT EXISTS expected_time varchar(50),
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS source_context_type varchar(100),
  ADD COLUMN IF NOT EXISTS source_context_id bigint,
  ADD COLUMN IF NOT EXISTS dispatch_origin_type varchar(100),
  ADD COLUMN IF NOT EXISTS dispatch_origin_label text;

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_reason_check,
  DROP CONSTRAINT IF EXISTS open_tasks_creation_origin_check,
  DROP CONSTRAINT IF EXISTS open_tasks_assigned_via_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_reason_check
    CHECK (reason IN (
      'new_lead', 'follow_up', 'renewal', 'service_request', 'other',
      'sale_delivery', 'post_maintenance_return', 'temporary_swap_delivery',
      'replacement_delivery', 'manual_delivery'
    )),
  ADD CONSTRAINT open_tasks_creation_origin_check
    CHECK (
      creation_origin IS NULL OR creation_origin IN (
        'branch_plan', 'service_request_call', 'telemarketing_inline_booking',
        'cascading_during_visit', 'manual_creation', 'emergency_request',
        'system_trigger'
      )
    ),
  ADD CONSTRAINT open_tasks_assigned_via_check
    CHECK (
      assigned_via IS NULL OR assigned_via IN (
        'planning_calculation', 'telemarketing_booking', 'manual_override',
        'cascading'
      )
    );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.open_tasks'::regclass
       AND conname = 'open_tasks_assigned_by_fkey'
  ) THEN
    ALTER TABLE public.open_tasks
      ADD CONSTRAINT open_tasks_assigned_by_fkey
      FOREIGN KEY (assigned_by) REFERENCES public.hr_users(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_open_tasks_assigned_by
  ON public.open_tasks (assigned_by)
  WHERE assigned_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_open_tasks_creation_origin
  ON public.open_tasks (creation_origin);

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_active_device_delivery_per_device
  ON public.open_tasks (device_id)
  WHERE task_type = 'device_delivery'
    AND status NOT IN ('completed', 'closed', 'cancelled')
    AND device_id IS NOT NULL;

COMMENT ON COLUMN public.open_tasks.creation_origin IS
  'Canonical task-creation origin per DEC-004 D13.';

COMMENT ON COLUMN public.open_tasks.assigned_via IS
  'How this task moved into assigned state per DEC-004 D13.';

COMMENT ON COLUMN public.open_tasks.delivery_address IS
  'Canonical device_delivery execution address. Defaults from the installed device address and does not update the device main address by itself.';
