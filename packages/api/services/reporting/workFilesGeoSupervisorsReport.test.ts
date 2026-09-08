import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkFilesGeoSupervisorsQuery } from './workFilesGeoSupervisorsReport.js';

test('assigned report keeps LEAD ownership separate and counts active follow-up across all customer stages', () => {
  const { sql, params } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [3], userId: 42 },
    {},
    { offset: 0, limit: 50 },
  );

  assert.match(sql, /c\.branch_id = ANY\(\$2::int\[\]\)/);
  assert.match(sql, /owner\.id = \$3/);
  assert.match(sql, /owner_role\.team_slot_type = 'SUPERVISOR'/);
  assert.match(sql, /task_type = 'device_demo'/);
  assert.match(sql, /ot\.status=ANY\(\$1::text\[\]\)/);
  assert.match(sql, /AND \(\s*CASE[\s\S]*\) = 'LEAD'/);
  assert.match(sql, /active_followup_clients/);
  assert.doesNotMatch(sql, /active_followup_clients[\s\S]*lifecycle_status='LEAD'/);
  assert.match(sql, /visit_owner\.employee_id/);
  assert.match(sql, /NULLIF\(ot\.team_snapshot->>'supervisorEmployeeId',''\)::int/);
  assert.match(sql, /current_owner\.employee_id/);
  assert.deepEqual(params.slice(0, 3), [
    ['open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution', 'in_execution', 'ended'],
    [3],
    42,
  ]);
});

test('latest visit uses actual end time and effective visit-time team', () => {
  const { sql } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    {},
    { limit: 50 },
  );
  assert.match(sql, /vgl\.actual_end_time IS NOT NULL/);
  assert.match(sql, /fv\.reassigned_supervisor_id/);
  assert.match(sql, /team_snapshot->>'supervisorEmployeeId'/);
  assert.match(sql, /fv\.reassigned_technician_id IS NOT NULL THEN reassigned_technician\.name/);
  assert.match(sql, /team_snapshot->>'technicianName'/);
  assert.match(sql, /ORDER BY vgl\.actual_end_time DESC, fv\.id DESC/);
});

test('geographic filter accepts the server-bound expanded subtree ids', () => {
  const { sql, params } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { geoIds: '11,12,13' },
    { limit: 50 },
  );
  assert.match(sql, /COALESCE\(c\.neighborhood, c\.district\) = ANY\(\$2::int\[\]\)/);
  assert.deepEqual(params[1], [11, 12, 13]);
});

test('FOP and OP counts require a strictly closed device-demo and use the visit-time supervisor', () => {
  const { sql } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 }, {}, { limit: 50 },
  );
  assert.match(sql, /ot\.task_type='device_demo'/);
  assert.match(sql, /ot\.status='closed'/);
  assert.match(sql, /lifecycle_status='FOP'/);
  assert.match(sql, /lifecycle_status='OP'/);
  assert.match(sql, /COUNT\(DISTINCT client_id\)/);
  assert.match(sql, /demo_supervisor\.id=COALESCE/);
  assert.match(sql, /report_dimensions[\s\S]*UNION[\s\S]*closed_demo_grouped/);
});

test('the supervisor filter reaches every population the row is built from', () => {
  const { sql, params } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { supervisorEmployeeId: 8 },
    { limit: 50 },
  );

  // The row unions three CTEs, each naming the supervisor differently. A filter that
  // reached only the LEAD side would leave her follow-up and closed-demo counts
  // computed over everyone.
  assert.match(sql, /employee\.id = \$2/);
  assert.match(sql, /demo_supervisor\.id = \$3/);
  assert.match(sql, /followup_supervisor\.id = \$3/);
  assert.deepEqual(params.slice(1, 3), [8, 8]);
});

test('the department filter reads the supervisor department type on each population', () => {
  const { sql, params } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { departmentTypeId: 4 },
    { limit: 50 },
  );

  assert.match(sql, /supervisor_department\.id = employee\.department_id/);
  assert.match(sql, /supervisor_department\.id = demo_supervisor\.department_id/);
  assert.match(sql, /supervisor_department\.id = followup_supervisor\.department_id/);
  assert.match(sql, /NULLIF\(BTRIM\(supervisor_department\.name\), ''\) AS "departmentName"/);
  assert.deepEqual(params.slice(1, 3), [4, 4]);
});

test('the last-visit filters read the visit the columns show, after the rank pick', () => {
  const { sql, params } = buildWorkFilesGeoSupervisorsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { accompanyingTechnicianId: 12, lastVisitFrom: '2026-08-01', lastVisitTo: '2026-08-31' },
    { limit: 50 },
  );

  // Applied outside visit_candidates: narrowing inside it would promote an older
  // visit into «آخر زيارة» and answer a different question.
  assert.match(sql, /AND latest_visit\.visit_rank = 1\s*\n\s*WHERE latest_visit\.technician_employee_id = \$2/);
  assert.match(sql, /latest_visit\.actual_end_time >= \(\$3::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /latest_visit\.actual_end_time < \(\(\$4::text::date \+ 1\)::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /\) AS technician_employee_id/);
  assert.deepEqual(params.slice(1, 4), [12, '2026-08-01', '2026-08-31']);
});

test('the last-visit range rejects an inverted or malformed pair', () => {
  const access = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 1 };
  assert.throws(
    () => buildWorkFilesGeoSupervisorsQuery(access, { lastVisitFrom: '2026-08-31', lastVisitTo: '2026-08-01' }, { limit: 50 }),
    /بداية مدى آخر زيارة يجب ألا تكون بعد نهايته/,
  );
  assert.throws(
    () => buildWorkFilesGeoSupervisorsQuery(access, { lastVisitFrom: '31-08-2026' }, { limit: 50 }),
    /بداية مدى آخر زيارة غير صالح/,
  );
});
