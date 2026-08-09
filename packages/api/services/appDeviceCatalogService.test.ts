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
  availableBranches: [
    {
      id: 2,
      name: 'فرع دمشق',
      locationName: 'دمشق',
      address: 'دمشق - كفرسوسة',
      images: [{ id: 'branch-main', name: 'واجهة الفرع', url: '/uploads/branch.jpg' }],
      primaryImageId: 'branch-main',
    },
    { id: 'invalid', name: 'فرع غير صالح' },
  ],
  accessories: [
    { id: 9, name: 'حنفية إضافية', code: 'ACC-9' },
    { id: 10, code: 'MISSING-NAME' },
  ],
  activeDiscount: {
    id: 15,
    label: 'عرض الصيف',
    percentage: '10',
    startDate: '2026-08-01',
    validUntil: '2026-08-31',
  },
  basePrice: '999999',
  documents: [
    { id: 'catalog-ar', name: 'الكاتلوك العربي', url: '/uploads/catalog-ar.pdf' },
    { id: 'broken-catalog', name: 'بدون رابط' },
  ],
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
    goldenWarrantyAvailable: true,
    activeDiscount: {
      label: 'عرض الصيف',
      percentage: 10,
      validUntil: '2026-08-31',
    },
    isFeatured: true,
  });
});

test('public list returns null when there is no valid active discount', () => {
  const item = serializePublicDeviceListItem({
    ...sourceRow,
    isGoldenWarranty: false,
    activeDiscount: null,
  });

  assert.equal(item.goldenWarrantyAvailable, false);
  assert.equal(item.activeDiscount, null);
});

test('public details expose benefits, branches, accessories, catalogs, and active discount', () => {
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
  assert.deepEqual(details.purchaseBenefits, [
    { code: 'delivery', labelAr: 'توصيل الجهاز إلى مكان التركيب', included: true },
    { code: 'installation', labelAr: 'تركيب الجهاز', included: true },
    { code: 'training', labelAr: 'تدريب على استخدام الجهاز', included: true },
    { code: 'maintenance', labelAr: 'صيانة حسب العرض المقدم', included: true },
  ]);
  assert.deepEqual(details.availableBranches, [
    {
      id: 2,
      name: 'فرع دمشق',
      locationName: 'دمشق',
      address: 'دمشق - كفرسوسة',
      primaryImage: { id: 'branch-main', name: 'واجهة الفرع', url: '/uploads/branch.jpg' },
    },
  ]);
  assert.deepEqual(details.accessories, [
    { id: 9, name: 'حنفية إضافية', code: 'ACC-9' },
  ]);
  assert.deepEqual(details.catalogs, [
    { id: 'catalog-ar', name: 'الكاتلوك العربي', url: '/uploads/catalog-ar.pdf' },
  ]);
  assert.deepEqual(details.activeDiscount, {
    label: 'عرض الصيف', percentage: 10, validUntil: '2026-08-31',
  });
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
  assert.match(capturedSql, /FROM device_discounts discount/);
  assert.match(capturedSql, /discount\.is_active = TRUE/);
  assert.match(capturedSql, /discount\.start_date <= \(CURRENT_TIMESTAMP AT TIME ZONE 'Asia\/Damascus'\)::date/);
  assert.match(capturedSql, /discount\.end_date >= \(CURRENT_TIMESTAMP AT TIME ZONE 'Asia\/Damascus'\)::date/);
  assert.match(capturedSql, /AS "activeDiscount"/);
  assert.match(capturedSql, /LIMIT 1/);
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
  assert.match(capturedSql, /FROM device_model_sales_branches link/);
  assert.match(capturedSql, /branch\.status = 'active'/);
  assert.match(capturedSql, /branch\.mobile_visible = TRUE/);
  assert.match(capturedSql, /link\.is_active = TRUE/);
  assert.match(capturedSql, /FROM spare_parts part/);
  assert.match(capturedSql, /part\.deleted_at IS NULL/);
  assert.match(capturedSql, /part\.is_active = TRUE/);
  assert.match(capturedSql, /part\.maintenance_type = 'Accessory'/);
  assert.match(capturedSql, /compatible_device_ids/);
  assert.match(capturedSql, /documents/);
  assert.match(capturedSql, /FROM device_discounts discount/);
});
