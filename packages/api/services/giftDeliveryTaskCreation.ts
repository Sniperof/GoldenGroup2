import type { PoolClient } from 'pg';

export class GiftDeliveryTaskCreationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GiftDeliveryTaskCreationError';
  }
}

export const INSERT_GIFT_DELIVERY_LINK_EVENTS_SQL = `
  INSERT INTO gift_record_events (
    gift_record_id, event_type, actor_user_id, previous_status, new_status, metadata
  )
  SELECT unnest($1::int[]),
         'delivery_task_linked',
         $3,
         'approved_for_delivery',
         'delivery_task_created',
         jsonb_build_object('openTaskId', $2::integer)
`;

export async function insertGiftDeliveryLinkedEvents(
  db: Pick<PoolClient, 'query'>,
  giftRecordIds: number[],
  openTaskId: number,
  actorUserId: number | null,
) {
  await db.query(
    INSERT_GIFT_DELIVERY_LINK_EVENTS_SQL,
    [giftRecordIds, openTaskId, actorUserId],
  );
}

export function mapGiftDeliveryCreationDatabaseError(
  error: unknown,
): GiftDeliveryTaskCreationError | null {
  const databaseError = error as { code?: string; constraint?: string } | null;
  if (databaseError?.code !== '23505') return null;

  if (databaseError.constraint === 'uq_gift_delivery_task_records_active_record') {
    return new GiftDeliveryTaskCreationError(
      'أحد سجلات الهدايا مرتبط حالياً بمهمة تسليم أخرى',
      409,
      'GIFT_DELIVERY_TASK_ALREADY_ACTIVE',
    );
  }

  if (databaseError.constraint === 'idx_open_tasks_unique_active_per_client') {
    return new GiftDeliveryTaskCreationError(
      'تعذر إنشاء المهمة بسبب وجود مهمة تسليم هدية متعارضة للزبون',
      409,
      'GIFT_DELIVERY_CLIENT_TASK_CONFLICT',
    );
  }

  return null;
}
