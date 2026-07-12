type Queryable = {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
};

export type CatalogUnavailableReason = 'missing_or_deleted' | 'inactive';

export interface CatalogUnavailableEntry {
  id: number;
  name: string | null;
  reason: CatalogUnavailableReason;
}

function normalizePositiveIds(ids: Array<number | string | null | undefined>) {
  return [...new Set(
    ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0),
  )];
}

export async function findUnavailableDeviceModelsForNewCommercialUse(
  db: Queryable,
  ids: Array<number | string | null | undefined>,
): Promise<CatalogUnavailableEntry[]> {
  const normalizedIds = normalizePositiveIds(ids);
  if (normalizedIds.length === 0) return [];

  const { rows } = await db.query<CatalogUnavailableEntry>(
    `WITH requested(id) AS (
       SELECT unnest($1::int[])
     )
     SELECT requested.id,
            COALESCE(dm.name_ar, dm.name) AS name,
            CASE
              WHEN dm.id IS NULL OR dm.deleted_at IS NOT NULL THEN 'missing_or_deleted'
              ELSE 'inactive'
            END AS reason
       FROM requested
       LEFT JOIN device_models dm ON dm.id = requested.id
      WHERE dm.id IS NULL
         OR dm.deleted_at IS NOT NULL
         OR dm.is_active IS NOT TRUE`,
    [normalizedIds],
  );
  return rows;
}

export async function findUnavailableSparePartsForNewCommercialUse(
  db: Queryable,
  ids: Array<number | string | null | undefined>,
): Promise<CatalogUnavailableEntry[]> {
  const normalizedIds = normalizePositiveIds(ids);
  if (normalizedIds.length === 0) return [];

  const { rows } = await db.query<CatalogUnavailableEntry>(
    `WITH requested(id) AS (
       SELECT unnest($1::int[])
     )
     SELECT requested.id,
            COALESCE(sp.name, sp.code) AS name,
            CASE
              WHEN sp.id IS NULL OR sp.deleted_at IS NOT NULL THEN 'missing_or_deleted'
              ELSE 'inactive'
            END AS reason
       FROM requested
       LEFT JOIN spare_parts sp ON sp.id = requested.id
      WHERE sp.id IS NULL
         OR sp.deleted_at IS NOT NULL
         OR sp.is_active IS NOT TRUE`,
    [normalizedIds],
  );
  return rows;
}

export function catalogUnavailablePayload(itemType: 'device_model' | 'spare_part', items: CatalogUnavailableEntry[]) {
  return {
    error: `${itemType} is unavailable for new commercial use`,
    code: 'catalog_item_unavailable_for_new_commercial_use',
    itemType,
    items,
  };
}
