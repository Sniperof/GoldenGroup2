import pool from '../db.js';
import {
  listPublicDeviceCatalog,
  type DeviceCatalogQueryable,
} from './appDeviceCatalogService.js';

export interface PublicBranchCatalogFilters {
  search?: string;
  geoUnitId?: number;
}

interface BranchAttachment {
  id: string;
  name: string;
  url: string;
}

const PUBLIC_CONTACT_TYPES = new Set(['email', 'phone', 'mobile', 'website']);

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function serializeImages(value: unknown): BranchAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = nullableText(record.id);
    const name = nullableText(record.name);
    const url = nullableText(record.url);
    return id && name && url ? [{ id, name, url }] : [];
  });
}

function primaryImage(row: any, images: BranchAttachment[]) {
  const id = nullableText(row.primaryImageId);
  return images.find((image) => image.id === id) ?? images[0] ?? null;
}

function mapLocation(row: any) {
  if (row.latitude == null || row.longitude == null) return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function serializeCustomerServiceContacts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const type = nullableText(record.type);
    const valueText = nullableText(record.value);
    if (record.department !== 'customer_service' || !type || !PUBLIC_CONTACT_TYPES.has(type) || !valueText) return [];
    return [{ type, value: valueText }];
  });
}

export function serializePublicBranchListItem(row: any) {
  const images = serializeImages(row.images);
  return {
    id: Number(row.id),
    name: nullableText(row.name) ?? '',
    description: nullableText(row.publicDescription),
    locationName: nullableText(row.locationName),
    address: nullableText(row.detailedAddress),
    primaryImage: primaryImage(row, images),
    mapLocation: mapLocation(row),
  };
}

export function serializePublicBranchDetails(row: any) {
  const images = serializeImages(row.images);
  return {
    ...serializePublicBranchListItem(row),
    images,
    contacts: serializeCustomerServiceContacts(row.contactInfo),
  };
}

const PUBLIC_BRANCH_COLUMNS = `
  branch.id,
  branch.name,
  branch.public_description AS "publicDescription",
  branch.detailed_address AS "detailedAddress",
  geo.name AS "locationName",
  branch.images,
  branch.primary_image_id AS "primaryImageId",
  branch.latitude,
  branch.longitude
`;

export async function listPublicBranches(
  filters: PublicBranchCatalogFilters = {},
  db: DeviceCatalogQueryable = pool,
) {
  const conditions = [`branch.status = 'active'`, 'branch.mobile_visible = TRUE'];
  const params: any[] = [];
  const search = nullableText(filters.search);
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(
      branch.name ILIKE $${params.length}
      OR branch.detailed_address ILIKE $${params.length}
      OR geo.name ILIKE $${params.length}
    )`);
  }
  if (filters.geoUnitId != null) {
    params.push(filters.geoUnitId);
    conditions.push(`branch.location_geo_id = $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT ${PUBLIC_BRANCH_COLUMNS}
       FROM branches branch
       LEFT JOIN geo_units geo ON geo.id = branch.location_geo_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY branch.mobile_display_order, branch.name, branch.id`,
    params,
  );
  return { items: rows.map(serializePublicBranchListItem) };
}

export async function getPublicBranchDetails(
  branchId: number,
  db: DeviceCatalogQueryable = pool,
) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_BRANCH_COLUMNS},
            COALESCE(branch.contact_info, '[]'::jsonb) AS "contactInfo"
       FROM branches branch
       LEFT JOIN geo_units geo ON geo.id = branch.location_geo_id
      WHERE branch.id = $1
        AND branch.status = 'active'
        AND branch.mobile_visible = TRUE
      LIMIT 1`,
    [branchId],
  );
  if (!rows[0]) return null;

  const branch = serializePublicBranchDetails(rows[0]);
  const { items: devices } = await listPublicDeviceCatalog({ salesBranchId: branchId }, db);
  return { ...branch, devices };
}
