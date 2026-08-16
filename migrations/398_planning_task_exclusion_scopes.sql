BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS open_tasks_id_branch_uidx
    ON public.open_tasks (id, branch_id);

CREATE TABLE IF NOT EXISTS public.planning_curation_operations (
    id BIGSERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL
        REFERENCES public.branches(id) ON DELETE RESTRICT,
    planning_date DATE NOT NULL,
    team_key VARCHAR(50) NOT NULL,
    action VARCHAR(30) NOT NULL,
    layer VARCHAR(30) NOT NULL,
    selector JSONB NOT NULL,
    query_fingerprint VARCHAR(64),
    selection_fingerprint VARCHAR(64) NOT NULL,
    reason_code VARCHAR(50) NOT NULL DEFAULT 'manual',
    reason_text TEXT,
    affected_contacts INTEGER NOT NULL DEFAULT 0,
    affected_tasks INTEGER NOT NULL DEFAULT 0,
    performed_by INTEGER
        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT planning_curation_operations_team_key_check
        CHECK (team_key ~ '^(team|solo)_[0-9]+$'),
    CONSTRAINT planning_curation_operations_action_check
        CHECK (action IN ('exclude', 'restore', 'set_do_not_contact', 'clear_do_not_contact')),
    CONSTRAINT planning_curation_operations_layer_check
        CHECK (layer IN ('team_day', 'all_teams_day', 'client_do_not_contact')),
    CONSTRAINT planning_curation_operations_action_layer_check
        CHECK (
            (
                action IN ('exclude', 'restore')
                AND layer IN ('team_day', 'all_teams_day')
            )
            OR
            (
                action IN ('set_do_not_contact', 'clear_do_not_contact')
                AND layer = 'client_do_not_contact'
            )
        ),
    CONSTRAINT planning_curation_operations_query_fingerprint_check
        CHECK (
            query_fingerprint IS NULL
            OR query_fingerprint ~ '^[0-9a-f]{64}$'
        ),
    CONSTRAINT planning_curation_operations_selection_fingerprint_check
        CHECK (selection_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS planning_curation_operations_audit_idx
    ON public.planning_curation_operations (
        branch_id, planning_date, team_key, created_at DESC
    );

-- Planning curation is a dated decision overlay on an open task. It is not a
-- task lifecycle status: excluded tasks return to their previous waiting state.
CREATE TABLE IF NOT EXISTS public.planning_task_exclusions (
    id BIGSERIAL PRIMARY KEY,
    open_task_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL
        REFERENCES public.branches(id) ON DELETE RESTRICT,
    planning_date DATE NOT NULL,
    exclusion_scope VARCHAR(20) NOT NULL,
    team_key VARCHAR(50),
    team_snapshot JSONB,
    work_scope_id INTEGER
        REFERENCES public.work_scopes(id) ON DELETE SET NULL,
    reason_code VARCHAR(50) NOT NULL DEFAULT 'manual',
    reason_text TEXT,
    operation_id BIGINT
        REFERENCES public.planning_curation_operations(id) ON DELETE RESTRICT,
    excluded_by INTEGER
        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by INTEGER
        REFERENCES public.hr_users(id) ON DELETE SET NULL,
    revoke_reason TEXT,
    revoked_operation_id BIGINT
        REFERENCES public.planning_curation_operations(id) ON DELETE RESTRICT,
    CONSTRAINT planning_task_exclusions_task_branch_fk
        FOREIGN KEY (open_task_id, branch_id)
        REFERENCES public.open_tasks(id, branch_id) ON DELETE RESTRICT,
    CONSTRAINT planning_task_exclusions_scope_check
        CHECK (exclusion_scope IN ('all_teams', 'team')),
    CONSTRAINT planning_task_exclusions_team_shape_check
        CHECK (
            (exclusion_scope = 'team' AND team_key IS NOT NULL AND team_snapshot IS NOT NULL)
            OR
            (exclusion_scope = 'all_teams' AND team_key IS NULL AND team_snapshot IS NULL)
        ),
    CONSTRAINT planning_task_exclusions_team_key_check
        CHECK (team_key IS NULL OR team_key ~ '^(team|solo)_[0-9]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS planning_task_exclusions_active_all_teams_uidx
    ON public.planning_task_exclusions (open_task_id, planning_date)
    WHERE exclusion_scope = 'all_teams' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS planning_task_exclusions_active_team_uidx
    ON public.planning_task_exclusions (open_task_id, planning_date, team_key)
    WHERE exclusion_scope = 'team' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS planning_task_exclusions_team_day_idx
    ON public.planning_task_exclusions (branch_id, planning_date, team_key, open_task_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS planning_task_exclusions_task_history_idx
    ON public.planning_task_exclusions (open_task_id, planning_date DESC, created_at DESC);

COMMENT ON TABLE public.planning_task_exclusions IS
    'Dated planning decisions. all_teams defers one task for the whole branch day; team rejects it only for one scheduled team on that day.';
COMMENT ON COLUMN public.planning_task_exclusions.exclusion_scope IS
    'all_teams | team. This is independent from clients.do_not_contact and clients.cooldown_until.';
COMMENT ON COLUMN public.planning_task_exclusions.operation_id IS
    'The operation that created the immutable exclusion decision.';
COMMENT ON COLUMN public.planning_task_exclusions.revoked_operation_id IS
    'The later restore operation, when the decision was revoked.';

-- Preserve the live meaning of the legacy scalar column during the transition:
-- legacy exclusions are day-wide task deferrals, never team-only decisions.
INSERT INTO public.planning_task_exclusions (
    open_task_id,
    branch_id,
    planning_date,
    exclusion_scope,
    team_key,
    team_snapshot,
    reason_code,
    reason_text,
    created_at
)
SELECT
    ot.id,
    ot.branch_id,
    ot.excluded_for_date,
    'all_teams',
    NULL,
    NULL,
    'legacy_day_exclusion',
    ot.excluded_reason,
    COALESCE(ot.updated_at, NOW())
FROM public.open_tasks ot
WHERE ot.excluded_for_date IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
