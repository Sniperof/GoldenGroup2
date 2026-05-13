-- Migration 082: visit_name_collections — tracks name-gathering tasks within visits

CREATE TABLE visit_name_collections (
    id SERIAL PRIMARY KEY,
    visit_task_id INTEGER NOT NULL UNIQUE REFERENCES visit_tasks(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),
    proposed_count INTEGER NOT NULL DEFAULT 0,
    actual_count INTEGER NOT NULL DEFAULT 0,
    referral_sheet_id INTEGER,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','partial','completed')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_visit_name_collections_task ON visit_name_collections(visit_task_id);
CREATE INDEX idx_visit_name_collections_status ON visit_name_collections(status);
