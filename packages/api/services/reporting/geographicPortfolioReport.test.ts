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
