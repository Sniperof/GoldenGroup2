import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileAddress } from './appProfileService.js';
import { pickContactDetails } from '../customerIdentity/identitySnapshot.js';

// The ancestor walk returns rows in no guaranteed order — a recursive CTE
// yields the deepest unit first — so the builder must key off `level`, never
// position.
const FULL_PATH = [
  { id: 402, level: 4, name: 'باب شرقي' },
  { id: 303, level: 3, name: 'الحميدية' },
  { id: 2, level: 2, name: 'دمشق القديمة' },
  { id: 248, level: 1, name: 'دمشق' },
];

test('a four-level chain yields paired names and ids', () => {
  const r = buildProfileAddress(FULL_PATH, 'شارع بغداد');
  assert.deepEqual(r.address, {
    governorate: 'دمشق',
    cityOrArea: 'دمشق القديمة',
    subArea: 'الحميدية',
    neighborhood: 'باب شرقي',
    detailedAddress: 'شارع بغداد',
  });
  assert.deepEqual(r.addressIds, {
    governorate: 248, cityOrArea: 2, subArea: 303, neighborhood: 402,
  });
  assert.equal(r.geoUnitId, 402);
});

test('the intermediate level is reconstructed, not read from a column', () => {
  // This is the whole point: the client record stores only the deepest unit,
  // and level 3 exists in the result purely because the walk found it.
  const r = buildProfileAddress(FULL_PATH, null);
  assert.equal(r.addressIds.subArea, 303);
});

test('a shallower chain leaves the deeper levels null and reports its own depth', () => {
  const r = buildProfileAddress(FULL_PATH.filter((x) => x.level <= 3), null);
  assert.equal(r.addressIds.neighborhood, null);
  assert.equal(r.address.neighborhood, null);
  assert.equal(r.addressIds.subArea, 303);
  assert.equal(r.geoUnitId, 303);
});

test('a client with no geography yields nulls, never a partial guess', () => {
  const r = buildProfileAddress([], null);
  assert.deepEqual(r.addressIds, {
    governorate: null, cityOrArea: null, subArea: null, neighborhood: null,
  });
  assert.equal(r.geoUnitId, null);
  assert.equal(r.address.governorate, null);
});

test('detailedAddress passes through untouched, including null', () => {
  assert.equal(buildProfileAddress([], null).address.detailedAddress, null);
  assert.equal(buildProfileAddress(FULL_PATH, '').address.detailedAddress, '');
});

test('ids arriving as strings from the driver are coerced to numbers', () => {
  const r = buildProfileAddress(
    [{ id: '248' as unknown as number, level: 1, name: 'دمشق' }],
    null,
  );
  assert.strictEqual(r.addressIds.governorate, 248);
  assert.strictEqual(r.geoUnitId, 248);
});

test('an out-of-range level is ignored rather than mismapped', () => {
  const r = buildProfileAddress([...FULL_PATH, { id: 999, level: 5, name: 'x' }], null);
  assert.equal(r.geoUnitId, 402);
  assert.ok(!Object.values(r.addressIds).includes(999));
});

test('profile contact projection exposes the WhatsApp flags used by mobile forms', () => {
  const result = pickContactDetails(
    [
      { number: '0912345678', isPrimary: true, status: 'active', hasWhatsApp: true },
      { number: '0998765432', isPrimary: false, status: 'active', hasWhatsApp: false },
    ],
    '0912345678',
  );

  assert.deepEqual(result, {
    primaryHasWhatsapp: true,
    secondaryPhone: '0998765432',
    secondaryHasWhatsapp: false,
  });
});
