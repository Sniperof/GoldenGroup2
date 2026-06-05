-- ============================================================
-- 252_migrate_emergency_tickets.sql
-- ============================================================
-- Phase 7 — Data migration: emergency_tickets → service_requests.
--
-- Per maintenance.md §٠.٩ + implementation-plan Phase 7:
--   - Every existing emergency_ticket gets a paired service_request row
--     for historical/reporting access.
--   - The migrated rows are ARCHIVED immediately (archived_at = NOW())
--     so they do NOT participate in active dashboards or duplicate
--     detection.
--   - **open_tasks.source_service_request_id is intentionally NOT set**
--     on migrated rows. Reason: the wizard dispatches new-path UX when
--     this column is non-NULL, but migrated tasks have their result in
--     the LEGACY em_* tables (no service_request_problems list, no
--     derived_outcome possible). Flipping them would break the wizard
--     for historical tasks.
--   - public_ref_number uses SRM- prefix (Service Request Migrated) to
--     stay traceable to the source ticket and avoid colliding with
--     naturally generated SR-YYYYMMDD-NNNN numbers.
--   - service_request_problems are created ON BEST-EFFORT: one row per
--     ticket only when an active installed_device for the client can be
--     resolved. Otherwise the service_request is created without a
--     problems list (legacy tickets had no structured problem list).
--
-- IDEMPOTENT: NOT EXISTS guard skips tickets already migrated.
-- Safe to re-run.
--
-- VERIFICATION queries appended at the bottom; uncomment to log.
-- ============================================================

BEGIN;

-- Step 1 — Create one service_request per emergency_ticket not yet migrated.
INSERT INTO public.service_requests (
  public_ref_number,
  channel,
  submission_type,
  submitter_tier,
  beneficiary_client_id,
  beneficiary_external,
  contract_id,
  problem_description,
  requested_action_type_id,
  attachments,
  priority,
  status,
  triage_outcome,
  linked_open_task_id,
  branch_id,
  archived_at,
  archived_by_user_id,
  closed_at,
  created_at,
  updated_at
)
SELECT
  'SRM-' || LPAD(et.id::text, 8, '0') AS public_ref_number,
  'phone' AS channel,
  'apply' AS submission_type,
  'staff' AS submitter_tier,
  et.client_id AS beneficiary_client_id,
  CASE
    WHEN et.client_name IS NOT NULL OR et.client_address IS NOT NULL THEN
      jsonb_build_object(
        'name', et.client_name,
        'address_snapshot', et.client_address,
        'rating_snapshot', et.client_rating,
        'migration_source', 'emergency_tickets',
        'source_ticket_id', et.id
      )
    ELSE NULL
  END AS beneficiary_external,
  et.contract_id,
  COALESCE(et.problem_description, '(no description — migrated)') AS problem_description,
  et.action_type_id AS requested_action_type_id,
  COALESCE(et.attachments, '[]'::jsonb) AS attachments,
  CASE
    WHEN et.priority IN ('Critical', 'High', 'Normal', 'Low') THEN et.priority
    ELSE 'Normal'
  END AS priority,
  'promoted' AS status,
  'needs_field_intervention' AS triage_outcome,
  et.open_task_id AS linked_open_task_id,
  c.branch_id,
  NOW() AS archived_at,
  NULL AS archived_by_user_id,
  et.created_at AS closed_at,
  et.created_at AS created_at,
  NOW() AS updated_at
FROM public.emergency_tickets et
LEFT JOIN public.clients c ON c.id = et.client_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_requests sr
   WHERE sr.public_ref_number = 'SRM-' || LPAD(et.id::text, 8, '0')
);

-- Step 2 — Best-effort service_request_problems: one row per migrated
-- ticket where the customer has at least one resolvable installed_device.
-- Picks the first active device per client.
INSERT INTO public.service_request_problems (
  service_request_id,
  open_task_id,
  installed_device_id,
  problem_type_id,
  details,
  status,
  added_during_phase,
  creator_role_snapshot,
  created_by_user_id,
  created_at,
  resolved_at,
  updated_at
)
SELECT
  sr.id AS service_request_id,
  sr.linked_open_task_id AS open_task_id,
  dev.id AS installed_device_id,
  COALESCE(
    (SELECT id FROM public.system_lists
       WHERE category = 'diagnosis_problem_types' AND value = 'أخرى'
       LIMIT 1),
    -- Hard fallback: if 'أخرى' was not seeded for some reason, take any
    -- diagnosis_problem_types entry (the migration becomes a no-op for
    -- environments without seeds rather than failing).
    (SELECT id FROM public.system_lists
       WHERE category = 'diagnosis_problem_types' LIMIT 1)
  ) AS problem_type_id,
  -- Pack the original textual description into details for searchability.
  COALESCE(et.problem_description, '(no description)') AS details,
  -- Migrated tickets land as 'reported'. If the open_task is completed
  -- in em_costs with final_decision='resolved', we mark it 'resolved'.
  CASE
    WHEN erc.final_decision = 'resolved' THEN 'resolved'
    WHEN erc.final_decision = 'cancelled' THEN 'cancelled'
    ELSE 'reported'
  END AS status,
  'intake' AS added_during_phase,
  'system_migration' AS creator_role_snapshot,
  -- created_by_user_id is NOT NULL; use the SYSTEM_ADMIN id as a
  -- catch-all. If your env uses a different super-admin id, override.
  (SELECT MIN(id) FROM public.hr_users WHERE is_super_admin = true)
    AS created_by_user_id,
  sr.created_at,
  CASE WHEN erc.final_decision = 'resolved' THEN sr.created_at ELSE NULL END
    AS resolved_at,
  NOW() AS updated_at
FROM public.service_requests sr
JOIN public.emergency_tickets et
  ON sr.public_ref_number = 'SRM-' || LPAD(et.id::text, 8, '0')
JOIN LATERAL (
  SELECT id FROM public.installed_devices
   WHERE customer_id = et.client_id
   ORDER BY (status = 'active') DESC, id ASC
   LIMIT 1
) dev ON true
LEFT JOIN public.emergency_result_costs erc
  ON erc.open_task_id = sr.linked_open_task_id
WHERE EXISTS (
  -- Only run if a diagnosis_problem_types seed exists.
  SELECT 1 FROM public.system_lists
   WHERE category = 'diagnosis_problem_types' LIMIT 1
)
AND NOT EXISTS (
  -- Idempotent guard: skip if a problem for this open_task already exists
  -- (i.e. previous run already inserted, or the task acquired problems
  -- via the live new-path flow).
  SELECT 1 FROM public.service_request_problems p
   WHERE p.service_request_id = sr.id
);

-- Step 3 — Audit-log event for traceability (one entry per migrated SR).
INSERT INTO public.service_request_audit_log (
  service_request_id,
  event_type,
  event_payload,
  actor_user_id,
  actor_role,
  note,
  created_at
)
SELECT
  sr.id,
  'request_created',
  jsonb_build_object(
    'migrated_from', 'emergency_tickets',
    'source_ticket_id', (
      SELECT et.id FROM public.emergency_tickets et
       WHERE 'SRM-' || LPAD(et.id::text, 8, '0') = sr.public_ref_number
    ),
    'archived_immediately', true
  ),
  NULL,
  'system',
  'Phase 7 migration: created from legacy emergency_tickets row',
  sr.created_at
FROM public.service_requests sr
WHERE sr.public_ref_number LIKE 'SRM-%'
  AND NOT EXISTS (
    SELECT 1 FROM public.service_request_audit_log al
     WHERE al.service_request_id = sr.id
       AND al.event_type = 'request_created'
  );

-- ── Verification (optional — uncomment to log counts) ─────────────────────
-- DO $$
-- DECLARE
--   tickets_total INTEGER;
--   migrated_total INTEGER;
--   problems_total INTEGER;
-- BEGIN
--   SELECT COUNT(*) INTO tickets_total FROM emergency_tickets;
--   SELECT COUNT(*) INTO migrated_total FROM service_requests
--    WHERE public_ref_number LIKE 'SRM-%';
--   SELECT COUNT(*) INTO problems_total FROM service_request_problems p
--    JOIN service_requests sr ON sr.id = p.service_request_id
--    WHERE sr.public_ref_number LIKE 'SRM-%';
--   RAISE NOTICE 'Phase 7 migration: % tickets, % migrated SRs, % problems',
--     tickets_total, migrated_total, problems_total;
-- END $$;

COMMIT;
