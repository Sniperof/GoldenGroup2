import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSalesFollowUpTasksQuery, requireSalesFollowUpDateRange } from './salesFollowUpTasksReport.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };

test('sales follow-up requires a valid execution-result date range', () => {
  assert.throws(() => requireSalesFollowUpDateRange({}), /تحديد تاريخ/);
  assert.throws(() => requireSalesFollowUpDateRange({ fromDate: '2026-09-02', toDate: '2026-09-01' }), /البداية/);
  assert.deepEqual(requireSalesFollowUpDateRange({ fromDate: '2026-09-01', toDate: '2026-09-02' }), {
    fromDate: '2026-09-01', toDate: '2026-09-02',
  });
});

test('each row is a completed task result and dates use result closure in Damascus', () => {
  const { sql, params } = buildSalesFollowUpTasksQuery(
    GLOBAL_ACCESS, { fromDate: '2026-09-01', toDate: '2026-09-30' }, { limit: 100 },
  );
  assert.match(sql, /JOIN visit_task_results result ON result\.visit_task_id = vt\.id/);
  assert.match(sql, /vt\.status = 'completed'/);
  assert.match(sql, /result\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date >= \$1::date/);
  assert.match(sql, /result\.closed_at AT TIME ZONE 'Asia\/Damascus'\)::date <= \$2::date/);
  assert.match(sql, /AT TIME ZONE 'Asia\/Damascus'/);
  assert.deepEqual(params, ['2026-09-01', '2026-09-30', 100]);
});

test('report includes device demo and every configured service task without hardcoded service types', () => {
  const { sql } = buildSalesFollowUpTasksQuery(
    GLOBAL_ACCESS, { fromDate: '2026-09-01', toDate: '2026-09-30' }, { limit: 100 },
  );
  assert.match(sql, /vt\.task_type = 'device_demo' OR config\.contact_target_visit_type = 'service'/);
  assert.match(sql, /config\.arabic_label/);
  assert.doesNotMatch(sql, /periodic_maintenance.*emergency_maintenance/);
});

test('task geography follows the configured work-location basis and exposes four levels', () => {
  const { sql } = buildSalesFollowUpTasksQuery(
    GLOBAL_ACCESS, { fromDate: '2026-09-01', toDate: '2026-09-30', geoIds: '7,8,8' }, { limit: 100 },
  );
  assert.match(sql, /config\.location_basis IN \('contract','device'\).*device\.installation_geo_unit_id/s);
  assert.match(sql, /ELSE COALESCE\(customer\.neighborhood, customer\.district, customer\.governorate\)/);
  assert.match(sql, /effective_location\.geo_unit_id = ANY\(\$3::int\[\]\)/);
  for (const level of [1, 2, 3, 4]) assert.match(sql, new RegExp(`location0\\.level=${level}`));
});

test('branch, assigned employee and visible employee filters are server-side', () => {
  const access = { scope: 'ASSIGNED' as const, grantedScope: 'ASSIGNED' as const, branchIds: [3], userId: 42 };
  const { sql, params } = buildSalesFollowUpTasksQuery(access, {
    fromDate: '2026-09-01', toDate: '2026-09-30', supervisorEmployeeId: 9,
    technicianEmployeeId: 10, taskType: 'device_demo',
  }, { limit: 50 });
  assert.match(sql, /fv\.branch_id = ANY\(\$3::int\[\]\)/);
  assert.match(sql, /scoped_user\.id = \$4/);
  assert.match(sql, /reassigned_supervisor_id[\s\S]*= \$5/);
  assert.match(sql, /reassigned_technician_id[\s\S]*= \$6/);
  assert.doesNotMatch(sql, /ILIKE/);
  assert.match(sql, /vt\.task_type = \$7/);
  assert.deepEqual(params, ['2026-09-01', '2026-09-30', [3], 42, 9, 10, 'device_demo', 50]);
});

test('result notes come only from the canonical task result', () => {
  const { sql } = buildSalesFollowUpTasksQuery(
    GLOBAL_ACCESS, { fromDate: '2026-09-01', toDate: '2026-09-30' }, { limit: 100 },
  );
  assert.match(sql, /result\.closing_notes/);
  assert.doesNotMatch(sql, /field_notes|execution_notes|telemarketer_notes/);
});

test('permission migration supports global branch and assigned scopes', () => {
  const migration = readFileSync('migrations/441_sales_follow_up_tasks_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.sales_follow_up_tasks\.view/);
  assert.match(migration, /reports\.performance\.sales_follow_up_tasks\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH','ASSIGNED'\]/);
  assert.equal((migration.match(/تقرير متابعة البيع — مهام العرض والخدمة/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /عرض تقرير متابعة البيع|تصدير تقرير متابعة البيع/);
  assert.match(migration, /role_permission_grants/);
  assert.doesNotMatch(migration, /role_permissions(?!_grants)/);
});
