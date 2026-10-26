-- 486: who qualified a suggested name (converted it or linked it) and when.
--
-- The client's mediators table shows, for each mediator, the employee whose
-- action made them a mediator of this client (2026-10-21). Nothing recorded
-- it: conversion leaves a trace in clients.created_by, linking left none.
--
-- Backfill: a converted name's qualifier is the creator of the client it
-- became (the conversion creates that client). Linked names before this
-- migration stay unknown (NULL) — there is no record to derive them from.

BEGIN;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS qualified_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.candidates.qualified_by IS
  'hr_users.id of the employee who converted or linked the name (NULL for links before migration 486).';
COMMENT ON COLUMN public.candidates.qualified_at IS
  'When the name was converted or linked (NULL for links before migration 486).';

UPDATE public.candidates cand
   SET qualified_by = cl.created_by,
       qualified_at = cl.created_at
  FROM public.clients cl
 WHERE cl.id = cand.converted_to_lead_id
   AND cand.qualification_kind = 'converted'
   AND cand.qualified_by IS NULL;

COMMIT;
