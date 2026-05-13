-- Migration 080: visit_sources — tracks why a client is in a field visit

CREATE TABLE visit_sources (
    id SERIAL PRIMARY KEY,
    visit_id INTEGER NOT NULL UNIQUE REFERENCES field_visits(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('supervisor','technician','both','company_branch','company_global')),
    source_label VARCHAR(255) NOT NULL,
    actor_employee_ids INTEGER[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_visit_sources_visit ON visit_sources(visit_id);
CREATE INDEX idx_visit_sources_type ON visit_sources(source_type);
