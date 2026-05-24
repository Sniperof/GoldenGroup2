INSERT INTO system_lists (category, value, is_active, display_order)
VALUES
  ('no_closing_reasons', 'لم يتم التسكير', true, 1),
  ('no_closing_reasons', 'متابعة لاحقة', true, 2),
  ('no_closing_reasons', 'العميل مشغول', true, 3),
  ('no_closing_reasons', 'سبب سعري', true, 4),
  ('no_closing_reasons', 'أخرى', true, 5)
ON CONFLICT (category, value) DO NOTHING;
