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
