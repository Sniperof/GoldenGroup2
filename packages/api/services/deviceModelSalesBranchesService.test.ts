import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeviceModelNotFoundError,
  getDeviceModelSalesBranches,
  replaceDeviceModelSalesBranches,
  type SalesBranchesQueryable,
} from './deviceModelSalesBranchesService.js';

test('sales branch options include active branches and independent selections', async () => {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const db: SalesBranchesQueryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [{ id: 7 }] };
      return { rows: [{
        id: 2,
        name: 'فرع دمشق',
        detailedAddress: 'كفرسوسة',
        locationGeoName: 'دمشق',
        isSelected: true,
      }] };
    },
  };

  const result = await getDeviceModelSalesBranches(7, db);
  assert.equal(result.deviceModelId, 7);
  assert.equal(result.branches[0].isSelected, true);
  assert.match(calls[1].sql, /device_model_sales_branches link/);
  assert.match(calls[1].sql, /b\.status = 'active'/);
  assert.deepEqual(calls[1].params, [7]);
});

test('replacing sales branches validates active branches and preserves an atomic relation update', async () => {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (/SELECT id FROM device_models/.test(sql)) return { rows: [{ id: 7 }] };
      if (/SELECT id FROM branches/.test(sql)) return { rows: [{ id: 2 }, { id: 3 }] };
      if (/SELECT b\.id/.test(sql)) return { rows: [
        { id: 2, name: 'دمشق', isSelected: true },
        { id: 3, name: 'طرطوس', isSelected: true },
      ] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  const dbPool = { async connect() { return client; } };

  const result = await replaceDeviceModelSalesBranches(7, [2, 3, 2], 11, dbPool);
  assert.deepEqual(result.branches.map(branch => branch.id), [2, 3]);
  assert.equal(released, true);
  assert.ok(calls.some(call => /UPDATE device_model_sales_branches/.test(call.sql)));
  const insert = calls.find(call => /INSERT INTO device_model_sales_branches/.test(call.sql));
  assert.deepEqual(insert?.params, [7, [2, 3], 11]);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('replacing sales branches rolls back when an inactive branch is submitted', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (/SELECT id FROM device_models/.test(sql)) return { rows: [{ id: 7 }] };
      if (/SELECT id FROM branches/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };

  await assert.rejects(
    () => replaceDeviceModelSalesBranches(7, [99], 11, { async connect() { return client; } }),
    (error: any) => error?.code === 'UNAVAILABLE_BRANCHES' && error?.status === 400,
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('sales branch options reject a missing or deleted device', async () => {
  const db: SalesBranchesQueryable = { async query() { return { rows: [] }; } };
  await assert.rejects(
    () => getDeviceModelSalesBranches(999, db),
    (error: unknown) => error instanceof DeviceModelNotFoundError,
  );
});
