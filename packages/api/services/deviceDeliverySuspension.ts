import type { PoolClient } from 'pg';
import type { AuthContext } from '@golden-crm/shared';
import { canManageDeviceDeliverySuspension } from '../policies/deviceDeliverySuspensionPolicy.js';
import { insertAuditLog } from '../utils/auditLog.js';

const ACTIVE_DELIVERY_TASK_STATUSES = [
  'open', 'needs_follow_up', 'assigned', 'in_scheduling', 'scheduled',
  'waiting_execution', 'in_execution', 'ended',
] as const;

const DELIVERY_SUSPENSION_REASON = 'تعليق التسليم لغياب الزبون';
const DELIVERY_RESUMPTION_REASON = 'إعادة الجهاز إلى بانتظار التسليم';
const SYSTEM_REASON = 'delivery_suspended_customer_absent';

export class DeviceDeliverySuspensionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceDeliverySuspensionError';
  }
}

type Action = 'suspend' | 'resume';

type DeviceSubject = {
  id: number;
  branchId: number | null;
  contractId: number | null;
  deviceSource: string | null;
  status: string;
};

async function resolveReasonId(client: PoolClient, category: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT id
       FROM system_lists
      WHERE category = $1
        AND value = $2
        AND is_active = TRUE
      LIMIT 1`,
    [category, SYSTEM_REASON],
  );
  if (!rows[0]) {
    throw new DeviceDeliverySuspensionError(
      500,
      'delivery_suspension_reason_missing',
      'سبب تعليق التسليم غير مهيأ في النظام',
    );
  }
  return Number(rows[0].id);
}

async function loadAndAuthorizeDevice(
  client: PoolClient,
  deviceId: number,
  authContext: AuthContext,
): Promise<DeviceSubject> {
  const { rows } = await client.query(
    `SELECT id,
            branch_id AS "branchId",
            contract_id AS "contractId",
            device_source AS "deviceSource",
            status
       FROM installed_devices
      WHERE id = $1
      FOR UPDATE`,
    [deviceId],
  );
  if (!rows[0]) {
    throw new DeviceDeliverySuspensionError(404, 'device_not_found', 'الجهاز غير موجود');
  }
  const device: DeviceSubject = {
    id: Number(rows[0].id),
    branchId: rows[0].branchId == null ? null : Number(rows[0].branchId),
    contractId: rows[0].contractId == null ? null : Number(rows[0].contractId),
    deviceSource: rows[0].deviceSource == null ? null : String(rows[0].deviceSource),
    status: String(rows[0].status),
  };
  if (!canManageDeviceDeliverySuspension(authContext, device).allowed) {
    throw new DeviceDeliverySuspensionError(403, 'device_scope_forbidden', 'غير مسموح بإدارة تعليق هذا الجهاز');
  }
  if (device.contractId == null || device.deviceSource !== 'company_contract') {
    throw new DeviceDeliverySuspensionError(
      409,
      'delivery_suspension_requires_contract_device',
      'تعليق التسليم متاح فقط لجهاز مرتبط بعقد الشركة',
    );
  }
  return device;
}

async function cancelPendingDeliveryWork(
  client: PoolClient,
  deviceId: number,
  actor: { userId: number; role: string | null },
  notes: string,
): Promise<{ cancelledTaskIds: number[]; cancelledVisitIds: number[] }> {
  const { rows: taskRows } = await client.query(
    `SELECT id, status
       FROM open_tasks
      WHERE device_id = $1
        AND task_type = 'device_delivery'
        AND status = ANY($2::varchar[])
      ORDER BY id
      FOR UPDATE`,
    [deviceId, ACTIVE_DELIVERY_TASK_STATUSES],
  );
  if (taskRows.length === 0) return { cancelledTaskIds: [], cancelledVisitIds: [] };

  const taskIds = taskRows.map((row: any) => Number(row.id));
  if (taskRows.some((row: any) => ['in_execution', 'ended'].includes(String(row.status)))) {
    throw new DeviceDeliverySuspensionError(
      409,
      'delivery_visit_in_execution',
      'لا يمكن تعليق التسليم بعد دخول المهمة في التنفيذ؛ يجب حسم الزيارة أولاً',
    );
  }

  const { rows: rawVisitRows } = await client.query(
    `SELECT fv.id, fv.status
       FROM visit_tasks vt
       JOIN field_visits fv ON fv.id = vt.field_visit_id
      WHERE vt.source_open_task_id = ANY($1::int[])
        AND fv.status IN ('scheduled', 'in_progress', 'ended')
      ORDER BY fv.id
      FOR UPDATE OF fv`,
    [taskIds],
  );
  const visitRows = Array.from(
    new Map(rawVisitRows.map((row: any) => [Number(row.id), row])).values(),
  ) as any[];
  if (visitRows.some((row: any) => ['in_progress', 'ended'].includes(String(row.status)))) {
    throw new DeviceDeliverySuspensionError(
      409,
      'delivery_visit_in_execution',
      'لا يمكن تعليق التسليم بعد بدء الزيارة أو أثناء انتظار حسم نتيجتها',
    );
  }

  const scheduledVisitIds = visitRows
    .filter((row: any) => String(row.status) === 'scheduled')
    .map((row: any) => Number(row.id));
  const taskReasonId = await resolveReasonId(client, 'device_delivery_failure_reasons');
  const visitReasonId = scheduledVisitIds.length > 0
    ? await resolveReasonId(client, 'visit_cancellation_reasons')
    : null;

  if (scheduledVisitIds.length > 0) {
    await client.query(
      `UPDATE visit_tasks
          SET status = 'cancelled', updated_at = NOW()
        WHERE field_visit_id = ANY($1::int[])
          AND status = 'pending'`,
      [scheduledVisitIds],
    );
    await client.query(
      `UPDATE field_visits
          SET status = 'cancelled',
              cancellation_reason_id = $2,
              cancellation_notes = $3,
              updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND status = 'scheduled'`,
      [scheduledVisitIds, visitReasonId, notes],
    );
    await client.query(
      `UPDATE visit_scheduled_alerts
          SET resolved_at = NOW()
        WHERE visit_id = ANY($1::int[])
          AND resolved_at IS NULL`,
      [scheduledVisitIds],
    );
  }

  await client.query(
    `UPDATE open_tasks
        SET status = 'cancelled',
            cancellation_reason_id = $2,
            cancellation_reason = $3,
            updated_at = NOW()
      WHERE id = ANY($1::int[])`,
    [taskIds, taskReasonId, DELIVERY_SUSPENSION_REASON],
  );
  for (const task of taskRows) {
    await client.query(
      `INSERT INTO task_activity_log (
         task_id, event_type, performed_by, role, old_value, new_value, reason
       ) VALUES ($1, 'status_change', $2, $3, $4, 'cancelled', $5)`,
      [Number(task.id), actor.userId, actor.role, String(task.status), DELIVERY_SUSPENSION_REASON],
    );
  }
  return { cancelledTaskIds: taskIds, cancelledVisitIds: scheduledVisitIds };
}

export async function changeDeviceDeliverySuspension(
  client: PoolClient,
  input: {
    deviceId: number;
    action: Action;
    notes: string;
    authContext: AuthContext;
    actorRole: string | null;
  },
) {
  const notes = input.notes.trim();
  if (!notes) {
    throw new DeviceDeliverySuspensionError(400, 'notes_required', 'الملاحظات الإدارية مطلوبة');
  }
  const device = await loadAndAuthorizeDevice(client, input.deviceId, input.authContext);
  const expected = input.action === 'suspend' ? 'pending_delivery' : 'delivery_suspended';
  const target = input.action === 'suspend' ? 'delivery_suspended' : 'pending_delivery';
  if (device.status !== expected) {
    throw new DeviceDeliverySuspensionError(
      409,
      'invalid_device_status_transition',
      `لا يمكن تنفيذ الانتقال من حالة الجهاز الحالية: ${device.status}`,
    );
  }

  const cancelled = input.action === 'suspend'
    ? await cancelPendingDeliveryWork(
        client,
        device.id,
        { userId: input.authContext.userId, role: input.actorRole },
        notes,
      )
    : { cancelledTaskIds: [], cancelledVisitIds: [] };

  await client.query(
    `UPDATE installed_devices
        SET status = $2, updated_at = NOW()
      WHERE id = $1`,
    [device.id, target],
  );
  await insertAuditLog(client, {
    entityType: 'InstalledDevice',
    entityId: device.id,
    actionType: input.action === 'suspend' ? 'delivery_suspended' : 'delivery_resumed',
    performedByRole: input.actorRole ?? undefined,
    performedByUserId: input.authContext.userId,
    oldValue: device.status,
    newValue: target,
    internalReason: JSON.stringify({
      reason: input.action === 'suspend' ? DELIVERY_SUSPENSION_REASON : DELIVERY_RESUMPTION_REASON,
      notes,
      cancelledTaskIds: cancelled.cancelledTaskIds,
      cancelledVisitIds: cancelled.cancelledVisitIds,
    }),
  });

  return { id: device.id, status: target, ...cancelled };
}
