-- ============================================================
-- 308_golden_warranty_task_types.sql
-- ============================================================
-- Registers the two golden-warranty task types in task_type_config so that
-- POST /open-tasks accepts them (the create endpoint rejects any task_type that
-- is not an active config row). Constitution: 02b §13.6 + DEC-CT-17 (CT-IMPL-017).
--
-- Mirrors the existing `golden_warranty` config (warranty family, device-based,
-- immediate scheduling) with allow_multiple = true, because golden warranties are
-- sequential and may be offered repeatedly over a device's life (DEC-CT-16).
--
-- Idempotent / safe to re-run.
-- ============================================================

INSERT INTO public.task_type_config
  (task_type, task_family, arabic_label, scheduling_pattern, window_basis,
   planning_window_days, contract_required, allow_multiple, has_due_date,
   display_order, is_active, location_basis, contact_target_visit_type)
VALUES
  ('golden_warranty_offer',         'warranty', 'عرض كفالة ذهبية',        'immediate', 'none', NULL, true, true, false, 21, true, 'device', 'marketing'),
  ('golden_warranty_card_delivery', 'warranty', 'تسليم كرت كفالة ذهبية',  'immediate', 'none', NULL, true, true, false, 22, true, 'device', 'service')
ON CONFLICT (task_type) DO UPDATE SET
  task_family               = EXCLUDED.task_family,
  arabic_label              = EXCLUDED.arabic_label,
  scheduling_pattern        = EXCLUDED.scheduling_pattern,
  window_basis              = EXCLUDED.window_basis,
  planning_window_days      = EXCLUDED.planning_window_days,
  contract_required         = EXCLUDED.contract_required,
  allow_multiple            = EXCLUDED.allow_multiple,
  has_due_date              = EXCLUDED.has_due_date,
  is_active                 = EXCLUDED.is_active,
  location_basis            = EXCLUDED.location_basis,
  contact_target_visit_type = EXCLUDED.contact_target_visit_type,
  updated_at                = now();
