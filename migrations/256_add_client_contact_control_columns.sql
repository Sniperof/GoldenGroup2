-- Migration: Add DEC-005 contact-control columns to clients table
-- These columns are referenced in CLIENT_SELECT (routes/clients.ts) but were missing from the DB

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cooldown_reason TEXT,
    ADD COLUMN IF NOT EXISTS cooldown_set_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cooldown_set_at TIMESTAMP WITH TIME ZONE;

-- Add index for performance on cooldown filtering
CREATE INDEX IF NOT EXISTS idx_clients_cooldown_until ON clients(cooldown_until) WHERE cooldown_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_do_not_contact ON clients(do_not_contact) WHERE do_not_contact = TRUE;
