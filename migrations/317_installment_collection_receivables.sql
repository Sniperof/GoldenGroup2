-- ============================================================
-- 317_installment_collection_receivables.sql
-- ============================================================
-- Expands the existing `installment_collection` task type into the canonical
-- "تسديد ذمة" task. One task targets one contract_installments row, while the
-- receivable source (contract / maintenance / golden warranty) is snapshotted
-- on open_tasks for display and audit.
-- ============================================================

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS receivable_source_type  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS receivable_source_id    BIGINT,
  ADD COLUMN IF NOT EXISTS receivable_source_label TEXT,
  ADD COLUMN IF NOT EXISTS expected_amount_syp     NUMERIC(14,2);

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_receivable_source_type_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_receivable_source_type_check
  CHECK (
    receivable_source_type IS NULL OR
    receivable_source_type IN ('contract', 'maintenance_task', 'golden_warranty')
  );

ALTER TABLE public.open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_reason_check;

ALTER TABLE public.open_tasks
  ADD CONSTRAINT open_tasks_reason_check
  CHECK (reason::text = ANY (ARRAY[
    'new_lead', 'follow_up', 'renewal', 'service_request', 'other',
    'sale_delivery', 'post_maintenance_return', 'temporary_swap_delivery',
    'replacement_delivery', 'manual_delivery',
    'golden_warranty_offer', 'golden_warranty_card_delivery',
    'contract_installment_due', 'maintenance_receivable_due',
    'golden_warranty_receivable_due', 'remaining_installment_balance',
    'rescheduled_collection', 'previous_task_cancelled',
    'manager_followup', 'data_correction'
  ]::text[]));

DROP INDEX IF EXISTS idx_open_tasks_unique_active_per_client;

CREATE UNIQUE INDEX idx_open_tasks_unique_active_per_client
  ON public.open_tasks (client_id, task_type)
  WHERE status IN ('open', 'needs_follow_up')
    AND task_type NOT IN ('emergency_maintenance', 'device_delivery', 'installment_collection');

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_unique_active_installment_collection_per_installment
  ON public.open_tasks (installment_id)
  WHERE task_type = 'installment_collection'
    AND installment_id IS NOT NULL
    AND status NOT IN ('completed', 'closed', 'cancelled');

UPDATE public.task_type_config
   SET arabic_label = 'تسديد ذمة',
       task_family = 'collection',
       location_basis = 'client',
       contact_target_visit_type = 'collection',
       updated_at = NOW()
 WHERE task_type = 'installment_collection';

CREATE TABLE IF NOT EXISTS public.visit_task_installment_collection_results (
  id                         BIGSERIAL PRIMARY KEY,
  visit_task_result_id        BIGINT NOT NULL UNIQUE
                                REFERENCES public.visit_task_results(id) ON DELETE CASCADE,
  installment_id              INTEGER NOT NULL
                                REFERENCES public.contract_installments(id) ON DELETE RESTRICT,
  receivable_source_type      VARCHAR(50),
  receivable_source_id        BIGINT,
  amount_before_syp           NUMERIC(14,2) NOT NULL,
  paid_amount_syp             NUMERIC(14,2),
  remaining_after_syp         NUMERIC(14,2) NOT NULL,
  payment_entry_id            INTEGER
                                REFERENCES public.contract_payment_entries(id) ON DELETE SET NULL,
  payment_method              VARCHAR(50),
  payment_reference           VARCHAR(255),
  received_by_employee_id     INTEGER
                                REFERENCES public.hr_users(id) ON DELETE SET NULL,
  partial_payment_reason_id   INTEGER
                                REFERENCES public.system_lists(id) ON DELETE SET NULL,
  reschedule_reason_id        INTEGER
                                REFERENCES public.system_lists(id) ON DELETE SET NULL,
  refusal_reason_id           INTEGER
                                REFERENCES public.system_lists(id) ON DELETE SET NULL,
  next_expected_date          DATE,
  next_priority               VARCHAR(20),
  notes                       TEXT,
  created_followup_task_id    INTEGER
                                REFERENCES public.open_tasks(id) ON DELETE SET NULL,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT visit_task_installment_collection_amounts_ck
    CHECK (
      amount_before_syp >= 0
      AND remaining_after_syp >= 0
      AND (paid_amount_syp IS NULL OR paid_amount_syp > 0)
    ),
  CONSTRAINT visit_task_installment_collection_source_ck
    CHECK (
      receivable_source_type IS NULL OR
      receivable_source_type IN ('contract', 'maintenance_task', 'golden_warranty')
    ),
  CONSTRAINT visit_task_installment_collection_next_priority_ck
    CHECK (
      next_priority IS NULL OR next_priority IN ('high', 'medium', 'low')
    )
);

CREATE INDEX IF NOT EXISTS idx_visit_task_installment_collection_installment
  ON public.visit_task_installment_collection_results(installment_id);

CREATE INDEX IF NOT EXISTS idx_open_tasks_installment_collection_installment
  ON public.open_tasks(installment_id)
  WHERE task_type = 'installment_collection' AND installment_id IS NOT NULL;

-- Seed task creation reasons used by POST /open-tasks validation.
INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'open_task_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('contract_installment_due', 300),
  ('maintenance_receivable_due', 301),
  ('golden_warranty_receivable_due', 302),
  ('remaining_installment_balance', 303),
  ('rescheduled_collection', 304),
  ('previous_task_cancelled', 305),
  ('manager_followup', 306),
  ('data_correction', 307)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'open_task_reasons' AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'collection_partial_payment_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('customer_cash_shortage', 1),
  ('salary_or_income_delay', 2),
  ('requested_split_payment', 3),
  ('disputed_remaining_amount', 4),
  ('temporary_financial_hardship', 5),
  ('other', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'collection_partial_payment_reasons' AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'collection_reschedule_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('customer_unavailable', 1),
  ('customer_requested_later_date', 2),
  ('wrong_address', 3),
  ('wrong_contact_info', 4),
  ('payment_not_ready', 5),
  ('other', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'collection_reschedule_reasons' AND sl.value = v.value
);

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'collection_refusal_reasons', v.value, TRUE, v.ord, '{}'::jsonb
FROM (VALUES
  ('financial_dispute', 1),
  ('service_dispute', 2),
  ('claims_already_paid', 3),
  ('cannot_afford', 4),
  ('contract_dispute', 5),
  ('refuses_company_followup', 6),
  ('other', 99)
) AS v(value, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_lists sl
   WHERE sl.category = 'collection_refusal_reasons' AND sl.value = v.value
);

COMMENT ON TABLE public.visit_task_installment_collection_results IS
  'Side table for installment_collection / تسديد ذمة task results.';

COMMENT ON COLUMN public.open_tasks.expected_amount_syp IS
  'Snapshot of the receivable balance expected when this collection task was created.';
