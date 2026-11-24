-- ============================================================
-- 505_team_types.sql
-- ============================================================
-- DEC-026 (2026-11-23): admin-defined team types.
--
-- Until now day_schedules knew two hard-coded team shapes: the standard team
-- (supervisor + technician + telemarketers) and the emergency team
-- (technician + telemarketers, emergency_maintenance only — DEC-006 D31).
-- This migration adds the catalog that replaces them. It does NOT touch
-- day_schedules yet; the schedule switches to typed teams in a later phase.
--
--   team_types             company-wide catalog (D1)
--   team_type_slots        positions in a type, each with one function (D3/D4)
--   team_type_slot_roles   roles accepted in a slot (a slot accepts several)
--   team_type_task_types   task types the type may be assigned (D5)
--   branch_team_types      types a branch has enabled for its scheduling (D2)
--
-- The two seeded types reproduce today's behaviour exactly. The unused
-- trainee position is not carried over (no role was ever bound to it and no
-- scheduled day used it).
--
-- The permission planning.team_types.manage is defined and granted to nobody;
-- grants are the product owner's call.
-- ============================================================

-- ── 1) Catalog ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_types (
  id           SERIAL PRIMARY KEY,
  -- Stable code. The two seeded types are 'standard' and 'emergency'; code
  -- never branches on any other key.
  key          VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  -- Seeded types cannot be deactivated; their behaviour backs existing days.
  is_system    BOOLEAN      NOT NULL DEFAULT FALSE,
  -- A type used on any day is never deleted, only deactivated (DEC-026 §3).
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  created_by   INTEGER      REFERENCES public.hr_users(id),
  updated_by   INTEGER      REFERENCES public.hr_users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT team_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  CONSTRAINT team_types_system_active CHECK (NOT is_system OR is_active)
);

-- ── 2) Slots ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_type_slots (
  id                SERIAL PRIMARY KEY,
  team_type_id      INTEGER      NOT NULL REFERENCES public.team_types(id) ON DELETE CASCADE,
  -- Key of the slot inside the type; the schedule stores members under it.
  slot_key          VARCHAR(50)  NOT NULL,
  label             VARCHAR(100) NOT NULL,
  -- D4: lead (one per type), field (goes on the visit), caller (call list).
  slot_function     VARCHAR(20)  NOT NULL,
  -- D4: clients personally owned by this slot's members enter the team load.
  counts_ownership  BOOLEAN      NOT NULL DEFAULT FALSE,
  -- min_members >= 1 means the slot is required. max_members NULL = no cap.
  min_members       INTEGER      NOT NULL DEFAULT 0,
  max_members       INTEGER,
  sort_order        INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT team_type_slots_key_unique UNIQUE (team_type_id, slot_key),
  CONSTRAINT team_type_slots_key_format CHECK (slot_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  CONSTRAINT team_type_slots_function CHECK (slot_function IN ('lead', 'field', 'caller')),
  CONSTRAINT team_type_slots_counts CHECK (
    min_members >= 0 AND (max_members IS NULL OR max_members >= GREATEST(min_members, 1))
  ),
  -- The lead is exactly one person, required, and owns (D4).
  CONSTRAINT team_type_slots_lead_shape CHECK (
    slot_function <> 'lead'
    OR (min_members = 1 AND max_members = 1 AND counts_ownership)
  ),
  -- Callers never own (PL-R014).
  CONSTRAINT team_type_slots_caller_no_ownership CHECK (
    slot_function <> 'caller' OR NOT counts_ownership
  )
);

-- One lead per type (D4).
CREATE UNIQUE INDEX IF NOT EXISTS team_type_slots_one_lead
  ON public.team_type_slots (team_type_id)
  WHERE slot_function = 'lead';

CREATE TABLE IF NOT EXISTS public.team_type_slot_roles (
  slot_id  INTEGER NOT NULL REFERENCES public.team_type_slots(id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (slot_id, role_id)
);
CREATE INDEX IF NOT EXISTS team_type_slot_roles_role ON public.team_type_slot_roles (role_id);

-- ── 3) Allowed task types (D5) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_type_task_types (
  team_type_id  INTEGER     NOT NULL REFERENCES public.team_types(id) ON DELETE CASCADE,
  task_type     VARCHAR(50) NOT NULL REFERENCES public.task_type_config(task_type) ON UPDATE CASCADE,
  PRIMARY KEY (team_type_id, task_type)
);
CREATE INDEX IF NOT EXISTS team_type_task_types_task ON public.team_type_task_types (task_type);

-- ── 4) Branch selection (D2) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.branch_team_types (
  branch_id     INTEGER     NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  team_type_id  INTEGER     NOT NULL REFERENCES public.team_types(id) ON DELETE CASCADE,
  enabled_by    INTEGER     REFERENCES public.hr_users(id),
  enabled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (branch_id, team_type_id)
);
CREATE INDEX IF NOT EXISTS branch_team_types_type ON public.branch_team_types (team_type_id);

-- ── 5) Seed: the two existing shapes ────────────────────────────────────────
INSERT INTO public.team_types (key, name, description, is_system, sort_order)
VALUES
  ('standard',  'فريق قياسي', 'مشرف وفني ومسوقون. يستلم كل أنواع المهام.', TRUE, 10),
  ('emergency', 'فريق طوارئ', 'فني ومسوقون. يستلم الصيانة الطارئة فقط (DEC-006 D31).', TRUE, 20)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.team_type_slots
  (team_type_id, slot_key, label, slot_function, counts_ownership, min_members, max_members, sort_order)
SELECT tt.id, s.slot_key, s.label, s.slot_function, s.counts_ownership, s.min_members, s.max_members, s.sort_order
FROM public.team_types tt
JOIN (VALUES
  ('standard',  'supervisor',    'مشرف',    'lead',   TRUE,  1, 1,    10),
  ('standard',  'technician',    'فني',     'field',  TRUE,  1, 1,    20),
  ('standard',  'telemarketers', 'مسوقون',  'caller', FALSE, 0, NULL, 30),
  ('emergency', 'technician',    'فني',     'lead',   TRUE,  1, 1,    10),
  ('emergency', 'telemarketers', 'مسوقون',  'caller', FALSE, 0, NULL, 20)
) AS s(type_key, slot_key, label, slot_function, counts_ownership, min_members, max_members, sort_order)
  ON s.type_key = tt.key
ON CONFLICT (team_type_id, slot_key) DO NOTHING;

-- Accepted roles: whatever roles carry the matching legacy team_slot_type.
INSERT INTO public.team_type_slot_roles (slot_id, role_id)
SELECT s.id, r.id
FROM public.team_type_slots s
JOIN public.team_types tt ON tt.id = s.team_type_id
JOIN public.roles r ON r.team_slot_type = CASE s.slot_key
    WHEN 'supervisor'    THEN 'SUPERVISOR'
    WHEN 'technician'    THEN 'TECHNICIAN'
    WHEN 'telemarketers' THEN 'TELEMARKETER'
  END
WHERE tt.key IN ('standard', 'emergency')
ON CONFLICT DO NOTHING;

-- Allowed task types: standard = every configured type; emergency = emergency_maintenance.
INSERT INTO public.team_type_task_types (team_type_id, task_type)
SELECT tt.id, ttc.task_type
FROM public.team_types tt
JOIN public.task_type_config ttc
  ON tt.key = 'standard' OR (tt.key = 'emergency' AND ttc.task_type = 'emergency_maintenance')
WHERE tt.key IN ('standard', 'emergency')
ON CONFLICT DO NOTHING;

-- Every branch keeps both shapes it has today.
INSERT INTO public.branch_team_types (branch_id, team_type_id)
SELECT b.id, tt.id
FROM public.branches b
CROSS JOIN public.team_types tt
WHERE tt.key IN ('standard', 'emergency')
ON CONFLICT DO NOTHING;

-- ── 6) Permission — defined, granted to nobody ──────────────────────────────
INSERT INTO public.permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES ('planning.team_types.manage', 'planning', 'team_types', 'manage',
        'إدارة أنواع الفرق (الخانات والأدوار والمهام المسموحة)', 154, ARRAY['GLOBAL']::text[])
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  sub_module = EXCLUDED.sub_module,
  action = EXCLUDED.action,
  display_name = EXCLUDED.display_name,
  display_order = EXCLUDED.display_order,
  allowed_scopes = EXCLUDED.allowed_scopes;
