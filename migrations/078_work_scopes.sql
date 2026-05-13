-- Migration 078: work_scopes — daily work scope container per team

CREATE TABLE work_scopes (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL,
    date DATE NOT NULL,
    team_key VARCHAR(50) NOT NULL,
    zone_ids INTEGER[] DEFAULT '{}',
    scope_type VARCHAR(50) DEFAULT 'mixed',
    status VARCHAR(50) DEFAULT 'draft',
    generated_at TIMESTAMP DEFAULT NOW(),
    generated_by INTEGER,
    UNIQUE(date, team_key, branch_id)
);

CREATE INDEX idx_work_scopes_date ON work_scopes(date);
CREATE INDEX idx_work_scopes_team ON work_scopes(team_key, branch_id);
