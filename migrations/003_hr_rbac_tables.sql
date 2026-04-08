-- ============================================================
-- Migration 003: HR users, Roles, Permissions (RBAC)
-- ============================================================

-- Create hr_users if it doesn't exist (base columns only).
-- No CHECK constraint on role.
CREATE TABLE IF NOT EXISTS hr_users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(100) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- If hr_users already existed without role_id / employee_id, add them now
-- so the FK constraint and unique index below can reference them.
ALTER TABLE hr_users ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE hr_users ADD COLUMN IF NOT EXISTS role_id     INTEGER;  -- FK wired after roles table below

CREATE TABLE IF NOT EXISTS roles (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description  TEXT,
  is_system    BOOLEAN DEFAULT FALSE,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id            SERIAL PRIMARY KEY,
  key           VARCHAR(150) NOT NULL UNIQUE,
  module        VARCHAR(50)  NOT NULL,
  sub_module    VARCHAR(50)  NOT NULL,
  action        VARCHAR(50)  NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id            SERIAL PRIMARY KEY,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

-- Add FK from hr_users.role_id → roles.id now that roles table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'hr_users_role_id_fkey'
      AND table_name = 'hr_users'
  ) THEN
    ALTER TABLE hr_users
      ADD CONSTRAINT hr_users_role_id_fkey
      FOREIGN KEY (role_id) REFERENCES roles(id);
  END IF;
END $$;

-- Unique partial index: one account per employee (NULLs excluded)
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_users_employee_id
  ON hr_users(employee_id)
  WHERE employee_id IS NOT NULL;
