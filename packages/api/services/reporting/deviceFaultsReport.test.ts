import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularReportAccess } from './tabularReportAccess.js';
import { buildDeviceFaultsQuery } from './deviceFaultsReport.js';

const globalAccess: TabularReportAccess = {
  scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 17,
};

test('device faults preserves one problem row and aggregates linked parts', () => {
  const { sql, params } = buildDeviceFaultsQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31',
  }, { limit: 10 });

  assert.match(sql, /FROM service_request_problems problem/);
  assert.match(sql, /part\.linked_problem_id = problem\.id/);
  assert.match(sql, /STRING_AGG\(part\.part_name_snapshot/);
  assert.match(sql, /problem\.created_at >= \(\$1::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /problem\.created_at < \(\(\$2::text::date \+ 1\)::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
  assert.deepEqual(params.slice(0, 2), ['2026-08-01', '2026-08-31']);
});

test('device faults locates the fault at the installation site, not the customer address', () => {
  const { sql, params } = buildDeviceFaultsQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31', geoIds: '30,31',
  }, { limit: 10 });

  assert.match(sql, /unit\.id = device\.installation_geo_unit_id/);
  assert.match(sql, /geo\.governorate_name AS "governorateName"/);
  assert.match(sql, /geo\.neighborhood_name AS "neighborhoodName"/);
  assert.match(sql, /geo\.unit_ids && \$3::int\[\]/);
  assert.doesNotMatch(sql, /unit\.id = client\./);
  assert.deepEqual(params.slice(0, 3), ['2026-08-01', '2026-08-31', [30, 31]]);
});

test('device faults filters the visit technician apart from the repair technician', () => {
  const { sql, params } = buildDeviceFaultsQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31',
    repairTechnicianEmployeeId: 33, visitTechnicianEmployeeId: 44,
  }, { limit: 10 });

  assert.match(sql, /problem\.repaired_by_employee_id = \$3/);
  assert.match(sql, /resolution_visit\.reassigned_technician_id,\s*\n\s*NULLIF\(resolution_visit\.team_snapshot->>'technicianEmployeeId', ''\)::int\s*\n\s*\) = \$4/);
  assert.deepEqual(params.slice(0, 4), ['2026-08-01', '2026-08-31', 33, 44]);
});

test('device faults searches identifiers and the customer name in one field', () => {
  const { sql, params } = buildDeviceFaultsQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31', search: 'SR-42',
  }, { limit: 10 });

  assert.match(sql, /service_request\.public_ref_number ILIKE \$3/);
  assert.match(sql, /device\.serial_number ILIKE \$3/);
  assert.match(sql, /client\.name ILIKE \$3/);
  assert.deepEqual(params.slice(0, 3), ['2026-08-01', '2026-08-31', '%SR-42%']);
});

test('device faults applies branch and structured filters without text search', () => {
  const access: TabularReportAccess = {
    scope: 'BRANCH', grantedScope: 'BRANCH', branchIds: [4, 9], userId: 17,
  };
  const { sql, params } = buildDeviceFaultsQuery(access, {
    fromDate: '2026-08-01', toDate: '2026-08-31',
    faultTypeId: 71, faultStatus: 'deferred', faultDiscoveryPhase: 'field_discovery',
    repairTechnicianEmployeeId: 33, deviceModel: 'catalog:12',
    faultResolvedFrom: '2026-08-10', faultResolvedTo: '2026-08-20',
    faultDurationBucket: 'four_to_seven', faultPartsUsage: 'yes',
  }, { limit: 10 });

  assert.match(sql, /COALESCE\(service_request\.branch_id, device\.branch_id\) = ANY\(\$3::int\[\]\)/);
  assert.match(sql, /problem\.problem_type_id = \$4/);
  assert.match(sql, /problem\.status = \$5/);
  assert.match(sql, /problem\.repaired_by_employee_id = \$7/);
  assert.match(sql, /linked_parts\.summary IS NOT NULL/);
  assert.doesNotMatch(sql, /ILIKE|request\.search/);
  assert.deepEqual(params.slice(0, 8), [
    '2026-08-01', '2026-08-31', [4, 9], 71, 'deferred', 'field_discovery', 33, 12,
  ]);
});

test('device faults rejects missing dates, unknown filters, and assigned scope', () => {
  assert.throws(
    () => buildDeviceFaultsQuery(globalAccess, { fromDate: '2026-08-01' }, { limit: 10 }),
    /تاريخ بداية ونهاية تسجيل الأعطال مطلوبان/,
  );
  assert.throws(
    () => buildDeviceFaultsQuery(globalAccess, {
      fromDate: '2026-08-01', toDate: '2026-08-31', faultStatus: 'unknown',
    }, { limit: 10 }),
    /حالة العطل غير صالح/,
  );
  assert.throws(
    () => buildDeviceFaultsQuery({ ...globalAccess, scope: 'ASSIGNED', grantedScope: 'ASSIGNED' }, {
      fromDate: '2026-08-01', toDate: '2026-08-31',
    }, { limit: 10 }),
    /كل الفروع أو الفرع فقط/,
  );
});
