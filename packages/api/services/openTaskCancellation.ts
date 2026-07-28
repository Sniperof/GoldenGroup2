import type { PoolClient } from 'pg';
import {
  canCancelOpenTaskBeforeScheduling,
  getTaskCancellationReasonCategory,
} from '@golden-crm/shared';
import { cancelGoldenWarrantyCardLinks } from './goldenWarrantyCardDelivery.js';

export class OpenTaskCancellationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'OpenTaskCancellationError';
  }
}

export interface OpenTaskCancellationSubject {
  id: number;
  branchId: number | null;
  taskType: string;
  status: string;
  hasActiveVisit: boolean;
}

export interface OpenTaskCancellationReason {
  id: number;
  category: string;
  value: string;
  label: string;
}

export async function loadOpenTaskCancellationSubject(
  db: PoolClient,
  taskId: number,
): Promise<OpenTaskCancellationSubject | null> {
  const { rows } = await db.query(
    `SELECT ot.id,
            ot.branch_id AS "branchId",
            ot.task_type AS "taskType",
            ot.status,
            EXISTS (
              SELECT 1
                FROM visit_tasks vt
                JOIN field_visits fv ON fv.id = vt.field_visit_id
                LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
               WHERE vt.source_open_task_id = ot.id
                 AND fv.status IN ('scheduled', 'in_progress', 'ended')
                 AND vtr.final_decision IS NULL
            ) AS "hasActiveVisit"
       FROM open_tasks ot
      WHERE ot.id = $1
      FOR UPDATE OF ot`,
    [taskId],
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    branchId: rows[0].branchId == null ? null : Number(rows[0].branchId),
    taskType: String(rows[0].taskType),
    status: String(rows[0].status),
    hasActiveVisit: rows[0].hasActiveVisit === true,
  };
}

export async function resolveOpenTaskCancellationReason(
  db: PoolClient,
  taskType: string,
  reasonId: number,
): Promise<OpenTaskCancellationReason> {
  const category = getTaskCancellationReasonCategory(taskType);
  const { rows } = await db.query(
    `SELECT id, category, value, metadata
       FROM system_lists
      WHERE id = $1
        AND category = $2
        AND is_active = TRUE
      LIMIT 1`,
    [reasonId, category],
  );
  if (!rows[0]) {
    throw new OpenTaskCancellationError('سبب الإلغاء غير صالح لنوع هذه المهمة', 400);
  }
  const value = String(rows[0].value);
  const metadata = rows[0].metadata && typeof rows[0].metadata === 'object'
    ? rows[0].metadata
    : {};
  return {
    id: Number(rows[0].id),
    category,
    value,
    label: typeof metadata.label === 'string' && metadata.label.trim()
      ? metadata.label.trim()
      : value,
  };
}

export async function cancelLockedOpenTaskBeforeScheduling(
  db: PoolClient,
  subject: OpenTaskCancellationSubject,
  reasonId: number,
  performedByUserId: number,
  role: string | null,
): Promise<OpenTaskCancellationReason> {
  if (!canCancelOpenTaskBeforeScheduling(subject.status, subject.hasActiveVisit)) {
    throw new OpenTaskCancellationError(
      'لا يمكن إلغاء المهمة بعد دخولها في الجدولة؛ تُسجّل نتيجتها من داخل الزيارة',
      409,
    );
  }

  const reason = await resolveOpenTaskCancellationReason(db, subject.taskType, reasonId);
  if (subject.taskType === 'golden_warranty_card_delivery') {
    await cancelGoldenWarrantyCardLinks(db, subject.id);
  }
  await db.query(
    `UPDATE open_tasks
        SET status = 'cancelled',
            cancellation_reason_id = $2,
            cancellation_reason = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [subject.id, reason.id, reason.label],
  );
  if (subject.taskType === 'gift_delivery') {
    await db.query(
      `WITH linked_records AS (
         SELECT link.gift_record_id
           FROM gift_delivery_task_records link
          WHERE link.open_task_id = $1
            AND link.is_active = TRUE
          FOR UPDATE
       ),
       restored AS (
         UPDATE gift_records gr
            SET status = 'approved_for_delivery',
                delivery_task_id = NULL,
                cancellation_reason = NULL,
                updated_by = $3,
                updated_at = NOW()
           FROM linked_records
          WHERE gr.id = linked_records.gift_record_id
            AND gr.status = 'delivery_task_created'
         RETURNING gr.id
       ),
       detached AS (
         UPDATE gift_delivery_task_records link
            SET is_active = FALSE,
                detached_by = $3,
                detached_at = NOW(),
                detachment_reason = $2
          WHERE link.open_task_id = $1
            AND link.is_active = TRUE
         RETURNING link.gift_record_id
       )
       INSERT INTO gift_record_events (
         gift_record_id, event_type, actor_user_id, previous_status, new_status, reason,
         metadata
       )
       SELECT detached.gift_record_id,
              'delivery_task_cancelled',
              $3,
              'delivery_task_created',
              'approved_for_delivery',
              $2,
              jsonb_build_object('openTaskId', $1)
         FROM detached`,
      [subject.id, reason.label, performedByUserId],
    );
  }
  await db.query(
    `INSERT INTO task_activity_log (
       task_id, event_type, performed_by, role, old_value, new_value, reason
     ) VALUES ($1, 'status_change', $2, $3, $4, 'cancelled', $5)`,
    [subject.id, performedByUserId, role, subject.status, reason.label],
  );
  return reason;
}
