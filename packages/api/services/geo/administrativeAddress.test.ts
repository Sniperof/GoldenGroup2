import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAndValidateAddress } from './administrativeAddress.js';

// A small fixture geo tree: Damascus(1) → Mazzeh(2) → Sheikh Saad(3) → Villa Zone(4).
const TREE = [
  { id: 1, name: 'دمشق', level: 1, parent_id: null },
  { id: 2, name: 'المزة', level: 2, parent_id: 1 },
  { id: 3, name: 'الشيخ سعد', level: 3, parent_id: 2 },
  { id: 4, name: 'منطقة الفلل', level: 4, parent_id: 3 },
  { id: 9, name: 'حلب', level: 1, parent_id: null }, // unrelated governorate
];

function mockDb(rows = TREE) {
  return {
    async query(_sql: string, params?: any[]) {
      const ids: number[] = params?.[0] ?? [];
      return { rows: rows.filter((r) => ids.includes(r.id)) };
    },
  };
}

test('resolves a full valid chain to ids + label names', async () => {
  const out = await resolveAndValidateAddress(
    { governorate: 1, cityOrArea: 2, subArea: 3, neighborhood: 4 },
    mockDb(),
  );
  assert.deepEqual(out.ids, { governorate: 1, cityOrArea: 2, subArea: 3, neighborhood: 4 });
  assert.deepEqual(out.labels, {
    governorate: 'دمشق',
    cityOrArea: 'المزة',
    subArea: 'الشيخ سعد',
    neighborhood: 'منطقة الفلل',
  });
});

test('governorate only is valid; deeper labels are null', async () => {
  const out = await resolveAndValidateAddress({ governorate: 1 }, mockDb());
  assert.deepEqual(out.ids, { governorate: 1, cityOrArea: null, subArea: null, neighborhood: null });
  assert.equal(out.labels.governorate, 'دمشق');
  assert.equal(out.labels.cityOrArea, null);
});

test('accepts numeric strings (JSON payloads)', async () => {
  const out = await resolveAndValidateAddress({ governorate: '1', cityOrArea: '2' }, mockDb());
  assert.deepEqual(out.ids.governorate, 1);
  assert.deepEqual(out.ids.cityOrArea, 2);
});

test('missing governorate → 400', async () => {
  await assert.rejects(
    () => resolveAndValidateAddress({ governorate: null }, mockDb()),
    (e: any) => e.status === 400,
  );
});

test('non-integer id → 400', async () => {
  await assert.rejects(
    () => resolveAndValidateAddress({ governorate: 'المزة' }, mockDb()),
    (e: any) => e.status === 400,
  );
});

test('gap in the chain (neighborhood without sub-area) → 400', async () => {
  await assert.rejects(
    () => resolveAndValidateAddress({ governorate: 1, cityOrArea: 2, neighborhood: 4 }, mockDb()),
    (e: any) => e.status === 400,
  );
});

test('unknown id → 400', async () => {
  await assert.rejects(
    () => resolveAndValidateAddress({ governorate: 999 }, mockDb()),
    (e: any) => e.status === 400,
  );
});

test('wrong level (a level-2 id passed as governorate) → 400', async () => {
  await assert.rejects(
    () => resolveAndValidateAddress({ governorate: 2 }, mockDb()),
    (e: any) => e.status === 400,
  );
});

test('broken parent chain (city not under the given governorate) → 400', async () => {
  // governorate=9 (حلب) but city=2 (المزة, child of 1) → mismatch.
  await assert.rejects(
    () => resolveAndValidateAddress({ governorate: 9, cityOrArea: 2 }, mockDb()),
    (e: any) => e.status === 400,
  );
});
