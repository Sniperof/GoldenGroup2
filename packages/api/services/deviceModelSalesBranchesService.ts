import pool from '../db.js';

type QueryResult<Row> = { rows: Row[] };

export interface SalesBranchesQueryable {
  query(sql: string, params?: any[]): Promise<QueryResult<any>>;
}

interface SalesBranchesClient extends SalesBranchesQueryable {
  release(): void;
}

interface SalesBranchesPool {
  connect(): Promise<SalesBranchesClient>;
}

export class SalesBranchesValidationError extends Error {
  status = 400;
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class DeviceModelNotFoundError extends Error {
  status = 404;
  code = 'DEVICE_MODEL_NOT_FOUND';

  constructor() {
    super('الجهاز غير موجود');
  }
}

function normalizeBranchIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new SalesBranchesValidationError('INVALID_BRANCH_IDS', 'branchIds must be an array');
  }

  const ids = value.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new SalesBranchesValidationError('INVALID_BRANCH_IDS', 'branchIds must contain positive integers only');
  }
  return [...new Set(ids)];
}

export async function getDeviceModelSalesBranches(
  deviceModelId: number,
  db: SalesBranchesQueryable = pool,
) {
  const { rows: modelRows } = await db.query(
    'SELECT id FROM device_models WHERE id = $1 AND deleted_at IS NULL',
    [deviceModelId],
  );
  if (!modelRows.length) throw new DeviceModelNotFoundError();

  const { rows } = await db.query(
    `SELECT b.id,
            b.name,
            b.detailed_address AS "detailedAddress",
            g.name AS "locationGeoName",
            (link.id IS NOT NULL AND link.is_active = TRUE) AS "isSelected"
       FROM branches b
       LEFT JOIN geo_units g ON g.id = b.location_geo_id
       LEFT JOIN device_model_sales_branches link
         ON link.branch_id = b.id
        AND link.device_model_id = $1
      WHERE b.status = 'active'
      ORDER BY COALESCE(link.display_order, 2147483647), b.name, b.id`,
    [deviceModelId],
  );

  return { deviceModelId, branches: rows };
}

export async function replaceDeviceModelSalesBranches(
  deviceModelId: number,
  branchIdsValue: unknown,
  actorId: number | null,
  dbPool: SalesBranchesPool = pool,
) {
  const branchIds = normalizeBranchIds(branchIdsValue);
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    const { rows: modelRows } = await client.query(
      'SELECT id FROM device_models WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [deviceModelId],
    );
    if (!modelRows.length) throw new DeviceModelNotFoundError();

    if (branchIds.length > 0) {
      const { rows } = await client.query(
        `SELECT id FROM branches WHERE id = ANY($1::int[]) AND status = 'active'`,
        [branchIds],
      );
      const validIds = new Set(rows.map((row: any) => Number(row.id)));
      const unavailableBranchIds = branchIds.filter((id) => !validIds.has(id));
      if (unavailableBranchIds.length) {
        throw new SalesBranchesValidationError(
          'UNAVAILABLE_BRANCHES',
          'One or more branches do not exist or are inactive',
          { branchIds: unavailableBranchIds },
        );
      }
    }

    await client.query(
      `UPDATE device_model_sales_branches
          SET is_active = FALSE, updated_by = $2, updated_at = NOW()
        WHERE device_model_id = $1 AND is_active = TRUE`,
      [deviceModelId, actorId],
    );

    if (branchIds.length > 0) {
      await client.query(
        `INSERT INTO device_model_sales_branches
           (device_model_id, branch_id, is_active, display_order, created_by, updated_by)
         SELECT $1, value, TRUE, ordinality - 1, $3, $3
         FROM unnest($2::int[]) WITH ORDINALITY AS selected(value, ordinality)
         ON CONFLICT (device_model_id, branch_id) DO UPDATE
           SET is_active = TRUE,
               display_order = EXCLUDED.display_order,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
        [deviceModelId, branchIds, actorId],
      );
    }

    const result = await getDeviceModelSalesBranches(deviceModelId, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
