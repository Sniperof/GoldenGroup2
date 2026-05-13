-- Migration 076: scope_tasks — bridge between open_tasks and work scopes

CREATE TABLE scope_tasks (
    id SERIAL PRIMARY KEY,
    scope_id INTEGER NOT NULL,
    open_task_id INTEGER NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
    team_key VARCHAR(50) NOT NULL,
    branch_id INTEGER NOT NULL,
    added_at TIMESTAMP DEFAULT NOW(),
    added_by INTEGER,
    UNIQUE(scope_id, open_task_id)
);

CREATE INDEX idx_scope_tasks_scope ON scope_tasks(scope_id);
CREATE INDEX idx_scope_tasks_open_task ON scope_tasks(open_task_id);
CREATE INDEX idx_scope_tasks_team_key ON scope_tasks(team_key, branch_id);
