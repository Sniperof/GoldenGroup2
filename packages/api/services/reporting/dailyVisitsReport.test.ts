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

test('visible report fields have independent server-side filters', () => {
  const { sql, params } = buildDailyVisitsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    {
      fromDate: '2026-06-01', toDate: '2026-06-30', geoIds: '8,9',
      supervisorEmployeeId: 13, technicianEmployeeId: 17, telemarketerUserId: 21,
      visitStatus: 'completed',
    },
    { limit: 50 },
  );
  assert.match(sql, /reassigned_supervisor_id.*= \$3/);
  assert.match(sql, /reassigned_technician_id.*= \$4/);
  assert.match(sql, /fv\.booked_by_telemarketer_id = \$5/);
  assert.match(sql, /fv\.status = \$6/);
  assert.match(sql, /COALESCE\(c\.neighborhood,c\.district\) = ANY\(\$7::int\[\]\)/);
  assert.deepEqual(params.slice(0, 7), ['2026-06-01', '2026-06-30', 13, 17, 21, 'completed', [8, 9]]);
  assert.doesNotMatch(sql, /vtr\.final_decision|vt\.task_type\s*=/);
});

test('unknown visit status is rejected instead of becoming a loose SQL filter', () => {
  assert.throws(
    () => buildDailyVisitsQuery(
      { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
      { fromDate: '2026-06-01', toDate: '2026-06-30', visitStatus: 'unknown_status' },
      { limit: 50 },
    ),
    (error: unknown) => error instanceof ReportingError && error.status === 400,
  );
});

test('the cancellation reason filters on the managed list id, not its wording', () => {
  const { sql, params } = buildDailyVisitsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { fromDate: '2026-06-01', toDate: '2026-06-30', cancellationReasonId: 55 },
    { limit: 10 },
  );

  // The id, so renaming a reason keeps it matching the rows it was recorded on.
  assert.match(sql, /fv\.cancellation_reason_id = \$3/);
  assert.match(sql, /LEFT JOIN system_lists cancellation_reason ON cancellation_reason\.id=fv\.cancellation_reason_id/);
  assert.deepEqual(params.slice(0, 3), ['2026-06-01', '2026-06-30', 55]);
});

test('the visit origin is a separate question from the visit status', () => {
  const { sql, params } = buildDailyVisitsQuery(
    { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
    { fromDate: '2026-06-01', toDate: '2026-06-30', visitOrigin: 'field_initiated', visitStatus: 'completed' },
    { limit: 10 },
  );

  assert.match(sql, /fv\.status = \$3/);
  assert.match(sql, /fv\.origin_type = \$4/);
  assert.match(sql, /WHEN 'field_initiated' THEN 'زيارة ميدانية فورية'/);
  assert.match(sql, /END AS "visitOrigin"/);
  assert.deepEqual(params.slice(0, 4), ['2026-06-01', '2026-06-30', 'completed', 'field_initiated']);
});

test('an unknown visit origin is refused rather than passed into the query', () => {
  assert.throws(
    () => buildDailyVisitsQuery(
      { scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 1 },
      { fromDate: '2026-06-01', toDate: '2026-06-30', visitOrigin: 'walk_in' },
      { limit: 10 },
    ),
    (error: unknown) => error instanceof ReportingError && /مصدر الزيارة غير صالح/.test(error.message),
  );
});
