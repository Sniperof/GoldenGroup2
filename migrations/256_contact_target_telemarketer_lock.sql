-- Contact target ownership lock.
-- A contact target can be handled by exactly one HR user once it is claimed
-- from the telemarketing workspace or contacted for the first time.

ALTER TABLE public.contact_targets
  ADD COLUMN IF NOT EXISTS locked_by_hr_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_contacted_by_hr_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contact_targets_locked_by_hr_user
  ON public.contact_targets (locked_by_hr_user_id)
  WHERE locked_by_hr_user_id IS NOT NULL;

COMMENT ON COLUMN public.contact_targets.locked_by_hr_user_id IS
  'HR user who claimed this contact target for telemarketing. Only this user may record calls or book visits from it.';

COMMENT ON COLUMN public.contact_targets.first_contacted_by_hr_user_id IS
  'HR user who recorded the first contact attempt for this contact target.';
