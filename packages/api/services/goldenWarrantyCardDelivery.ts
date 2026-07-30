import type { PoolClient } from 'pg';

export class GoldenWarrantyCardDeliveryError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'GoldenWarrantyCardDeliveryError';
  }
}

export interface LockedGoldenWarrantyCard {
  warrantyId: number;
  installedDeviceId: number;
  branchId: number;
  customerId: number;
}

function normalizeIds(values: unknown[]): number[] {
  return [...new Set(
    values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
}

export function parseGoldenWarrantyIds(value: unknown): number[] {
  return Array.isArray(value) ? normalizeIds(value) : [];
}

export async function lockEligibleGoldenWarrantyCards(
  db: PoolClient,
  warrantyIds: number[],
  clientId: number,
  branchId: number,
): Promise<LockedGoldenWarrantyCard[]> {
  const ids = normalizeIds(warrantyIds);
  if (ids.length === 0) {
    throw new GoldenWarrantyCardDeliveryError(
      'يجب اختيار كفالة ذهبية واحدة على الأقل',
      400,
      'GOLDEN_WARRANTY_REQUIRED',
    );
  }

  const { rows } = await db.query(
    `SELECT w.id AS "warrantyId",
            w.device_id AS "installedDeviceId",
            w.warranty_type AS "warrantyType",
            w.status,
            w.end_date AS "endDate",
            (w.end_date IS NULL OR w.end_date >= CURRENT_DATE) AS "isCurrent",
            w.card_delivery_task_id AS "cardDeliveryTaskId",
            d.customer_id AS "customerId",
            d.branch_id AS "branchId",
            current_link.task_id AS "currentTaskId",
            current_link.link_status AS "currentLinkStatus"
       FROM device_warranties w
       JOIN installed_devices d ON d.id = w.device_id
       LEFT JOIN open_task_golden_warranties current_link
         ON current_link.warranty_id = w.id
        AND current_link.link_status IN ('active', 'delivered')
      WHERE w.id = ANY($1::int[])
      FOR UPDATE OF w`,
    [ids],
  );

  if (rows.length !== ids.length) {
    throw new GoldenWarrantyCardDeliveryError(
      'إحدى الكفالات المحددة غير موجودة',
      400,
      'GOLDEN_WARRANTY_NOT_FOUND',
    );
  }

  for (const row of rows) {
    if (Number(row.customerId) !== clientId || Number(row.branchId) !== branchId) {
      throw new GoldenWarrantyCardDeliveryError(
        'إحدى الكفالات المحددة لا تتبع الزبون والفرع المحددين',
        403,
        'GOLDEN_WARRANTY_SCOPE_MISMATCH',
      );
    }
    if (
      row.warrantyType !== 'golden'
      || row.status !== 'active'
      || row.isCurrent !== true
    ) {
      throw new GoldenWarrantyCardDeliveryError(
        'يمكن إنشاء مهمة تسليم كرت لكفالة ذهبية فعالة فقط',
        409,
        'GOLDEN_WARRANTY_NOT_ELIGIBLE',
      );
    }
    if (row.cardDeliveryTaskId != null || row.currentLinkStatus === 'delivered') {
      throw new GoldenWarrantyCardDeliveryError(
        'تم تسليم كرت إحدى الكفالات المحددة مسبقاً',
        409,
        'GOLDEN_WARRANTY_CARD_ALREADY_DELIVERED',
      );
    }
    if (row.currentLinkStatus === 'active') {
      throw new GoldenWarrantyCardDeliveryError(
        'توجد مهمة تسليم كرت نشطة لإحدى الكفالات المحددة',
        409,
        'GOLDEN_WARRANTY_CARD_TASK_ACTIVE',
      );
    }
  }

  return rows.map((row) => ({
    warrantyId: Number(row.warrantyId),
    installedDeviceId: Number(row.installedDeviceId),
    branchId: Number(row.branchId),
    customerId: Number(row.customerId),
  }));
}

export async function linkGoldenWarrantyCardsToTask(
  db: PoolClient,
  taskId: number,
  cards: LockedGoldenWarrantyCard[],
): Promise<void> {
  for (const card of cards) {
    await db.query(
      `INSERT INTO open_task_golden_warranties (task_id, warranty_id, link_status)
       VALUES ($1, $2, 'active')`,
      [taskId, card.warrantyId],
    );
  }
}

export async function assertActiveGoldenWarrantyCardLinks(
  db: PoolClient,
  taskId: number,
): Promise<number> {
  const { rows } = await db.query(
    `SELECT warranty_id
       FROM open_task_golden_warranties
      WHERE task_id = $1
        AND link_status = 'active'
      FOR UPDATE`,
    [taskId],
  );
  if (rows.length === 0) {
    throw new GoldenWarrantyCardDeliveryError(
      'مهمة تسليم الكرت لا ترتبط بكفالة نشطة قابلة للتنفيذ',
      409,
      'GOLDEN_WARRANTY_CARD_LINK_MISSING',
    );
  }
  return rows.length;
}

export async function cancelGoldenWarrantyCardLinks(
  db: PoolClient,
  taskId: number,
): Promise<number> {
  const result = await db.query(
    `UPDATE open_task_golden_warranties
        SET link_status = 'cancelled',
            updated_at = NOW()
      WHERE task_id = $1
        AND link_status = 'active'`,
    [taskId],
  );
  return result.rowCount ?? 0;
}

export async function deliverGoldenWarrantyCardLinks(
  db: PoolClient,
  taskId: number,
): Promise<number> {
  const { rows: links } = await db.query(
    `SELECT link.warranty_id AS "warrantyId",
            link.link_status AS "linkStatus",
            w.card_delivery_task_id AS "cardDeliveryTaskId"
       FROM open_task_golden_warranties link
       JOIN device_warranties w ON w.id = link.warranty_id
      WHERE link.task_id = $1
      FOR UPDATE OF link, w`,
    [taskId],
  );
  if (links.length === 0) {
    throw new GoldenWarrantyCardDeliveryError(
      'مهمة تسليم الكرت لا ترتبط بأي كفالة محددة',
      409,
      'GOLDEN_WARRANTY_CARD_LINK_MISSING',
    );
  }
  if (links.some((link) => link.linkStatus === 'cancelled')) {
    throw new GoldenWarrantyCardDeliveryError(
      'لا يمكن تسجيل التسليم على محاولة ملغاة',
      409,
      'GOLDEN_WARRANTY_CARD_TASK_CANCELLED',
    );
  }

  const alreadyDelivered = links.every(
    (link) => link.linkStatus === 'delivered' && Number(link.cardDeliveryTaskId) === taskId,
  );
  if (alreadyDelivered) return links.length;

  if (links.some((link) => link.linkStatus !== 'active' || link.cardDeliveryTaskId != null)) {
    throw new GoldenWarrantyCardDeliveryError(
      'حالة تسليم كرت الكفالة غير متسقة',
      409,
      'GOLDEN_WARRANTY_CARD_STATE_CONFLICT',
    );
  }

  const warrantyIds = links.map((link) => Number(link.warrantyId));
  const updated = await db.query(
    `UPDATE device_warranties
        SET card_delivery_task_id = $1,
            updated_at = NOW()
      WHERE id = ANY($2::int[])
        AND card_delivery_task_id IS NULL`,
    [taskId, warrantyIds],
  );
  if ((updated.rowCount ?? 0) !== warrantyIds.length) {
    throw new GoldenWarrantyCardDeliveryError(
      'تعذر تثبيت التسليم على جميع الكفالات المحددة',
      409,
      'GOLDEN_WARRANTY_CARD_STATE_CONFLICT',
    );
  }

  await db.query(
    `UPDATE open_task_golden_warranties
        SET link_status = 'delivered',
            updated_at = NOW()
      WHERE task_id = $1
        AND link_status = 'active'`,
    [taskId],
  );
  return warrantyIds.length;
}
