import type { Pool, PoolClient } from 'pg';
import pool from '../../db.js';
import { appError } from '../../utils/appErrors.js';
import { getExecutableMobileRequestTypeLabels } from '../serviceRequests/mobileExecutableTypes.js';
import type { NotificationDestination } from './notificationCatalog.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export async function assertBroadcastDestinationResolvable(
  destination: NotificationDestination | null,
  destinationId: string | null,
  db: Queryable = pool,
): Promise<void> {
  if (destination === 'service_request_form') {
    const labels = await getExecutableMobileRequestTypeLabels(db as Pool | PoolClient);
    if (!destinationId || !labels.has(destinationId)) {
      throw appError(400, 'نوع الطلب غير متاح في التطبيق', {
        code: 'request_type_not_executable',
        available: [...labels.keys()],
      });
    }
  }

  if (destination === 'catalog_device') {
    const deviceModelId = Number(destinationId);
    if (!Number.isInteger(deviceModelId) || deviceModelId <= 0) {
      throw appError(400, 'معرّف جهاز الكتالوج غير صالح', {
        code: 'invalid_catalog_device_id',
      });
    }
    const { rows } = await db.query(
      `SELECT 1
         FROM public.device_models
        WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL
        LIMIT 1`,
      [deviceModelId],
    );
    if (!rows[0]) {
      throw appError(400, 'الجهاز المحدد غير متاح في كتالوج التطبيق', {
        code: 'catalog_device_unavailable',
      });
    }
  }
}

export async function listBroadcastCatalogDevices(db: Queryable = pool) {
  const { rows } = await db.query(
    `SELECT id, COALESCE(NULLIF(name_ar, ''), NULLIF(name_en, ''), name) AS "nameAr", category
       FROM public.device_models
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY COALESCE(NULLIF(name_ar, ''), NULLIF(name_en, ''), name), id`,
  );
  return rows;
}
