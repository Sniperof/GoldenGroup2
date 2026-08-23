import pool from '../db.js';

type QueryResult<Row> = { rows: Row[] };

export interface DeviceCatalogQueryable {
  query(sql: string, params?: any[]): Promise<QueryResult<any>>;
}

export interface PublicCatalogFilters {
  featured?: boolean;
  category?: string;
  search?: string;
  salesBranchId?: number;
}

export interface PublicCatalogPagination {
  page: number;
  limit: number;
  fields?: 'full' | 'names';
}

interface CatalogAttachment {
  id: string;
  name: string;
  url: string;
}

interface WarrantyPeriod {
  months: number;
  label: string;
  visits?: number;
}

interface ActiveDiscount {
  label: string;
  percentage: number;
  validUntil: string;
}

interface PurchaseBenefit {
  code: 'delivery' | 'installation' | 'training' | 'maintenance';
  labelAr: string;
  included: true;
}

const PURCHASE_BENEFITS: Array<{
  service: PublicDeviceService;
  benefit: PurchaseBenefit;
}> = [
  { service: 'تسليم', benefit: { code: 'delivery', labelAr: 'توصيل الجهاز إلى مكان التركيب', included: true } },
  { service: 'تركيب', benefit: { code: 'installation', labelAr: 'تركيب الجهاز', included: true } },
  { service: 'تعليم', benefit: { code: 'training', labelAr: 'تدريب على استخدام الجهاز', included: true } },
  { service: 'صيانة', benefit: { code: 'maintenance', labelAr: 'صيانة حسب العرض المقدم', included: true } },
];

const PUBLIC_DEVICE_SERVICES = ['تسليم', 'تركيب', 'صيانة', 'تعليم'] as const;
type PublicDeviceService = typeof PUBLIC_DEVICE_SERVICES[number];

const PUBLIC_DEVICE_COLUMNS = `
  id,
  name,
  code,
  name_ar AS "nameAr",
  name_en AS "nameEn",
  category,
  maintenance_interval AS "maintenanceInterval",
  supported_visit_types AS "supportedVisitTypes",
  is_golden_warranty AS "isGoldenWarranty",
  golden_warranty_periods AS "goldenWarrantyPeriods",
  warranty_periods AS "warrantyPeriods",
  is_featured AS "isFeatured",
  description AS "descriptionAr",
  description_en AS "descriptionEn",
  images,
  primary_image_id AS "primaryImageId",
  videos
`;

const PUBLIC_DEVICE_LIST_COLUMNS = `${PUBLIC_DEVICE_COLUMNS},
  (
    SELECT jsonb_build_object(
      'label', discount.label,
      'percentage', discount.percentage,
      'validUntil', discount.end_date
    )
    FROM device_discounts discount
    WHERE discount.device_model_id = device_models.id
      AND discount.is_active = TRUE
      AND discount.start_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
      AND discount.end_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Damascus')::date
    ORDER BY discount.end_date ASC, discount.id ASC
    LIMIT 1
  ) AS "activeDiscount"
`;

const PUBLIC_DEVICE_NAME_COLUMNS = `
  id,
  name,
  name_ar AS "nameAr",
  name_en AS "nameEn"
`;

const PUBLIC_DEVICE_DETAILS_COLUMNS = `${PUBLIC_DEVICE_LIST_COLUMNS},
  documents,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', branch.id,
      'name', branch.name,
      'address', COALESCE(NULLIF(branch.detailed_address, ''), geo.name),
      'locationName', geo.name,
      'images', COALESCE(branch.images, '[]'::jsonb),
      'primaryImageId', branch.primary_image_id
    ) ORDER BY link.display_order, branch.name, branch.id)
    FROM device_model_sales_branches link
    JOIN branches branch
      ON branch.id = link.branch_id
     AND branch.status = 'active'
     AND branch.mobile_visible = TRUE
    LEFT JOIN geo_units geo ON geo.id = branch.location_geo_id
    WHERE link.device_model_id = device_models.id
      AND link.is_active = TRUE
  ), '[]'::jsonb) AS "availableBranches",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', part.id,
      'name', part.name,
      'code', part.code
    ) ORDER BY part.name, part.id)
    FROM spare_parts part
    WHERE part.deleted_at IS NULL
      AND part.is_active = TRUE
      AND part.maintenance_type = 'Accessory'
      AND COALESCE(part.compatible_device_ids, '[]'::jsonb) @> jsonb_build_array(device_models.id)
  ), '[]'::jsonb) AS accessories
`;

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function serializeAttachments(value: unknown): CatalogAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = nullableText(record.id);
    const url = nullableText(record.url);
    if (!id || !url) return [];

    return [{
      id,
      name: nullableText(record.name) ?? '',
      url,
    }];
  });
}

function serializeWarrantyPeriods(value: unknown, includeVisits: boolean): WarrantyPeriod[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const months = Number(record.months);
    if (!Number.isInteger(months) || months <= 0) return [];

    const period: WarrantyPeriod = {
      months,
      label: nullableText(record.label) ?? `${months} شهر`,
    };
    const visits = Number(record.visits);
    if (includeVisits && Number.isInteger(visits) && visits >= 0) {
      period.visits = visits;
    }
    return [period];
  });
}

function serializeServices(value: unknown): PublicDeviceService[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PublicDeviceService =>
      typeof item === 'string'
      && PUBLIC_DEVICE_SERVICES.includes(item as PublicDeviceService),
  );
}

function serializeActiveDiscount(value: unknown): ActiveDiscount | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const label = nullableText(record.label);
  const percentage = Number(record.percentage);
  const validUntil = nullableText(record.validUntil);
  if (!label || !Number.isFinite(percentage) || percentage < 0 || percentage > 100 || !validUntil) {
    return null;
  }

  return { label, percentage, validUntil };
}

function serializePurchaseBenefits(value: unknown): PurchaseBenefit[] {
  const services = new Set(serializeServices(value));
  return PURCHASE_BENEFITS
    .filter(({ service }) => services.has(service))
    .map(({ benefit }) => benefit);
}

function serializeIdNameItems(value: unknown, includeAddress: boolean) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    const name = nullableText(record.name);
    if (!Number.isInteger(id) || id <= 0 || !name) return [];
    return [{
      id,
      name,
      ...(includeAddress
        ? { address: nullableText(record.address) }
        : { code: nullableText(record.code) }),
    }];
  });
}

function serializeAvailableBranches(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    const name = nullableText(record.name);
    if (!Number.isInteger(id) || id <= 0 || !name) return [];
    const images = serializeAttachments(record.images);
    return [{
      id,
      name,
      locationName: nullableText(record.locationName),
      address: nullableText(record.address),
      primaryImage: publicPrimaryImage({ primaryImageId: record.primaryImageId }, images),
    }];
  });
}

function publicNames(row: any) {
  return {
    nameAr: nullableText(row.nameAr) ?? nullableText(row.name) ?? '',
    nameEn: nullableText(row.nameEn),
  };
}

function publicPrimaryImage(row: any, images: CatalogAttachment[]): CatalogAttachment | null {
  const primaryImageId = nullableText(row.primaryImageId);
  return images.find((image) => image.id === primaryImageId) ?? images[0] ?? null;
}

export function serializePublicDeviceListItem(row: any) {
  const images = serializeAttachments(row.images);
  return {
    id: Number(row.id),
    ...publicNames(row),
    code: nullableText(row.code),
    category: nullableText(row.category),
    summary: nullableText(row.descriptionAr),
    primaryImage: publicPrimaryImage(row, images),
    services: serializeServices(row.supportedVisitTypes),
    goldenWarrantyAvailable: row.isGoldenWarranty === true,
    activeDiscount: serializeActiveDiscount(row.activeDiscount),
    isFeatured: row.isFeatured === true,
  };
}

export function serializePublicDeviceDetails(row: any) {
  const images = serializeAttachments(row.images);
  return {
    id: Number(row.id),
    ...publicNames(row),
    code: nullableText(row.code),
    category: nullableText(row.category),
    descriptionAr: nullableText(row.descriptionAr),
    descriptionEn: nullableText(row.descriptionEn),
    primaryImage: publicPrimaryImage(row, images),
    images,
    videos: serializeAttachments(row.videos),
    catalogs: serializeAttachments(row.documents),
    maintenanceInterval: nullableText(row.maintenanceInterval),
    services: serializeServices(row.supportedVisitTypes),
    purchaseBenefits: serializePurchaseBenefits(row.supportedVisitTypes),
    availableBranches: serializeAvailableBranches(row.availableBranches),
    accessories: serializeIdNameItems(row.accessories, false),
    activeDiscount: serializeActiveDiscount(row.activeDiscount),
    warranty: {
      standardPeriods: serializeWarrantyPeriods(row.warrantyPeriods, true),
      goldenAvailable: row.isGoldenWarranty === true,
      goldenPeriods: row.isGoldenWarranty === true
        ? serializeWarrantyPeriods(row.goldenWarrantyPeriods, false)
        : [],
    },
    isFeatured: row.isFeatured === true,
  };
}

function buildPublicCatalogWhere(filters: PublicCatalogFilters) {
  const conditions = ['deleted_at IS NULL', 'is_active = TRUE'];
  const params: any[] = [];

  if (filters.featured === true) {
    conditions.push('is_featured = TRUE');
  }

  const category = nullableText(filters.category);
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const search = nullableText(filters.search);
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(
      name ILIKE $${params.length}
      OR name_ar ILIKE $${params.length}
      OR name_en ILIKE $${params.length}
      OR code ILIKE $${params.length}
      OR category ILIKE $${params.length}
    )`);
  }

  if (filters.salesBranchId != null) {
    params.push(filters.salesBranchId);
    conditions.push(`EXISTS (
      SELECT 1
      FROM device_model_sales_branches sales_link
      JOIN branches sales_branch
        ON sales_branch.id = sales_link.branch_id
       AND sales_branch.status = 'active'
       AND sales_branch.mobile_visible = TRUE
      WHERE sales_link.device_model_id = device_models.id
        AND sales_link.branch_id = $${params.length}
        AND sales_link.is_active = TRUE
    )`);
  }

  return { conditions, params };
}

export function serializePublicDeviceNameItem(row: any) {
  return {
    id: Number(row.id),
    nameAr: nullableText(row.nameAr) ?? nullableText(row.name) ?? '',
    nameEn: nullableText(row.nameEn),
  };
}

export async function listPublicDeviceCatalog(
  filters: PublicCatalogFilters = {},
  db: DeviceCatalogQueryable = pool,
) {
  const { conditions, params } = buildPublicCatalogWhere(filters);

  const { rows } = await db.query(
    `SELECT ${PUBLIC_DEVICE_LIST_COLUMNS}
       FROM device_models
      WHERE ${conditions.join(' AND ')}
      ORDER BY is_featured DESC, COALESCE(name_ar, name) ASC, id ASC`,
    params,
  );

  return { items: rows.map(serializePublicDeviceListItem) };
}

export async function listPublicDeviceCatalogPage(
  filters: PublicCatalogFilters,
  pagination: PublicCatalogPagination,
  db: DeviceCatalogQueryable = pool,
) {
  const { conditions, params } = buildPublicCatalogWhere(filters);
  const offset = (pagination.page - 1) * pagination.limit;
  const pageParams = [...params, pagination.limit, offset];
  const limitRef = `$${params.length + 1}`;
  const offsetRef = `$${params.length + 2}`;
  const where = conditions.join(' AND ');
  const namesOnly = pagination.fields === 'names';
  const columns = namesOnly ? PUBLIC_DEVICE_NAME_COLUMNS : PUBLIC_DEVICE_LIST_COLUMNS;

  const [pageResult, countResult] = await Promise.all([
    db.query(
      `SELECT ${columns}
         FROM device_models
        WHERE ${where}
        ORDER BY is_featured DESC, COALESCE(name_ar, name) ASC, id ASC
        LIMIT ${limitRef} OFFSET ${offsetRef}`,
      pageParams,
    ),
    db.query(
      `SELECT COUNT(*)::int AS total
         FROM device_models
        WHERE ${where}`,
      params,
    ),
  ]);

  return {
    items: pageResult.rows.map(namesOnly ? serializePublicDeviceNameItem : serializePublicDeviceListItem),
    total: Number(countResult.rows[0]?.total ?? 0),
    page: pagination.page,
    limit: pagination.limit,
  };
}

export async function getPublicDeviceCatalogDetails(
  deviceId: number,
  db: DeviceCatalogQueryable = pool,
) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_DEVICE_DETAILS_COLUMNS}
       FROM device_models
      WHERE id = $1
        AND deleted_at IS NULL
        AND is_active = TRUE
      LIMIT 1`,
    [deviceId],
  );

  return rows[0] ? serializePublicDeviceDetails(rows[0]) : null;
}
