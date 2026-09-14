import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildGeographicPortfolioQuery } from './geographicPortfolioReport.js';

const GLOBAL_ACCESS = { scope: 'GLOBAL' as const, grantedScope: 'GLOBAL' as const, branchIds: [], userId: 42 };

test('geographic portfolio keeps branch and subarea as its row grain', () => {
  const { sql } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /GROUP BY branch_id, governorate_id, region_id, subarea_id/);
  assert.match(sql, /report_keys/);
  assert.match(sql, /IS NOT DISTINCT FROM keys\.subarea_id/);
  assert.match(sql, /COALESCE\(subarea\.name, 'غير محدد'\)/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)/);
});

test('customer classifications use the current clients portfolio and reconcile to total', () => {
  const { sql } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /client\.deleted_at IS NULL/);
  assert.match(sql, /candidate_status = 'FOP'/);
  assert.match(sql, /candidate_status IS NULL/);
  assert.match(sql, /candidate_status = 'Suggested'/);
  assert.match(sql, /candidate_status = 'OP'/);
  assert.doesNotMatch(sql, /FROM candidates/);
});

test('device families use the approved stable model ids', () => {
  const { sql } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /device_model_id = 1195/);
  assert.match(sql, /device_model_id = 2462/);
  assert.match(sql, /device_model_id = 1300/);
  assert.match(sql, /device_model_id NOT IN \(1195, 2462, 1300\)/);
});

test('periodic maintenance counts distinct device rows due today or overdue only', () => {
  const { sql } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /task\.task_type = 'periodic_maintenance'/);
  assert.match(sql, /task\.status NOT IN \('completed', 'closed', 'cancelled'\)/);
  assert.match(sql, /BOOL_OR\(task\.due_date = CURRENT_DATE\)/);
  assert.match(sql, /BOOL_OR\(task\.due_date < CURRENT_DATE\)/);
  assert.doesNotMatch(sql, /CURRENT_DATE \+ 1/);
  assert.match(sql, /GROUP BY task\.device_id/);
});

test('area evaluation is a recency weighted median with confidence metadata', () => {
  const { sql } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.match(sql, /survey\.filled_at >= NOW\(\) - INTERVAL '365 days'/);
  assert.match(sql, /visit\.status IN \('completed', 'closed'\)/);
  assert.match(sql, /WHEN 'ضعيفة' THEN 1/);
  assert.match(sql, /INTERVAL '90 days' THEN 1\.00/);
  assert.match(sql, /INTERVAL '180 days' THEN 0\.75/);
  assert.match(sql, /evaluation\.weak_weight >= evaluation\.total_weight \/ 2/);
  assert.match(sql, /'لا توجد بيانات كافية'/);
  assert.match(sql, /'مرتفعة'/);
});

test('branch and geographic filters are enforced independently on customers and devices', () => {
  const access = { scope: 'BRANCH' as const, grantedScope: 'BRANCH' as const, branchIds: [3, 7], userId: 42 };
  const { sql, params } = buildGeographicPortfolioQuery(access, { geoIds: '30,31,31' }, { limit: 50 });
  assert.match(sql, /client\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.match(sql, /device\.branch_id = ANY\(\$1::int\[\]\)/);
  assert.match(sql, /COALESCE\(client\.neighborhood, client\.district, client\.governorate\) = ANY\(\$2::int\[\]\)/);
  assert.match(sql, /device\.installation_geo_unit_id = ANY\(\$2::int\[\]\)/);
  assert.deepEqual(params, [[3, 7], [30, 31], 50]);
});

test('permission migration defines independent GLOBAL and BRANCH report capabilities', () => {
  const migration = readFileSync('migrations/443_geographic_portfolio_report.sql', 'utf8');
  assert.match(migration, /reports\.performance\.geographic_portfolio\.view/);
  assert.match(migration, /reports\.performance\.geographic_portfolio\.export/);
  assert.match(migration, /ARRAY\['GLOBAL','BRANCH'\]/);
  assert.doesNotMatch(migration, /'ASSIGNED'/);
});

test('the route filter expands its stations downward on customers and devices alike', () => {
  const { sql, params } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, { routeId: 9 }, { limit: 100 });

  // A station recorded at a ناحية must still reach the أحياء beneath it, so the
  // route's points are walked down the tree rather than matched as-is.
  assert.match(sql, /WITH RECURSIVE/);
  assert.match(sql, /point\.route_id = \$1/);
  assert.match(sql, /JOIN route_geo parent ON child\.parent_id = parent\.id/);
  assert.match(sql, /COALESCE\(client\.neighborhood, client\.district, client\.governorate\) IN \(SELECT id FROM route_geo\)/);
  assert.match(sql, /device\.installation_geo_unit_id IN \(SELECT id FROM route_geo\)/);
  assert.deepEqual(params, [9, 100]);
});

test('the evaluation filters compare against the expression the columns display', () => {
  const { sql, params } = buildGeographicPortfolioQuery(
    GLOBAL_ACCESS,
    { areaEvaluation: 'ضعيفة', evaluationConfidence: 'مرتفعة' },
    { limit: 100 },
  );

  assert.match(sql, /WHERE\s*\n?\s*CASE\s*\n\s*WHEN COALESCE\(evaluation\.evaluation_count, 0\) = 0 THEN 'لا توجد بيانات كافية'/);
  assert.match(sql, /END = \$1/);
  assert.match(sql, /END = \$2/);
  assert.deepEqual(params, ['ضعيفة', 'مرتفعة', 100]);
});

test('the periodic-pressure filter reads the same aggregate as the two device columns', () => {
  const overdue = buildGeographicPortfolioQuery(GLOBAL_ACCESS, { periodicPressure: 'overdue' }, { limit: 100 });
  assert.match(overdue.sql, /WHERE COALESCE\(devices\.overdue_periodic_devices, 0\) > 0/);
  assert.deepEqual(overdue.params, [100]);

  const dueToday = buildGeographicPortfolioQuery(GLOBAL_ACCESS, { periodicPressure: 'due_today' }, { limit: 100 });
  assert.match(dueToday.sql, /WHERE COALESCE\(devices\.periodic_due_today_devices, 0\) > 0/);

  // «no pressure» is both counters at zero, not the negation of one of them.
  const none = buildGeographicPortfolioQuery(GLOBAL_ACCESS, { periodicPressure: 'none' }, { limit: 100 });
  assert.match(none.sql, /COALESCE\(devices\.overdue_periodic_devices, 0\) = 0/);
  assert.match(none.sql, /AND COALESCE\(devices\.periodic_due_today_devices, 0\) = 0/);
});

test('an unrecognised evaluation or pressure value is refused, never widened to everything', () => {
  assert.throws(
    () => buildGeographicPortfolioQuery(GLOBAL_ACCESS, { areaEvaluation: 'excellent' }, { limit: 100 }),
    /تقييم المنطقة غير صالح/,
  );
  assert.throws(
    () => buildGeographicPortfolioQuery(GLOBAL_ACCESS, { evaluationConfidence: 'high' }, { limit: 100 }),
    /موثوقية التقييم غير صالح/,
  );
  assert.throws(
    () => buildGeographicPortfolioQuery(GLOBAL_ACCESS, { periodicPressure: 'late' }, { limit: 100 }),
    /ضغط الصيانة الدورية غير صالح/,
  );
});

test('a run with no row filters keeps the final select unfiltered', () => {
  const { sql } = buildGeographicPortfolioQuery(GLOBAL_ACCESS, {}, { limit: 100 });
  assert.doesNotMatch(sql, /WHERE\s+CASE/);
  assert.doesNotMatch(sql, /route_geo/);
});
