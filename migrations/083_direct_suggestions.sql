-- Migration 083: direct_suggestions — lightweight referral capture during visits

CREATE TABLE direct_suggestions (
    id SERIAL PRIMARY KEY,
    visit_task_id INTEGER NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    is_direct BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','contacted','converted')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_direct_suggestions_task ON direct_suggestions(visit_task_id);
CREATE INDEX idx_direct_suggestions_client ON direct_suggestions(client_id);
