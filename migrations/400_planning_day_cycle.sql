BEGIN;

CREATE TABLE public.planning_day_cycles (
    id bigserial PRIMARY KEY,
    branch_id integer NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    planning_date date NOT NULL,
    team_key character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'planning' NOT NULL,
    activated_at timestamp with time zone,
    closed_at timestamp with time zone,
    closed_by integer REFERENCES public.hr_users(id) ON DELETE SET NULL,
    close_reason character varying(50),
    closure_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT planning_day_cycles_status_check
        CHECK (status IN ('planning', 'ready', 'active', 'closing', 'closed')),
    CONSTRAINT planning_day_cycles_branch_date_team_key
        UNIQUE (branch_id, planning_date, team_key)
);

CREATE INDEX planning_day_cycles_open_date_idx
    ON public.planning_day_cycles (planning_date, status)
    WHERE status <> 'closed';

ALTER TABLE public.telemarketing_task_lists
    ADD COLUMN status character varying(20) DEFAULT 'open' NOT NULL,
    ADD COLUMN closed_at timestamp with time zone,
    ADD COLUMN close_reason character varying(50),
    ADD CONSTRAINT telemarketing_task_lists_status_check
        CHECK (status IN ('open', 'closed'));

INSERT INTO public.planning_day_cycles (
    branch_id,
    planning_date,
    team_key,
    status,
    activated_at,
    closed_at,
    close_reason
)
SELECT
    tl.branch_id,
    tl.date::date,
    tl.team_key,
    'active',
    tl.created_at,
    NULL,
    NULL
FROM public.telemarketing_task_lists tl
WHERE tl.branch_id IS NOT NULL
ON CONFLICT (branch_id, planning_date, team_key) DO NOTHING;

COMMENT ON TABLE public.planning_day_cycles IS
    'Operational lifecycle for one branch/team planning day. Closing is irreversible and preserves all historical rows.';
COMMENT ON COLUMN public.planning_day_cycles.closure_summary IS
    'Immutable operational counts recorded by the shared manual/automatic finalization service.';
COMMENT ON COLUMN public.telemarketing_task_lists.status IS
    'Parent list lifecycle. Closed lists remain readable but reject new operational mutations.';

COMMIT;
