-- Migration 116: Emergency maintenance result — 4-phase system + device technical history
--
-- Architecture:
--   Phase 1 (pre)  → device_technical_states (phase='pre',  linked to contract + open_task)
--   Phase 2        → emergency_maintenance_actions (what was done + parts)
--   Phase 3 (post) → device_technical_states (phase='post', linked to contract + open_task)
--   Phase 4        → emergency_result_costs (financial summary + final decision)
--
-- Device history: query device_technical_states WHERE contract_id = X ORDER BY created_at
-- to see the full lifecycle of readings across all maintenance visits.

-- ── 1. Device-level technical state (core history table) ─────────────────────
CREATE TABLE IF NOT EXISTS device_technical_states (
  id SERIAL PRIMARY KEY,

  -- linkage
  contract_id  INTEGER REFERENCES contracts(id)  ON DELETE SET NULL,
  open_task_id INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL,
  phase        VARCHAR(10) NOT NULL CHECK (phase IN ('pre', 'post', 'standalone')),

  -- Water source
  water_source_type       VARCHAR(20),  -- رئيسية / خزان
  water_source_tds        NUMERIC,      -- عيار مصدر المياه (ppm)
  water_pressure          VARCHAR(20),  -- قوي / ضعيف / وسط / جيد
  has_pressure_regulator  BOOLEAN,      -- وجود كاسر

  -- Device readings
  tap_tds_before       NUMERIC,  -- عيار مي حنفية الجهاز (قبل)
  pump_pressure        NUMERIC,  -- ضغط المضخة
  membrane_output_tds  NUMERIC,  -- خرج الميمبرين
  membrane_input_tds   NUMERIC,  -- دخل الميمبرين
  membrane_flow        VARCHAR(20),  -- جيد / ضعيف / وسط
  flow_cup_size        INTEGER,      -- 300 / 450
  -- membrane_efficiency computed = (1 - output/input)*100

  -- Sterilization
  sterilization_transformer  VARCHAR(20),  -- يعمل / لايعمل
  uv_lamp                    VARCHAR(20),  -- يعمل / لايعمل
  sterilization_sleeve       VARCHAR(20),  -- يعمل / لايعمل

  -- Pressure & tank
  high_pressure_tds     NUMERIC,      -- عيار الهاي برشر
  low_pressure_switch   VARCHAR(20),  -- يعمل / لايعمل
  tank_tds              NUMERIC,      -- عيار الخزان

  -- Device config
  valve_type         VARCHAR(20),  -- ميكانيك / كهرباء
  pump_transformer   VARCHAR(20),  -- 3 امبير / 1.5 امبير
  has_fifth_tap      VARCHAR(20),  -- موجود / الغاء
  device_connection  VARCHAR(20),  -- تشالنجر / ro

  additional_notes TEXT,
  recorded_by      INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dts_contract  ON device_technical_states(contract_id);
CREATE INDEX IF NOT EXISTS idx_dts_task      ON device_technical_states(open_task_id);
CREATE INDEX IF NOT EXISTS idx_dts_phase     ON device_technical_states(phase);

-- ── 2. Maintenance actions (Phase 2) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_maintenance_actions (
  id                   SERIAL PRIMARY KEY,
  open_task_id         INTEGER NOT NULL REFERENCES open_tasks(id)      ON DELETE CASCADE,
  action_type_id       INTEGER          REFERENCES emergency_action_types(id) ON DELETE SET NULL,
  actions_taken        TEXT,    -- وصف ما تم
  parts_used           JSONB NOT NULL DEFAULT '[]'::jsonb,
  technician_notes     TEXT,
  recorded_by          INTEGER  REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (open_task_id)
);

-- ── 3. Result costs + final decision (Phase 4) ────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_result_costs (
  id               SERIAL PRIMARY KEY,
  open_task_id     INTEGER NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
  final_decision   VARCHAR(50) NOT NULL CHECK (final_decision IN ('resolved','partially_resolved','unresolved','needs_followup','cancelled')),
  closing_notes    TEXT,
  labor_cost       NUMERIC DEFAULT 0,
  parts_cost       NUMERIC DEFAULT 0,
  total_cost       NUMERIC DEFAULT 0,
  payment_method   VARCHAR(50),
  collected_amount NUMERIC DEFAULT 0,
  invoice_notes    TEXT,
  recorded_by      INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (open_task_id)
);

-- ── 4. Link phases to open_task (convenience columns) ─────────────────────────
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS em_pre_state_id  INTEGER REFERENCES device_technical_states(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS em_post_state_id INTEGER REFERENCES device_technical_states(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS em_action_id     INTEGER REFERENCES emergency_maintenance_actions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS em_costs_id      INTEGER REFERENCES emergency_result_costs(id) ON DELETE SET NULL;
