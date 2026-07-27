import pool from '../db.js';

type QueryResult<Row> = { rows: Row[] };

export interface DeviceCatalogQueryable {
  query(sql: string, params?: any[]): Promise<QueryResult<any>>;
}

export interface PublicCatalogFilters {
  featured?: boolean;
  category?: string;
  search?: string;
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
    maintenanceInterval: nullableText(row.maintenanceInterval),
    services: serializeServices(row.supportedVisitTypes),
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

export async function listPublicDeviceCatalog(
  filters: PublicCatalogFilters = {},
  db: DeviceCatalogQueryable = pool,
) {
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

  const { rows } = await db.query(
    `SELECT ${PUBLIC_DEVICE_COLUMNS}
       FROM device_models
      WHERE ${conditions.join(' AND ')}
      ORDER BY is_featured DESC, COALESCE(name_ar, name) ASC, id ASC`,
    params,
  );

  return { items: rows.map(serializePublicDeviceListItem) };
}

export async function getPublicDeviceCatalogDetails(
  deviceId: number,
  db: DeviceCatalogQueryable = pool,
) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_DEVICE_COLUMNS}
       FROM device_models
      WHERE id = $1
        AND deleted_at IS NULL
        AND is_active = TRUE
      LIMIT 1`,
    [deviceId],
  );

  return rows[0] ? serializePublicDeviceDetails(rows[0]) : null;
}
