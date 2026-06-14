-- Align denormalized catalog prices with the historical price that is active
-- in the business timezone. PostgreSQL CURRENT_DATE can lag behind the Syrian
-- business day when the database/session timezone is UTC.

UPDATE public.device_models dm
SET base_price = (
  SELECT ph.price
  FROM public.device_model_price_history ph
  WHERE ph.device_model_id = dm.id
    AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
    AND (ph.effective_to IS NULL OR ph.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
  ORDER BY ph.effective_from DESC, ph.id DESC
  LIMIT 1
)
WHERE dm.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.device_model_price_history ph
    WHERE ph.device_model_id = dm.id
      AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
      AND (ph.effective_to IS NULL OR ph.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
  )
  AND dm.base_price IS DISTINCT FROM (
    SELECT ph.price
    FROM public.device_model_price_history ph
    WHERE ph.device_model_id = dm.id
      AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
      AND (ph.effective_to IS NULL OR ph.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
    ORDER BY ph.effective_from DESC, ph.id DESC
    LIMIT 1
  );

UPDATE public.spare_parts sp
SET base_price = (
  SELECT ph.price
  FROM public.spare_part_price_history ph
  WHERE ph.spare_part_id = sp.id
    AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
    AND (ph.effective_to IS NULL OR ph.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
  ORDER BY ph.effective_from DESC, ph.id DESC
  LIMIT 1
)
WHERE sp.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.spare_part_price_history ph
    WHERE ph.spare_part_id = sp.id
      AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
      AND (ph.effective_to IS NULL OR ph.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
  )
  AND sp.base_price IS DISTINCT FROM (
    SELECT ph.price
    FROM public.spare_part_price_history ph
    WHERE ph.spare_part_id = sp.id
      AND ph.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
      AND (ph.effective_to IS NULL OR ph.effective_to >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date)
    ORDER BY ph.effective_from DESC, ph.id DESC
    LIMIT 1
  );
