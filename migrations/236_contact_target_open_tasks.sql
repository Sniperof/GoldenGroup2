-- Link planning contact targets to the open tasks that caused or affected them.
-- This keeps contact-target state separate from open-task state while preserving
-- the operational task history shown inside the dashboard row.

CREATE TABLE IF NOT EXISTS public.contact_target_open_tasks (
    id bigserial PRIMARY KEY,
    contact_target_id bigint NOT NULL REFERENCES public.contact_targets(id) ON DELETE CASCADE,
    open_task_id integer NOT NULL REFERENCES public.open_tasks(id) ON DELETE CASCADE,
    branch_id integer NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    team_key character varying(50) NOT NULL,
    date date NOT NULL,
    link_status character varying(32) DEFAULT 'ready'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_target_open_tasks_link_status_check
        CHECK ((link_status)::text = ANY (ARRAY[
            'ready'::text,
            'queued'::text,
            'excluded'::text,
            'closed'::text
        ]))
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_target_open_tasks_unique_day_task
    ON public.contact_target_open_tasks (contact_target_id, open_task_id, date);

CREATE INDEX IF NOT EXISTS contact_target_open_tasks_day_idx
    ON public.contact_target_open_tasks (branch_id, team_key, date, link_status);

CREATE INDEX IF NOT EXISTS contact_target_open_tasks_open_task_idx
    ON public.contact_target_open_tasks (open_task_id);

CREATE INDEX IF NOT EXISTS contact_target_open_tasks_target_idx
    ON public.contact_target_open_tasks (contact_target_id);

COMMENT ON TABLE public.contact_target_open_tasks IS
    'Planning dashboard bridge between a contact_target and the open_tasks that caused or modified it.';
