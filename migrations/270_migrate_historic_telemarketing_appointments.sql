-- 2026-06-10 — Phase 0 of telemarketing_appointments migration plan
-- (docs/constitution/plans/2026-06-10-telemarketing-appointments-migration.md)
--
-- Migrates the 3 historic rows from telemarketing_appointments into the new
-- field_visits + visit_tasks model. The booked dates are all 2026-05-24
-- (in the past as of today, 2026-06-10), and none of these appointments
-- were ever executed — so status is set to 'cancelled' rather than the
-- default 'scheduled' to avoid the dashboards displaying them as upcoming.
--
-- The original rows in telemarketing_appointments remain untouched (Phase 4
-- will freeze the table read-only). source_legacy_id on each new row points
-- back to the legacy UUID so we have full lineage.

BEGIN;

-- ─── samar domar almahmoud (entity_id=21, device_delivery, branch_id=2) ──────

WITH ins_fv AS (
  INSERT INTO field_visits (
    visit_type, visit_family, status,
    client_id, branch_id, scheduled_date, scheduled_time,
    team_snapshot, customer_snapshot,
    origin_type, origin_id,
    source_legacy_type, source_legacy_id,
    appointment_booked_at, booked_by_telemarketer_id,
    created_by, created_at, updated_at
  ) VALUES (
    'marketing', 'service', 'cancelled',
    21, 2, '2026-05-24'::date, '12:00',
    jsonb_build_object('teamKey', 'team_0'),
    jsonb_build_object(
      'name', 'samar domar almahmoud',
      'mobile', '0934133656',
      'occupation', null,
      'waterSource', null
    ),
    'telemarketing', '11ee2d61-a036-4238-b0f2-4fdb6b1725e7',
    'telemarketing_appointment', '11ee2d61-a036-4238-b0f2-4fdb6b1725e7',
    '2026-05-23 21:46:50.197+00'::timestamptz, 1,
    1, '2026-05-23 21:46:50.197+00'::timestamptz, NOW()
  )
  RETURNING id
)
INSERT INTO visit_tasks (
  field_visit_id, source_open_task_id,
  task_type, task_family, status, sequence_no,
  source_legacy_type, source_legacy_id
)
SELECT id, 1, 'device_delivery', 'service', 'cancelled', 1,
       'telemarketing_appointment_task', '11ee2d61-a036-4238-b0f2-4fdb6b1725e7:1'
FROM ins_fv;

-- ─── ماهر محمد حميد (entity_id=20, device_demo, branch_id=2) ──────────────────

WITH ins_fv AS (
  INSERT INTO field_visits (
    visit_type, visit_family, status,
    client_id, branch_id, scheduled_date, scheduled_time,
    team_snapshot, customer_snapshot,
    origin_type, origin_id,
    source_legacy_type, source_legacy_id,
    appointment_booked_at, booked_by_telemarketer_id,
    created_by, created_at, updated_at
  ) VALUES (
    'marketing', 'marketing', 'cancelled',
    20, 2, '2026-05-24'::date, '13:00',
    jsonb_build_object('teamKey', 'team_0'),
    jsonb_build_object(
      'name', 'ماهر محمد حميد',
      'mobile', '0947116115',
      'occupation', null,
      'waterSource', 'الاسالة الحكومية'
    ),
    'telemarketing', '31b699cc-7709-42ef-9194-d414970282b1',
    'telemarketing_appointment', '31b699cc-7709-42ef-9194-d414970282b1',
    '2026-05-24 00:38:55.36+00'::timestamptz, 1,
    1, '2026-05-24 00:38:55.36+00'::timestamptz, NOW()
  )
  RETURNING id
)
INSERT INTO visit_tasks (
  field_visit_id, source_open_task_id,
  task_type, task_family, status, sequence_no,
  source_legacy_type, source_legacy_id
)
SELECT id, 3, 'device_demo', 'marketing', 'cancelled', 1,
       'telemarketing_appointment_task', '31b699cc-7709-42ef-9194-d414970282b1:1'
FROM ins_fv;

-- ─── سعيد العمراني (entity_id=18, device_demo, branch_id=2) ──────────────────

WITH ins_fv AS (
  INSERT INTO field_visits (
    visit_type, visit_family, status,
    client_id, branch_id, scheduled_date, scheduled_time,
    team_snapshot, customer_snapshot,
    origin_type, origin_id,
    source_legacy_type, source_legacy_id,
    appointment_booked_at, booked_by_telemarketer_id,
    created_by, created_at, updated_at
  ) VALUES (
    'marketing', 'marketing', 'cancelled',
    18, 2, '2026-05-24'::date, '15:00',
    jsonb_build_object('teamKey', 'team_0'),
    jsonb_build_object(
      'name', 'سعيد العمراني',
      'mobile', '0933363333',
      'occupation', null,
      'waterSource', 'ماء بئر / جوفي'
    ),
    'telemarketing', '0422468b-e8ea-4674-9bb1-8e536fc328ba',
    'telemarketing_appointment', '0422468b-e8ea-4674-9bb1-8e536fc328ba',
    '2026-05-24 01:04:32.666+00'::timestamptz, 1,
    1, '2026-05-24 01:04:32.666+00'::timestamptz, NOW()
  )
  RETURNING id
)
INSERT INTO visit_tasks (
  field_visit_id, source_open_task_id,
  task_type, task_family, status, sequence_no,
  source_legacy_type, source_legacy_id
)
SELECT id, 4, 'device_demo', 'marketing', 'cancelled', 1,
       'telemarketing_appointment_task', '0422468b-e8ea-4674-9bb1-8e536fc328ba:1'
FROM ins_fv;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Reversal (DOWN) — delete the migrated rows. The original legacy rows
-- are untouched, so re-running this migration restores the state.
-- ─────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DELETE FROM visit_tasks
--  WHERE source_legacy_type = 'telemarketing_appointment_task'
--    AND source_legacy_id LIKE ANY (ARRAY[
--      '11ee2d61-a036-4238-b0f2-4fdb6b1725e7:%',
--      '31b699cc-7709-42ef-9194-d414970282b1:%',
--      '0422468b-e8ea-4674-9bb1-8e536fc328ba:%'
--    ]);
-- DELETE FROM field_visits
--  WHERE source_legacy_type = 'telemarketing_appointment'
--    AND source_legacy_id IN (
--      '11ee2d61-a036-4238-b0f2-4fdb6b1725e7',
--      '31b699cc-7709-42ef-9194-d414970282b1',
--      '0422468b-e8ea-4674-9bb1-8e536fc328ba'
--    );
-- COMMIT;
