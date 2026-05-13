-- Migration 079: client_audit_log + soft-delete columns on clients

CREATE TABLE client_audit_log (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    changed_by INTEGER,
    changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_client ON client_audit_log(client_id);
CREATE INDEX idx_audit_time ON client_audit_log(changed_at);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX idx_clients_active ON clients(deleted_at) WHERE deleted_at IS NULL;
