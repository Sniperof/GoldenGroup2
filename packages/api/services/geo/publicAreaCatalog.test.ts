import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicAreaSearchItems,
  listPublicAreas,
  searchPublicAreas,
} from './publicAreaCatalog.js';

test('listPublicAreas always queries active units and parameterizes parent id', async () => {
  const calls: { sql: string; params?: any[] }[] = [];
  const db = {
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      return { rows: [{ id: 2, name: 'المزة', level: 2, parent_id: 1 }] };
    },
  };

  const rows = await listPublicAreas(1, db);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /g\.status = 'active'/);
  assert.match(calls[0].sql, /parent\.status = 'active'/);
  assert.deepEqual(calls[0].params, [1]);
  assert.deepEqual(rows[0], {
    id: 2,
    name: 'المزة',
    level: 2,
    type: 'city',
    parentId: 1,
  });
});

test('buildPublicAreaSearchItems returns only complete root-to-leaf paths', () => {
  const items = buildPublicAreaSearchItems([
    { match_id: 4, id: 4, name: 'منطقة الفلل', level: 4, parent_id: 3 },
    { match_id: 4, id: 3, name: 'الشيخ سعد', level: 3, parent_id: 2 },
    { match_id: 4, id: 2, name: 'المزة', level: 2, parent_id: 1 },
    { match_id: 4, id: 1, name: 'دمشق', level: 1, parent_id: null },
    // Incomplete ancestry (level 2 is missing), so it cannot be safely selected.
    { match_id: 6, id: 6, name: 'حي ناقص', level: 3, parent_id: 5 },
    { match_id: 6, id: 1, name: 'دمشق', level: 1, parent_id: null },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 4);
  assert.deepEqual(items[0].path.map((unit) => unit.id), [1, 2, 3, 4]);
});

test('searchPublicAreas uses bounded parameterized search and preserves relevance order', async () => {
  const calls: { sql: string; params?: any[] }[] = [];
  const db = {
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return {
          rows: [
            { id: 2, name: 'المزة', level: 2, parent_id: 1 },
            { id: 4, name: 'مزة فيلات', level: 4, parent_id: 3 },
          ],
        };
      }
      return {
        rows: [
          { match_id: 2, id: 1, name: 'دمشق', level: 1, parent_id: null },
          { match_id: 2, id: 2, name: 'المزة', level: 2, parent_id: 1 },
          { match_id: 4, id: 1, name: 'دمشق', level: 1, parent_id: null },
          { match_id: 4, id: 2, name: 'المزة', level: 2, parent_id: 1 },
          { match_id: 4, id: 3, name: 'الشيخ سعد', level: 3, parent_id: 2 },
          { match_id: 4, id: 4, name: 'مزة فيلات', level: 4, parent_id: 3 },
        ],
      };
    },
  };

  const rows = await searchPublicAreas('المزة', 15, db);
  assert.deepEqual(calls[0].params, ['المزة', 15]);
  assert.match(calls[0].sql, /LIMIT \$2/);
  assert.deepEqual(calls[1].params, [[2, 4]]);
  assert.deepEqual(rows.map((item) => item.id), [2, 4]);
});
