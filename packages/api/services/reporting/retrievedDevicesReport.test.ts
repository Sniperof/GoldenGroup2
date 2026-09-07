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
  assert.match(sql, /result\.closed_at >= \$1::date/);
  assert.match(sql, /retrieval\.service_branch_id AS "branchId"/);
  assert.match(sql, /unit\.id = open_task\.pre_retrieval_geo_unit_id/);
  assert.match(sql, /geo\.subarea_name AS "subareaName"/);
  assert.match(sql, /geo\.neighborhood_name AS "neighborhoodName"/);
  assert.match(sql, /COUNT\(\*\) OVER\(\)::int AS "totalRows"/);
  assert.doesNotMatch(sql, /ILIKE|request\.search/);
  assert.deepEqual(params, ['2026-08-01', '2026-08-31', 10]);
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
