-- 342_water_source_system_list.sql
-- Make water-source options editable through Admin > System Lists.

BEGIN;

INSERT INTO public.system_lists (category, value, is_active, display_order, metadata)
SELECT 'water_source', v.value, TRUE, v.ord, v.metadata::jsonb
FROM (VALUES
  ('الاسالة الحكومية', 10, '{"code":"public_network"}'),
  ('شراء قناني معبأة (RO)', 20, '{"code":"bottled_ro"}'),
  ('ماء بئر / جوفي', 30, '{"code":"well_groundwater"}'),
  ('تناكر / حوضيات', 40, '{"code":"tanker"}'),
  ('غير معروف', 99, '{"code":"unknown"}')
) AS v(value, ord, metadata)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_lists sl
  WHERE sl.category = 'water_source'
    AND sl.value = v.value
);

COMMIT;
