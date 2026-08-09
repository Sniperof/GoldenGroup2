import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPublicBranchDetails,
  listPublicBranches,
  serializePublicBranchDetails,
  serializePublicBranchListItem,
} from './appBranchCatalogService.js';
import type { DeviceCatalogQueryable } from './appDeviceCatalogService.js';

const sourceBranch = {
  id: '2',
  name: 'فرع دمشق',
  publicDescription: 'الفرع الرئيسي',
  detailedAddress: 'الحميدية',
  locationName: 'دمشق',
  images: [
    { id: 'side', name: 'صورة جانبية', url: '/uploads/side.jpg' },
    { id: 'main', name: 'واجهة الفرع', url: '/uploads/main.jpg' },
    { id: 'broken', name: 'بدون رابط' },
  ],
  primaryImageId: 'main',
  latitude: '33.5138',
  longitude: '36.2765',
  contactInfo: [
    { id: '1', type: 'mobile', department: 'customer_service', value: '0999999999', label: 'عام' },
    { id: '2', type: 'phone', department: 'hr', value: '0111111111', label: 'داخلي' },
    { id: '3', type: 'unsupported', department: 'customer_service', value: 'secret' },
  ],
};

test('public branch list item exposes card data and resolves its primary image', () => {
  assert.deepEqual(serializePublicBranchListItem(sourceBranch), {
    id: 2,
    name: 'فرع دمشق',
    description: 'الفرع الرئيسي',
    locationName: 'دمشق',
    address: 'الحميدية',
    primaryImage: { id: 'main', name: 'واجهة الفرع', url: '/uploads/main.jpg' },
    mapLocation: { latitude: 33.5138, longitude: 36.2765 },
  });
});

test('public branch details expose only customer-service contacts and omit labels', () => {
  const details = serializePublicBranchDetails(sourceBranch);
  assert.equal(details.images.length, 2);
  assert.deepEqual(details.contacts, [{ type: 'mobile', value: '0999999999' }]);
  assert.equal(Object.hasOwn(details.contacts[0], 'department'), false);
  assert.equal(Object.hasOwn(details.contacts[0], 'label'), false);
});

test('public branch map location is null unless both coordinates exist', () => {
  const item = serializePublicBranchListItem({ ...sourceBranch, latitude: null, longitude: null });
  assert.equal(item.mapLocation, null);
});

test('branch list enforces publication and parameterizes search and geo filters', async () => {
  let sql = '';
  let params: any[] = [];
  const db: DeviceCatalogQueryable = {
    async query(query, values = []) {
      sql = query;
      params = values;
      return { rows: [sourceBranch] };
    },
  };
  const result = await listPublicBranches({ search: 'دمشق', geoUnitId: 12 }, db);
  assert.equal(result.items.length, 1);
  assert.match(sql, /branch\.status = 'active'/);
  assert.match(sql, /branch\.mobile_visible = TRUE/);
  assert.match(sql, /branch\.name ILIKE \$1/);
  assert.match(sql, /branch\.location_geo_id = \$2/);
  assert.match(sql, /ORDER BY branch\.mobile_display_order/);
  assert.deepEqual(params, ['%دمشق%', 12]);
});

test('branch details include only devices actively sold by the published branch', async () => {
  const calls: string[] = [];
  const db: DeviceCatalogQueryable = {
    async query(sql) {
      calls.push(sql);
      return calls.length === 1 ? { rows: [sourceBranch] } : { rows: [] };
    },
  };
  const details = await getPublicBranchDetails(2, db);
  assert.ok(details);
  assert.deepEqual(details.devices, []);
  assert.match(calls[0], /branch\.mobile_visible = TRUE/);
  assert.match(calls[1], /FROM device_model_sales_branches sales_link/);
  assert.match(calls[1], /sales_link\.is_active = TRUE/);
  assert.match(calls[1], /sales_branch\.mobile_visible = TRUE/);
});

test('hidden or inactive branch details resolve to null without a device query', async () => {
  let calls = 0;
  const db: DeviceCatalogQueryable = { async query() { calls += 1; return { rows: [] }; } };
  assert.equal(await getPublicBranchDetails(99, db), null);
  assert.equal(calls, 1);
});
