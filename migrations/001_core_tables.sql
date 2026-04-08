-- ============================================================
-- Migration 001: Core CRM tables (complete final schema)
-- All CREATE TABLE statements are IF NOT EXISTS — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS geo_units (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  level     INTEGER      NOT NULL,
  parent_id INTEGER REFERENCES geo_units(id) ON DELETE CASCADE
);

-- Final column set includes job_title, branch, residence, created_at
-- (originally added via ALTER TABLE in later migrations)
CREATE TABLE IF NOT EXISTS employees (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  role       VARCHAR(50)  NOT NULL CHECK (role IN ('supervisor', 'technician', 'telemarketer')),
  mobile     VARCHAR(50)  NOT NULL,
  branch     VARCHAR(255),
  residence  VARCHAR(255),
  status     VARCHAR(50)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'leave', 'inactive')),
  job_title  VARCHAR(255),
  avatar     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Final column set includes first_name/last_name/occupation/water_source/notes/rating/referrers
-- (originally added via ALTER TABLE in createPermissionsTables)
CREATE TABLE IF NOT EXISTS clients (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  mobile               VARCHAR(50)  NOT NULL,
  contacts             JSONB DEFAULT '[]',
  governorate          VARCHAR(255) DEFAULT '',
  district             VARCHAR(255) DEFAULT '',
  neighborhood         VARCHAR(255) DEFAULT '',
  detailed_address     TEXT,
  gps_coordinates      JSONB,
  source_channel       VARCHAR(255),
  referrer_type        VARCHAR(255),
  referrer_id          INTEGER,
  referrer_name        VARCHAR(255),
  referral_entity_id   INTEGER,
  referral_date        VARCHAR(50),
  referral_reason      TEXT,
  referral_sheet_id    INTEGER,
  referral_address_text TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  is_candidate         BOOLEAN DEFAULT FALSE,
  target_client        VARCHAR(255),
  candidate_status     VARCHAR(50),
  -- columns added in createPermissionsTables
  first_name           VARCHAR(255),
  father_name          VARCHAR(255),
  last_name            VARCHAR(255),
  nickname             VARCHAR(255),
  occupation           VARCHAR(255),
  water_source         VARCHAR(255),
  notes                TEXT,
  rating               VARCHAR(50),
  referrers            JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS referral_sheets (
  id                     SERIAL PRIMARY KEY,
  referral_type          VARCHAR(100) NOT NULL,
  referral_entity_id     INTEGER,
  referral_name_snapshot VARCHAR(255),
  referral_address_text  TEXT,
  referral_origin_channel VARCHAR(100),
  referral_notes         TEXT,
  referral_date          VARCHAR(50),
  owner_user_id          INTEGER NOT NULL,
  status                 VARCHAR(50) DEFAULT 'New' CHECK (status IN ('New', 'In-Progress', 'Completed', 'Archived')),
  total_candidates       INTEGER DEFAULT 0,
  quality_percentage     REAL    DEFAULT 0,
  conversion_percentage  REAL    DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  created_by             INTEGER
);

CREATE TABLE IF NOT EXISTS candidates (
  id                          SERIAL PRIMARY KEY,
  first_name                  VARCHAR(255),
  last_name                   VARCHAR(255),
  nickname                    VARCHAR(255),
  mobile                      VARCHAR(50) NOT NULL,
  contacts                    JSONB DEFAULT '[]',
  address_text                TEXT,
  geo_unit_id                 INTEGER,
  owner_user_id               INTEGER,
  status                      VARCHAR(50) DEFAULT 'Suggested'
                                CHECK (status IN ('New', 'Suggested', 'FollowUp', 'Contacted', 'Qualified', 'Junk')),
  referral_sheet_id           INTEGER REFERENCES referral_sheets(id) ON DELETE SET NULL,
  referral_date               VARCHAR(50),
  referral_reason             TEXT,
  referral_type               VARCHAR(100),
  referral_origin_channel     VARCHAR(100),
  referral_name_snapshot      VARCHAR(255),
  referral_entity_id          INTEGER,
  referral_confirmation_status VARCHAR(50) DEFAULT 'Pending',
  occupation                  VARCHAR(255),
  candidate_notes             TEXT,
  duplicate_flag              BOOLEAN DEFAULT FALSE,
  duplicate_type              VARCHAR(50),
  duplicate_reference_id      INTEGER,
  converted_to_lead_id        INTEGER,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  created_by                  INTEGER
);

CREATE TABLE IF NOT EXISTS routes (
  id     SERIAL PRIMARY KEY,
  name   VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS route_points (
  id          SERIAL PRIMARY KEY,
  route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  geo_unit_id INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  point_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  type          VARCHAR(50) NOT NULL
                  CHECK (type IN ('emergency', 'dues', 'periodic', 'returns', 'followup')),
  customer_name VARCHAR(255) NOT NULL,
  context       TEXT,
  location      VARCHAR(255),
  due_date      DATE,
  status        VARCHAR(50) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in-progress', 'completed')),
  priority      VARCHAR(50) CHECK (priority IN ('high', 'medium', 'low'))
);

CREATE TABLE IF NOT EXISTS device_models (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  brand                VARCHAR(255),
  category             VARCHAR(50) CHECK (category IN ('Residential', 'Industrial', 'Commercial')),
  maintenance_interval VARCHAR(50),
  base_price           NUMERIC DEFAULT 0,
  supported_visit_types JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS spare_parts (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  code                 VARCHAR(100),
  base_price           NUMERIC DEFAULT 0,
  maintenance_type     VARCHAR(50) CHECK (maintenance_type IN ('Periodic', 'Emergency', 'Accessory')),
  compatible_device_ids JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS contracts (
  id                 SERIAL PRIMARY KEY,
  contract_number    VARCHAR(100) UNIQUE,
  customer_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  customer_name      VARCHAR(255),
  contract_date      VARCHAR(50),
  source_visit       VARCHAR(255),
  device_model_id    INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  device_model_name  VARCHAR(255),
  serial_number      VARCHAR(255),
  maintenance_plan   VARCHAR(10),
  base_price         NUMERIC DEFAULT 0,
  final_price        NUMERIC DEFAULT 0,
  payment_type       VARCHAR(50) DEFAULT 'cash',
  down_payment       NUMERIC DEFAULT 0,
  installments_count INTEGER DEFAULT 0,
  delivery_date      VARCHAR(50),
  installation_date  VARCHAR(50),
  status             VARCHAR(50) DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dues (
  id                      SERIAL PRIMARY KEY,
  contract_id             INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  type                    VARCHAR(50) NOT NULL,
  scheduled_date          VARCHAR(50),
  adjusted_date           VARCHAR(50),
  original_amount         NUMERIC DEFAULT 0,
  remaining_balance       NUMERIC DEFAULT 0,
  assigned_telemarketer_id INTEGER,
  status                  VARCHAR(50) DEFAULT 'Pending'
                            CHECK (status IN ('Pending', 'Partial', 'Paid', 'Overdue')),
  escalated               BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id                 SERIAL PRIMARY KEY,
  request_date       TIMESTAMPTZ,
  customer_id        INTEGER,
  customer_name      VARCHAR(255),
  contract_id        INTEGER,
  device_model_name  VARCHAR(255),
  priority           VARCHAR(50) DEFAULT 'Normal',
  problem_description TEXT,
  technician_id      INTEGER,
  telemarketer_id    INTEGER,
  last_follow_up_date TIMESTAMPTZ,
  resolution_status  VARCHAR(50) DEFAULT 'Pending',
  visit_type         VARCHAR(50),
  location           VARCHAR(255),
  notes              TEXT,
  technical_report   JSONB
);

CREATE TABLE IF NOT EXISTS visits (
  id            VARCHAR(100) PRIMARY KEY,
  date          VARCHAR(50),
  customer_id   INTEGER,
  employee_id   INTEGER,
  employee_name VARCHAR(255),
  outcome       VARCHAR(50) DEFAULT 'Pending'
                  CHECK (outcome IN ('Pending', 'Completed', 'Cancelled')),
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS day_schedules (
  date  VARCHAR(50) PRIMARY KEY,
  teams JSONB DEFAULT '[]',
  solos JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS route_assignments (
  key         VARCHAR(255) PRIMARY KEY,
  routes      JSONB DEFAULT '[]',
  extra_zones JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS emergency_tickets (
  id                   SERIAL PRIMARY KEY,
  client_id            INTEGER NOT NULL,
  client_name          VARCHAR(255) NOT NULL,
  client_address       TEXT,
  client_rating        VARCHAR(50) DEFAULT 'Undefined',
  contract_id          INTEGER,
  device_model_name    VARCHAR(255),
  problem_description  TEXT NOT NULL,
  call_notes           TEXT,
  attachments          JSONB DEFAULT '[]',
  call_receiver        VARCHAR(255) NOT NULL,
  priority             VARCHAR(50) DEFAULT 'Normal'
                         CHECK (priority IN ('Critical', 'High', 'Normal')),
  status               VARCHAR(50) DEFAULT 'New'
                         CHECK (status IN ('New', 'Assigned', 'In Progress', 'Completed', 'Cancelled')),
  assigned_technician_id INTEGER,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemarketing_task_lists (
  id         VARCHAR(100) PRIMARY KEY,
  team_key   VARCHAR(100) NOT NULL,
  date       VARCHAR(50)  NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_key, date)
);

CREATE TABLE IF NOT EXISTS telemarketing_task_list_items (
  id            VARCHAR(100) PRIMARY KEY,
  task_list_id  VARCHAR(100) NOT NULL REFERENCES telemarketing_task_lists(id) ON DELETE CASCADE,
  entity_type   VARCHAR(20)  NOT NULL CHECK (entity_type IN ('candidate', 'client')),
  entity_id     INTEGER NOT NULL,
  name          VARCHAR(255) NOT NULL,
  mobile        VARCHAR(50)  NOT NULL,
  contact_number VARCHAR(50),
  contact_label  VARCHAR(255),
  address_text   TEXT,
  geo_unit_id    INTEGER,
  status         VARCHAR(20) DEFAULT 'pending'
                   CHECK (status IN ('pending', 'called', 'booked')),
  call_outcome   VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS telemarketing_call_logs (
  id                   VARCHAR(100) PRIMARY KEY,
  entity_type          VARCHAR(20) NOT NULL CHECK (entity_type IN ('candidate', 'client')),
  entity_id            INTEGER NOT NULL,
  task_list_id         VARCHAR(100),
  team_key             VARCHAR(100) NOT NULL,
  outcome              VARCHAR(20) NOT NULL
                         CHECK (outcome IN ('no_answer', 'busy', 'rejected', 'booked')),
  contact_label        VARCHAR(255),
  contact_number       VARCHAR(50),
  notes                TEXT,
  timestamp            TIMESTAMPTZ DEFAULT NOW(),
  called_by            INTEGER,
  communication_method VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS telemarketing_appointments (
  id               VARCHAR(100) PRIMARY KEY,
  entity_type      VARCHAR(20) NOT NULL CHECK (entity_type IN ('candidate', 'client')),
  entity_id        INTEGER NOT NULL,
  customer_name    VARCHAR(255) NOT NULL,
  customer_address TEXT,
  customer_mobile  VARCHAR(50),
  team_key         VARCHAR(100) NOT NULL,
  date             VARCHAR(50)  NOT NULL,
  time_slot        VARCHAR(50)  NOT NULL,
  occupation       VARCHAR(255),
  water_source     VARCHAR(255),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  created_by       INTEGER
);

-- Final column set includes contact_info (added in createHrUsers)
CREATE TABLE IF NOT EXISTS branches (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  location_geo_id INTEGER REFERENCES geo_units(id),
  covered_geo_ids JSONB DEFAULT '[]',
  status          VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  contact_info    JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS system_lists (
  id            SERIAL PRIMARY KEY,
  category      VARCHAR(100) NOT NULL,
  value         VARCHAR(255) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_lists_category ON system_lists(category);
