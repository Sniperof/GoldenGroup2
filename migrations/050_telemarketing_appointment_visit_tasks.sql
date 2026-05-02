-- Add visit tasks (JSONB), requested device model, and requested device name to telemarketing_appointments
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS visit_tasks JSONB DEFAULT '["device_demo"]'::jsonb;
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS requested_device_model_id INTEGER;
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS requested_device_name TEXT;

-- Update any existing TEXT visit_tasks to proper JSONB (safety for dev data)
-- This is a no-op if column was already JSONB from above
UPDATE telemarketing_appointments SET visit_tasks = '["device_demo"]'::jsonb WHERE visit_tasks IS NULL;