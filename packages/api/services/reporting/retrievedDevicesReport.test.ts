import assert from 'node:assert/strict';
import test from 'node:test';
import type { TabularReportAccess } from './tabularReportAccess.js';
import { buildRetrievedDevicesQuery } from './retrievedDevicesReport.js';

const globalAccess: TabularReportAccess = {
  scope: 'GLOBAL', grantedScope: 'GLOBAL', branchIds: [], userId: 17,
};

test('retrieved devices uses one successful retrieval result per row', () => {
  const { sql, params } = buildRetrievedDevicesQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31',
  }, { limit: 10 });

  assert.match(sql, /FROM visit_task_device_retrieval_results retrieval/);
  assert.match(sql, /retrieval\.final_decision = 'retrieved_successfully'/);
  assert.match(sql, /result\.closed_at >= \(\$1::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Damascus'/);
  assert.match(sql, /retrieval\.service_branch_id AS "branchId"/);
  assert.match(sql, /unit\.id = open_task\.pre_retrieval_geo_unit_id/);
  assert.match(sql, /geo\.governorate_name AS "governorateName"/);
  assert.match(sql, /geo\.region_name AS "regionName"/);
  assert.match(sql, /geo\.subarea_name AS "subareaName"/);
  assert.match(sql, /geo\.neighborhood_name AS "neighborhoodName"/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
  // Nothing was asked for, so nothing narrows the run.
  assert.doesNotMatch(sql, /ILIKE|geo\.unit_ids/);
  assert.deepEqual(params, ['2026-08-01', '2026-08-31', 10]);
});

test('retrieved devices matches the geography of the pre-retrieval snapshot at any level', () => {
  const { sql, params } = buildRetrievedDevicesQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31', geoIds: '30,31,31',
  }, { limit: 10 });

  // The row keeps its whole ancestor chain, so a governorate-level pick still
  // reaches a device pinned to a حي beneath it.
  assert.match(sql, /COALESCE\(ARRAY_AGG\(id\), ARRAY\[\]::int\[\]\) AS unit_ids/);
  assert.match(sql, /geo\.unit_ids && \$3::int\[\]/);
  assert.deepEqual(params.slice(0, 3), ['2026-08-01', '2026-08-31', [30, 31]]);
});

test('retrieved devices separates the retrieval path, the origin branch, and the identifier search', () => {
  const { sql, params } = buildRetrievedDevicesQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31',
    retrievalSource: 'direct_workshop', originBranchId: 5, search: 'GC-991',
  }, { limit: 10 });

  assert.match(sql, /open_task\.creation_reason = \$3/);
  assert.match(sql, /open_task\.pre_retrieval_branch_id = \$4/);
  assert.match(sql, /device\.serial_number ILIKE \$5/);
  assert.match(sql, /client\.name ILIKE \$5/);
  assert.deepEqual(params.slice(0, 5), [
    '2026-08-01', '2026-08-31', 'emergency_direct_workshop_retrieval', 5, '%GC-991%',
  ]);
});

test('retrieved devices reads the planned path as the complement of the direct one', () => {
  const { sql } = buildRetrievedDevicesQuery(globalAccess, {
    fromDate: '2026-08-01', toDate: '2026-08-31', retrievalSource: 'retrieval_task',
  }, { limit: 10 });

  // IS DISTINCT FROM, not <>: a task with no recorded reason is a planned retrieval,
  // and a NULL comparison would have dropped it from the report instead.
  assert.match(sql, /open_task\.creation_reason IS DISTINCT FROM \$3/);
});

test('retrieved devices rejects an unknown retrieval path', () => {
  assert.throws(
    () => buildRetrievedDevicesQuery(globalAccess, {
      fromDate: '2026-08-01', toDate: '2026-08-31', retrievalSource: 'walk_in',
    }, { limit: 10 }),
    /مسار السحب غير صالح/,
  );
});

test('retrieved devices applies destination branch and structured filters', () => {
  const access: TabularReportAccess = {
    scope: 'BRANCH', grantedScope: 'BRANCH', branchIds: [3], userId: 17,
  };
  const { sql, params } = buildRetrievedDevicesQuery(access, {
    fromDate: '2026-08-01', toDate: '2026-08-31', retrievalPurpose: 'maintenance',
    retrievedDeviceStatus: 'in_workshop', retrievalTechnicianEmployeeId: 9,
    deviceModel: 'catalog:12',
  }, { limit: 10 });

  assert.match(sql, /retrieval\.service_branch_id = ANY\(\$3::int\[\]\)/);
  assert.match(sql, /retrieval\.retrieval_purpose = \$4/);
  assert.match(sql, /device\.status = \$5/);
  assert.match(sql, /device\.device_model_id = \$7/);
  assert.deepEqual(params.slice(0, 7), [
    '2026-08-01', '2026-08-31', [3], 'maintenance', 'in_workshop', 9, 12,
  ]);
});

test('retrieved devices rejects unsupported inputs and assigned scope', () => {
  assert.throws(
    () => buildRetrievedDevicesQuery(globalAccess, { fromDate: '2026-08-01' }, { limit: 10 }),
    /تاريخ بداية ونهاية السحب مطلوبان/,
  );
  assert.throws(
    () => buildRetrievedDevicesQuery(globalAccess, {
      fromDate: '2026-08-01', toDate: '2026-08-31', retrievalPurpose: 'disposal',
    }, { limit: 10 }),
    /غرض السحب غير صالح/,
  );
  assert.throws(
    () => buildRetrievedDevicesQuery({ ...globalAccess, scope: 'ASSIGNED', grantedScope: 'ASSIGNED' }, {
      fromDate: '2026-08-01', toDate: '2026-08-31',
    }, { limit: 10 }),
    /كل الفروع أو الفرع فقط/,
  );
});
