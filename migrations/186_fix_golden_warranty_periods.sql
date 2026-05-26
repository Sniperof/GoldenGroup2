-- Migration 186: convert golden_warranty_periods from string array to object array
-- Before: ["12 شهرًا"]
-- After:  [{"months": 12, "label": "12 شهرًا"}]

UPDATE device_models
SET golden_warranty_periods = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', elem,
      'months', CASE elem
        WHEN '3 أشهر'  THEN 3
        WHEN '6 أشهر'  THEN 6
        WHEN '9 أشهر'  THEN 9
        WHEN '12 شهرًا' THEN 12
        WHEN '24 شهرًا' THEN 24
        WHEN '36 شهرًا' THEN 36
        ELSE 12
      END
    )
  )
  FROM jsonb_array_elements_text(golden_warranty_periods) AS elem
)
WHERE is_golden_warranty = true
  AND jsonb_array_length(golden_warranty_periods) > 0
  AND golden_warranty_periods->0 IS NOT NULL
  AND jsonb_typeof(golden_warranty_periods->0) = 'string';
