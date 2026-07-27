import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPublicDeviceCatalogDetails,
  listPublicDeviceCatalog,
  serializePublicDeviceDetails,
  serializePublicDeviceListItem,
  type DeviceCatalogQueryable,
} from './appDeviceCatalogService.js';

const sourceRow = {
  id: '7',
  name: 'Fallback',
  nameAr: 'جهاز تجريبي',
  nameEn: 'Demo Device',
  brand: 'قيمة قديمة غير مستخدمة',
  code: 'GG-TEST-7',
  category: 'منزلي',
  maintenanceInterval: '6 أشهر',
  supportedVisitTypes: ['تسليم', 'تركيب', 'صيانة', 'تعليم', 'قيمة غير معتمدة'],
  isGoldenWarranty: true,
  goldenWarrantyPeriods: [{ months: 12, label: 'سنة' }],
  warrantyPeriods: [{ months: 24, label: 'سنتان', visits: 4 }],
  isFeatured: true,
  descriptionAr: 'وصف عام',
  descriptionEn: 'Public description',
  images: [
    { id: 'secondary', name: 'جانب', url: '/uploads/side.jpg' },
    { id: 'primary', name: 'أمام', url: '/uploads/front.jpg' },
    { id: 'broken', name: 'بدون رابط' },
  ],
  primaryImageId: 'primary',
  videos: [{ id: 'video-1', name: 'عرض', url: '/uploads/demo.mp4' }],
  basePrice: '999999',
  documents: [{ id: 'internal', url: '/uploads/internal.pdf' }],
  isActive: true,
};

test('public list projection is data-minimized and resolves the primary image', () => {
  assert.deepEqual(serializePublicDeviceListItem(sourceRow), {
    id: 7,
    nameAr: 'جهاز تجريبي',
    nameEn: 'Demo Device',
    code: 'GG-TEST-7',
    category: 'منزلي',
    summary: 'وصف عام',
    primaryImage: { id: 'primary', name: 'أمام', url: '/uploads/front.jpg' },
    services: ['تسليم', 'تركيب', 'صيانة', 'تعليم'],
    isFeatured: true,
  });
});

test('public details expose the model code while omitting price, documents, and operational fields', () => {
  const details = serializePublicDeviceDetails(sourceRow);
  assert.deepEqual(details.warranty, {
    standardPeriods: [{ months: 24, label: 'سنتان', visits: 4 }],
    goldenAvailable: true,
    goldenPeriods: [{ months: 12, label: 'سنة' }],
  });
  assert.equal(details.images.length, 2);
  assert.equal(details.primaryImage?.id, 'primary');
  assert.equal(details.code, 'GG-TEST-7');
  assert.deepEqual(details.services, ['تسليم', 'تركيب', 'صيانة', 'تعليم']);
  for (const forbidden of ['basePrice', 'documents', 'brand', 'supportedVisitTypes', 'isActive']) {
    assert.equal(Object.hasOwn(details, forbidden), false, `${forbidden} leaked to public details`);
  }
});

test('catalog list enforces published state in SQL and parameterizes public filters', async () => {
  let capturedSql = '';
  let capturedParams: any[] = [];
  const db: DeviceCatalogQueryable = {
    async query(sql, params = []) {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [sourceRow] };
    },
  };

  const result = await listPublicDeviceCatalog({
    featured: true,
    category: 'منزلي',
    search: 'فلتر',
  }, db);

  assert.equal(result.items.length, 1);
  assert.match(capturedSql, /deleted_at IS NULL/);
  assert.match(capturedSql, /is_active = TRUE/);
  assert.match(capturedSql, /is_featured = TRUE/);
  assert.match(capturedSql, /category = \$1/);
  assert.match(capturedSql, /name_ar ILIKE \$2/);
  assert.deepEqual(capturedParams, ['منزلي', '%فلتر%']);
});

test('catalog details hide inactive and deleted devices at the query boundary', async () => {
  let capturedSql = '';
  const db: DeviceCatalogQueryable = {
    async query(sql) {
      capturedSql = sql;
      return { rows: [] };
    },
  };

  assert.equal(await getPublicDeviceCatalogDetails(42, db), null);
  assert.match(capturedSql, /id = \$1/);
  assert.match(capturedSql, /deleted_at IS NULL/);
  assert.match(capturedSql, /is_active = TRUE/);
});
