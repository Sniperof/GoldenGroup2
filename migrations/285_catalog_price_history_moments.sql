-- Price changes are effective at the moment they are added, not by a user-entered
-- date. Convert the history windows from date granularity to timestamp
-- granularity so multiple same-day price changes can be recorded safely.

DROP INDEX IF EXISTS public.ux_device_model_price_history_effective_from;
DROP INDEX IF EXISTS public.ux_spare_part_price_history_effective_from;

ALTER TABLE public.device_model_price_history
  ALTER COLUMN effective_from TYPE timestamp without time zone
    USING effective_from::timestamp without time zone,
  ALTER COLUMN effective_to TYPE timestamp without time zone
    USING CASE
      WHEN effective_to IS NULL THEN NULL
      ELSE effective_to::timestamp without time zone + INTERVAL '1 day'
    END;

ALTER TABLE public.spare_part_price_history
  ALTER COLUMN effective_from TYPE timestamp without time zone
    USING effective_from::timestamp without time zone,
  ALTER COLUMN effective_to TYPE timestamp without time zone
    USING CASE
      WHEN effective_to IS NULL THEN NULL
      ELSE effective_to::timestamp without time zone + INTERVAL '1 day'
    END;

CREATE INDEX IF NOT EXISTS idx_device_model_price_history_effective_from_id
  ON public.device_model_price_history(device_model_id, effective_from DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_spare_part_price_history_effective_from_id
  ON public.spare_part_price_history(spare_part_id, effective_from DESC, id DESC);

UPDATE public.device_models dm
SET base_price = (
  SELECT ph.price
  FROM public.device_model_price_history ph
  WHERE ph.device_model_id = dm.id
    AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')
    AND (ph.effective_to IS NULL OR ph.effective_to > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus'))
  ORDER BY ph.effective_from DESC, ph.id DESC
  LIMIT 1
)
WHERE dm.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.device_model_price_history ph
    WHERE ph.device_model_id = dm.id
      AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')
      AND (ph.effective_to IS NULL OR ph.effective_to > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus'))
  );

UPDATE public.spare_parts sp
SET base_price = (
  SELECT ph.price
  FROM public.spare_part_price_history ph
  WHERE ph.spare_part_id = sp.id
    AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')
    AND (ph.effective_to IS NULL OR ph.effective_to > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus'))
  ORDER BY ph.effective_from DESC, ph.id DESC
  LIMIT 1
)
WHERE sp.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.spare_part_price_history ph
    WHERE ph.spare_part_id = sp.id
      AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')
      AND (ph.effective_to IS NULL OR ph.effective_to > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus'))
  );
