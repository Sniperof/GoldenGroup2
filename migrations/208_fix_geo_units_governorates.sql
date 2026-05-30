-- 208_fix_geo_units_governorates.sql
--
-- Purpose:
-- Repair the geo tree after legacy Syrian geo seed assumptions broke the
-- root governorate level. Older data assumed fixed governorate IDs already
-- existed, which is not true in the current dev database. That left many
-- level-2 rows pointing to parents from the same level.
--
-- This migration:
-- 1. Ensures the standard governorates exist at level = 1.
-- 2. Reparents existing level-2 regions to the correct governorate by name.

-- Create standard governorates if missing.
INSERT INTO geo_units (name, level, parent_id)
SELECT governorate_name, 1, NULL
FROM (
  VALUES
    ('دمشق'),
    ('ريف دمشق'),
    ('حلب'),
    ('حمص'),
    ('حماة'),
    ('اللاذقية'),
    ('طرطوس'),
    ('إدلب'),
    ('الرقة'),
    ('دير الزور'),
    ('الحسكة'),
    ('درعا'),
    ('السويداء'),
    ('القنيطرة')
) AS governorates(governorate_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM geo_units gu
  WHERE gu.level = 1
    AND gu.parent_id IS NULL
    AND gu.name = governorates.governorate_name
);

-- Reparent known seeded level-2 rows using governorate names instead of
-- brittle hard-coded IDs.
WITH level2_to_governorate(region_name, governorate_name) AS (
  VALUES
    ('دمشق القديمة', 'دمشق'),
    ('مرج الصافحة', 'دمشق'),
    ('جرمانا', 'دمشق'),
    ('مزة', 'دمشق'),
    ('دوما', 'دمشق'),
    ('القطيفة', 'دمشق'),
    ('المؤتمنة', 'دمشق'),
    ('داريا', 'دمشق'),

    ('حلب القديمة', 'حلب'),
    ('الشهباء', 'حلب'),
    ('أعزاز', 'حلب'),
    ('السفيرة', 'حلب'),
    ('باب الفرج', 'حلب'),
    ('النيرب', 'حلب'),
    ('الأتارب', 'حلب'),
    ('الحضر', 'حلب'),

    ('اللاذقية', 'اللاذقية'),
    ('جبلة', 'اللاذقية'),
    ('القرداحة', 'اللاذقية'),
    ('الحفة', 'اللاذقية'),
    ('صلانفة', 'اللاذقية'),

    ('حمص القديمة', 'حمص'),
    ('الواعر', 'حمص'),
    ('المخرم', 'حمص'),
    ('القصير', 'حمص'),
    ('الرستن', 'حمص'),
    ('تالدو', 'حمص'),
    ('مصياف', 'حمص'),
    ('المشتة', 'حمص'),

    ('طرطوس', 'طرطوس'),
    ('بنياس', 'طرطوس'),
    ('الصافية', 'طرطوس'),
    ('الدريكيش', 'طرطوس'),
    ('شيخ بدر', 'طرطوس')
),
governorates AS (
  SELECT id, name
  FROM geo_units
  WHERE level = 1
    AND parent_id IS NULL
)
UPDATE geo_units child
SET parent_id = governors.id
FROM level2_to_governorate map
JOIN governorates governors
  ON governors.name = map.governorate_name
WHERE child.level = 2
  AND child.name = map.region_name
  AND child.parent_id IS DISTINCT FROM governors.id;

