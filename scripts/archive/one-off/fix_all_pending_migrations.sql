-- Comprehensive fix for all pending migrations (250-255)
-- Created after baseline adoption failed for several tables
-- Run this, then: pnpm --filter @golden-crm/api migrate

BEGIN;

-- ============================================================
-- 1. Fix task_type_config — add missing column
-- ============================================================
ALTER TABLE public.task_type_config
  ADD COLUMN IF NOT EXISTS contact_target_visit_type VARCHAR(50);

-- ============================================================
-- 2. Fix contact_targets — add missing column
-- ============================================================
ALTER TABLE public.contact_targets
  ADD COLUMN IF NOT EXISTS work_location_geo_unit_id INTEGER;

-- ============================================================
-- 3. Fix visit_task_device_delivery_results — add missing columns
-- ============================================================
ALTER TABLE public.visit_task_device_delivery_results
  ADD COLUMN IF NOT EXISTS after_delivery_action VARCHAR(50) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS installation_address_same_as_delivery BOOLEAN,
  ADD COLUMN IF NOT EXISTS installation_address TEXT,
  ADD COLUMN IF NOT EXISTS installation_required_date DATE,
  ADD COLUMN IF NOT EXISTS update_device_main_address BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS new_installation_geo_unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS new_installation_address_text TEXT,
  ADD COLUMN IF NOT EXISTS new_installation_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS new_installation_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS delivery_geo_unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_address_text TEXT,
  ADD COLUMN IF NOT EXISTS installation_geo_unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS installation_address_text TEXT,
  ADD COLUMN IF NOT EXISTS installation_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS installation_lng NUMERIC(10,7);

-- Add FK constraints for device_delivery_results
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_delivery_results_new_geo_fkey') THEN
    ALTER TABLE public.visit_task_device_delivery_results
      ADD CONSTRAINT visit_task_device_delivery_results_new_geo_fkey
      FOREIGN KEY (new_installation_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_delivery_results_delivery_geo_fkey') THEN
    ALTER TABLE public.visit_task_device_delivery_results
      ADD CONSTRAINT visit_task_device_delivery_results_delivery_geo_fkey
      FOREIGN KEY (delivery_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_delivery_results_installation_geo_fkey') THEN
    ALTER TABLE public.visit_task_device_delivery_results
      ADD CONSTRAINT visit_task_device_delivery_results_installation_geo_fkey
      FOREIGN KEY (installation_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 4. Fix visit_task_device_installation_results — add missing columns
-- ============================================================
ALTER TABLE public.visit_task_device_installation_results
  ADD COLUMN IF NOT EXISTS installation_incomplete_reason_id INTEGER,
  ADD COLUMN IF NOT EXISTS installation_refusal_reason_id INTEGER,
  ADD COLUMN IF NOT EXISTS activation_due_date DATE,
  ADD COLUMN IF NOT EXISTS customer_acknowledged BOOLEAN,
  ADD COLUMN IF NOT EXISTS receiver_name TEXT,
  ADD COLUMN IF NOT EXISTS receiver_signature TEXT,
  ADD COLUMN IF NOT EXISTS final_installation_geo_unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS final_installation_address_text TEXT,
  ADD COLUMN IF NOT EXISTS final_installation_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS final_installation_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS created_activation_task_id INTEGER,
  ADD COLUMN IF NOT EXISTS installation_parts JSONB DEFAULT '[]'::JSONB NOT NULL;

-- Add FK constraints for installation_results
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_installation_results_incomplete_reason_fkey') THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_incomplete_reason_fkey
      FOREIGN KEY (installation_incomplete_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_installation_results_refusal_reason_fkey') THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_refusal_reason_fkey
      FOREIGN KEY (installation_refusal_reason_id) REFERENCES public.system_lists(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_installation_results_final_geo_fkey') THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_final_geo_fkey
      FOREIGN KEY (final_installation_geo_unit_id) REFERENCES public.geo_units(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_device_installation_results_activation_task_fkey') THEN
    ALTER TABLE public.visit_task_device_installation_results
      ADD CONSTRAINT visit_task_device_installation_results_activation_task_fkey
      FOREIGN KEY (created_activation_task_id) REFERENCES public.open_tasks(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add indexes for installation_results
CREATE INDEX IF NOT EXISTS idx_vtdir_incomplete_reason
  ON public.visit_task_device_installation_results (installation_incomplete_reason_id);
CREATE INDEX IF NOT EXISTS idx_vtdir_refusal_reason
  ON public.visit_task_device_installation_results (installation_refusal_reason_id);

-- ============================================================
-- 5. Fix visit_task_emergency_parts_used — add missing column
-- ============================================================
ALTER TABLE public.visit_task_emergency_parts_used
  ADD COLUMN IF NOT EXISTS linked_problem_id BIGINT;

-- Add FK constraint for parts_used
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_emergency_parts_used_linked_problem_fkey') THEN
    ALTER TABLE public.visit_task_emergency_parts_used
      ADD CONSTRAINT visit_task_emergency_parts_used_linked_problem_fkey
      FOREIGN KEY (linked_problem_id) REFERENCES public.service_request_problems(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS visit_task_parts_linked_problem_idx
  ON public.visit_task_emergency_parts_used (linked_problem_id)
  WHERE linked_problem_id IS NOT NULL;

-- ============================================================
-- 6. Fix visit_task_results — add missing column
-- ============================================================
ALTER TABLE public.visit_task_results
  ADD COLUMN IF NOT EXISTS repaired_by_employee_id INTEGER;

-- Add FK constraint for visit_task_results
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_task_results_repaired_by_fkey') THEN
    ALTER TABLE public.visit_task_results
      ADD CONSTRAINT visit_task_results_repaired_by_fkey
      FOREIGN KEY (repaired_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS visit_task_results_repaired_by_idx
  ON public.visit_task_results (repaired_by_employee_id)
  WHERE repaired_by_employee_id IS NOT NULL;

COMMIT;

-- ============================================================
-- Mark all migrations as applied so they won't fail on re-run
-- ============================================================
INSERT INTO schema_migrations (filename) VALUES
  ('250_device_delivery_canonical_path.sql'),
  ('250_visit_task_parts_linked_problem.sql'),
  ('251_visit_task_results_repaired_by.sql'),
  ('252_contract_draft_device_payload.sql'),
  ('252_migrate_emergency_tickets.sql'),
  ('253_device_delivery_structured_addresses.sql'),
  ('254_device_installation_canonical_result.sql'),
  ('255_contact_targets_device_work_location.sql')
ON CONFLICT (filename) DO NOTHING;
