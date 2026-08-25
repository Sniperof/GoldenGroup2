import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportingError } from './reportingError.js';
import { buildDailyVisitsQuery, requireDailyVisitDateRange } from './dailyVisitsReport.js';

test('daily visits report requires a valid ordered date range', () => {
  assert.deepEqual(requireDailyVisitDateRange({ fromDate: '2026-06-01', toDate: '2026-06-30' }), {
    fromDate: '2026-06-01', toDate: '2026-06-30',
  });
  assert.throws(
    () => requireDailyVisitDateRange({ fromDate: '2026-06-31', toDate: '2026-07-01' }),
    (error: unknown) => error instanceof ReportingError && error.status === 400,
  );
  assert.throws(
    () => requireDailyVisitDateRange({ fromDate: '2026-07-01', toDate: '2026-06-01' }),
    (error: unknown) => error instanceof ReportingError && error.status === 400,
  );
});

test('assigned report enforces branch and actual visit participation or booking ownership', () => {
  const { sql, params } = buildDailyVisitsQuery(
    { scope: 'ASSIGNED', grantedScope: 'ASSIGNED', branchIds: [3], userId: 42 },
    { fromDate: '2026-06-01', toDate: '2026-06-30' },
    { limit: 100 },
  );
  assert.match(sql, /fv\.branch_id = ANY\(\$3::int\[\]\)/);
  assert.match(sql, /fv\.booked_by_telemarketer_id = scoped_user\.id/);
  assert.match(sql, /fv\.reassigned_supervisor_id/);
  assert.match(sql, /fv\.reassigned_technician_id/);
  assert.match(sql, /fv\.reassigned_trainee_id/);
  assert.match(sql, /scoped_user\.id = \$4/);
  assert.deepEqual(params.slice(0, 4), ['2026-06-01', '2026-06-30', [3], 42]);
});

test('daily visit row uses one visit grain, primary phone and visit-level cancellation', () => {
  const { sql } = buildDailyVisitsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { fromDate: '2026-01-01', toDate: '2026-12-31' },
    { limit: 50 },
  );
  assert.match(sql, /COUNT\(\*\)::int AS task_count FROM visit_tasks vt WHERE vt\.field_visit_id=fv\.id/);
  assert.match(sql, /MAX\(rs\.total_candidates\)/);
  assert.match(sql, /customer_snapshot->>'mobile'/);
  assert.doesNotMatch(sql, /c\.contacts/);
  assert.match(sql, /WHEN fv\.status='cancelled' THEN cancellation_reason\.value/);
  assert.match(sql, /WHEN fv\.status='cancelled' THEN NULLIF\(BTRIM\(fv\.cancellation_notes\),''\)/);
  assert.doesNotMatch(sql, /visit_task_results/);
});

test('geographic and employee filters are server-bound across effective team members', () => {
  const { sql, params } = buildDailyVisitsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { fromDate: '2026-06-01', toDate: '2026-06-30', employeeId: 13, geoIds: '8,9' },
    { limit: 50 },
  );
  assert.match(sql, /telemarketer_employee\.id/);
  assert.match(sql, /COALESCE\(c\.neighborhood,c\.district\) = ANY\(\$4::int\[\]\)/);
  assert.deepEqual(params.slice(0, 4), ['2026-06-01', '2026-06-30', 13, [8, 9]]);
});
