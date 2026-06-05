-- Canonical device installation result model.
-- Aligns device_installation with docs/constitution/features/device-installation-task.md.

ALTER TABLE public.visit_task_device_installation_results
  ADD COLUMN IF NOT EXISTS installation_incomplete_reason_id integer,
  ADD COLUMN IF NOT EXISTS installation_refusal_reason_id integer,
  ADD COLUMN IF NOT EXISTS activation_due_date date,
  ADD COLUMN IF NOT EXISTS customer_acknowledged boolean,
  ADD COLUMN IF NOT EXISTS receiver_name text,
  ADD COLUMN IF NOT EXISTS receiver_signature text,
  ADD COLUMN IF NOT EXISTS final_installation_geo_unit_id integer,
  ADD COLUMN IF NOT EXISTS final_installation_address_text text,
  ADD COLUMN IF NOT EXISTS final_installation_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS final_installation_lng numeric(10,7),
  ADD COLUMN IF NOT EXISTS created_activation_task_id integer,
  ADD COLUMN IF NOT EXISTS installation_parts jsonb DEFAULT '[]'::jsonb NOT NULL;

UPDATE public.visit_task_device_installation_results
   SET outcome = 'installation_incomplete'
 WHERE outcome = 'site_not_ready';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'visit_task_device_installation_results_outcome_check'
  ) THEN
    ALTER TABLE public.visit_task_device_installation_results
      DROP CONSTRAINT visit_task_device_installation_results_outcome_check;
  END IF;
END $$;

ALTER TABLE public.visit_task_device_installation_results
  ADD CONSTRAINT visit_task_device_installation_results_outcome_check
  CHECK (outcome IN ('installed_successfully', 'installation_incomplete', 'refused_installation'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visit_task_device_installation_results_incomplete_reason_fkey'
  ) THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_incomplete_reason_fkey
      FOREIGN KEY (installation_incomplete_reason_id)
      REFERENCES public.system_lists(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visit_task_device_installation_results_refusal_reason_fkey'
  ) THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_refusal_reason_fkey
      FOREIGN KEY (installation_refusal_reason_id)
      REFERENCES public.system_lists(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visit_task_device_installation_results_final_geo_fkey'
  ) THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_final_geo_fkey
      FOREIGN KEY (final_installation_geo_unit_id)
      REFERENCES public.geo_units(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visit_task_device_installation_results_activation_task_fkey'
  ) THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_activation_task_fkey
      FOREIGN KEY (created_activation_task_id)
      REFERENCES public.open_tasks(id) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
VALUES
  ('installation_incomplete_reason', 'الزبون غير متوفر', TRUE, 1, '{"code":"customer_not_available"}'::jsonb),
  ('installation_incomplete_reason', 'الموقع غير جاهز', TRUE, 2, '{"code":"site_not_ready"}'::jsonb),
  ('installation_incomplete_reason', 'سبب آخر', TRUE, 99, '{"code":"other"}'::jsonb),
  ('installation_refusal_reason', 'رفض الزبون التركيب', TRUE, 1, '{"code":"customer_refused"}'::jsonb),
  ('installation_refusal_reason', 'طلب الإلغاء', TRUE, 2, '{"code":"cancel_requested"}'::jsonb),
  ('installation_refusal_reason', 'سبب آخر', TRUE, 99, '{"code":"other"}'::jsonb)
ON CONFLICT (category, value) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_vtdir_incomplete_reason
  ON public.visit_task_device_installation_results (installation_incomplete_reason_id);

CREATE INDEX IF NOT EXISTS idx_vtdir_refusal_reason
  ON public.visit_task_device_installation_results (installation_refusal_reason_id);
