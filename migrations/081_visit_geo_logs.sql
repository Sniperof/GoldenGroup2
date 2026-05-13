-- Migration 081: visit_geo_logs — GPS start/end tracking for field visits

CREATE TABLE visit_geo_logs (
    id SERIAL PRIMARY KEY,
    visit_id INTEGER NOT NULL UNIQUE REFERENCES field_visits(id) ON DELETE CASCADE,
    actual_start_time TIMESTAMP,
    actual_start_lat DECIMAL(10,8),
    actual_start_lng DECIMAL(11,8),
    actual_start_accuracy INTEGER,
    actual_end_time TIMESTAMP,
    actual_end_lat DECIMAL(10,8),
    actual_end_lng DECIMAL(11,8),
    actual_end_accuracy INTEGER,
    duration_minutes INTEGER,
    distance_meters INTEGER,
    location_missing BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_visit_geo_logs_visit ON visit_geo_logs(visit_id);
