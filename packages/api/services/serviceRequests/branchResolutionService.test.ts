import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBranchForServiceGeoUnit } from './branchResolutionService.js';

function db(rows: Array<{ branchId: number; branchName: string }>) {
  return {
    async query() {
      return { rows };
    },
  } as any;
}

test('returns no_coverage without rejecting the geography', async () => {
  const result = await resolveBranchForServiceGeoUnit(1234, db([]));

  assert.equal(result.status, 'no_coverage');
  assert.equal(result.branchId, null);
  assert.equal(result.geoUnitId, 1234);
});

test('resolves one matching branch and marks multiple matches ambiguous', async () => {
  const resolved = await resolveBranchForServiceGeoUnit(1234, db([{ branchId: 7, branchName: 'فرع دمشق' }]));
  const ambiguous = await resolveBranchForServiceGeoUnit(1234, db([
    { branchId: 7, branchName: 'فرع دمشق' },
    { branchId: 8, branchName: 'فرع حمص' },
  ]));

  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.branchId, 7);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.branchId, null);
});
