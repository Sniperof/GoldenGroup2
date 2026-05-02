-- Open Tasks: marketing and service tasks linked to clients, before visits
CREATE TABLE open_tasks (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    task_type VARCHAR(50) NOT NULL DEFAULT 'device_demo',
    task_family VARCHAR(50) NOT NULL DEFAULT 'marketing',
    reason VARCHAR(100) NOT NULL DEFAULT 'new_lead',
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    due_date DATE,
    priority VARCHAR(20),
    source VARCHAR(50) NOT NULL DEFAULT 'system',
    marketing_visit_task_id VARCHAR(100),  -- link to visit task when converted
    contact_target_id INTEGER,              -- link to contact target when queued
    notes TEXT,
    created_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate open task of same type for same client
CREATE UNIQUE INDEX idx_open_tasks_unique_active 
    ON open_tasks (client_id, task_type) 
    WHERE status IN ('open', 'in_contact_list', 'scheduled', 'in_visit', 'needs_reschedule');

-- Indexes for common queries
CREATE INDEX idx_open_tasks_branch_status ON open_tasks (branch_id, status);
CREATE INDEX idx_open_tasks_client ON open_tasks (client_id);
CREATE INDEX idx_open_tasks_type_status ON open_tasks (task_type, status);

-- Status check constraint
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_status_check 
    CHECK (status IN ('open', 'in_contact_list', 'scheduled', 'in_visit', 'completed', 'cancelled', 'needs_reschedule'));

-- Task type check (starts with device_demo only, expand later)
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_task_type_check 
    CHECK (task_type IN ('device_demo'));

-- Task family check
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_task_family_check 
    CHECK (task_family IN ('marketing', 'service', 'maintenance'));

-- Reason check
ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_reason_check 
    CHECK (reason IN ('new_lead', 'follow_up', 'renewal', 'service_request', 'other'));

COMMENT ON TABLE open_tasks IS 'Open marketing/service tasks linked to clients before they become visits';
COMMENT ON COLUMN open_tasks.status IS 'open=in_queue, in_contact_list=queued_for_call, scheduled=appointment_set, in_visit=visit_created, completed=done, cancelled=cancelled, needs_reschedule=reschedule_needed';