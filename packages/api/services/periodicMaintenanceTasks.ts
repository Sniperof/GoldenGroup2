import { persistOpenTaskSnapshots } from '../routes/openTasks.js';
import { getPeriodicMaintenanceSettings } from './systemSettings.js';

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export interface PeriodicMaintenanceGenerationResult {
  createdTaskId: number | null;
  skippedReason: string | null;
  dueDate: string | null;
  intervalDays: number | null;
}

export interface ManualPeriodicMaintenanceInput {
  installedDeviceId: number;
  dueDate: string;
  manualReason: string;
  intervalMonths?: number | null;
  notes?: string | null;
  createdByUserId?: number | null;
}

export interface PeriodicAttachmentCandidate {
  taskId: number;
  installedDeviceId: number;
  clientId: number;
  branchId: number;
  contractId: number | null;
  status: string;
  dueDate: string;
  daysUntilDue: number;
  attachWindowDays: number;
  priority: string | null;
  reason: string | null;
  notes: string | null;
}

export interface PeriodicSupersessionResult {
  supersededTaskId: number;
  nextPeriodicTask: PeriodicMaintenanceGenerationResult;
}

function parseMaintenancePlanDays(plan: string | null | undefined, defaultMonths: number): number {
  const value = String(plan ?? '').trim().toLowerCase();
  if (!value) return defaultMonths * 30;

  const numericMonths = Number(value);
  if (Number.isFinite(numericMonths) && numericMonths > 0) {
    return Math.floor(numericMonths * 30);
  }

  const planMonths: Record<string, number> = {
    monthly: 1,
    month: 1,
    quarterly: 3,
    quarter: 3,
    semi_annual: 6,
    semiannual: 6,
    half_year: 6,
    annual: 12,
    yearly: 12,
    year: 12,
  };

  return (planMonths[value] ?? defaultMonths) * 30;
}

function resolveIntervalDays(input: {
  warrantyMonths: number | null;
  warrantyVisits: number | null;
  maintenancePlan: string | null;
  defaultIntervalMonths: number;
}): number {
  if (
    Number.isFinite(input.warrantyMonths) &&
    Number.isFinite(input.warrantyVisits) &&
    Number(input.warrantyMonths) > 0 &&
    Number(input.warrantyVisits) > 0
  ) {
    return Math.max(1, Math.floor((Number(input.warrantyMonths) * 30) / Number(input.warrantyVisits)));
  }

  return Math.max(1, parseMaintenancePlanDays(input.maintenancePlan, input.defaultIntervalMonths));
}

export async function generateFirstPeriodicMaintenanceTask(
  db: Queryable,
  installedDeviceId: number,
  createdByUserId: number | null = null,
): Promise<PeriodicMaintenanceGenerationResult> {
  const settings = await getPeriodicMaintenanceSettings();
  if (!settings.autoGenerateEnabled) {
    return { createdTaskId: null, skippedReason: 'auto_generation_disabled', dueDate: null, intervalDays: null };
  }

  const { rows } = await db.query(
    `SELECT d.id,
            d.customer_id AS "clientId",
            d.branch_id AS "branchId",
            d.contract_id AS "contractId",
            d.status,
            d.activated_at AS "activatedAt",
            d.warranty_months AS "warrantyMonths",
            d.warranty_visits AS "warrantyVisits",
            c.maintenance_plan AS "maintenancePlan"
       FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
      WHERE d.id = $1
      LIMIT 1`,
    [installedDeviceId],
  );
  const device = rows[0];
  if (!device) {
    return { createdTaskId: null, skippedReason: 'device_not_found', dueDate: null, intervalDays: null };
  }
  if (device.status !== 'active') {
    return { createdTaskId: null, skippedReason: 'device_not_active', dueDate: null, intervalDays: null };
  }
  if (!device.clientId || !device.branchId || !device.contractId) {
    return { createdTaskId: null, skippedReason: 'missing_required_links', dueDate: null, intervalDays: null };
  }

  const intervalDays = resolveIntervalDays({
    warrantyMonths: device.warrantyMonths == null ? null : Number(device.warrantyMonths),
    warrantyVisits: device.warrantyVisits == null ? null : Number(device.warrantyVisits),
    maintenancePlan: device.maintenancePlan ?? null,
    defaultIntervalMonths: settings.defaultIntervalMonths,
  });

  const { rows: dueRows } = await db.query(
    `SELECT (COALESCE($1::timestamptz, NOW())::date + $2::int) AS "dueDate"`,
    [device.activatedAt ?? null, intervalDays],
  );
  const dueDate = dueRows[0]?.dueDate;

  const { rows: existingRows } = await db.query(
    `SELECT id
       FROM open_tasks
      WHERE task_type = 'periodic_maintenance'
        AND device_id = $1
        AND status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 1`,
    [installedDeviceId],
  );
  if (existingRows.length > 0) {
    return { createdTaskId: null, skippedReason: 'active_periodic_exists', dueDate, intervalDays };
  }

  const { rows: taskRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, contract_id, device_id,
       task_type, task_family, reason,
       status, due_date, priority,
       source, creation_origin, origin,
       notes, created_by
     ) VALUES (
       $1, $2, $3, $4,
       'periodic_maintenance', 'maintenance', 'other',
       'open', $5::date, 'medium',
       'system', 'system_trigger', 'system',
       $6, $7
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      Number(device.clientId),
      Number(device.branchId),
      Number(device.contractId),
      installedDeviceId,
      dueDate,
      `أول صيانة دورية مولدة تلقائياً بعد تفعيل الجهاز. الفاصل: ${intervalDays} يوم.`,
      createdByUserId,
    ],
  );

  const createdTaskId = taskRows[0]?.id ? Number(taskRows[0].id) : null;
  if (!createdTaskId) {
    return { createdTaskId: null, skippedReason: 'insert_skipped', dueDate, intervalDays };
  }

  await db.query(
    `INSERT INTO open_task_periodic_payload
       (open_task_id, generation_origin, interval_days_snapshot, created_by)
     VALUES ($1, 'system', $2, $3)
     ON CONFLICT (open_task_id) DO UPDATE
       SET interval_days_snapshot = EXCLUDED.interval_days_snapshot,
           updated_at = NOW()`,
    [createdTaskId, intervalDays, createdByUserId],
  );

  await persistOpenTaskSnapshots(
    db,
    createdTaskId,
    Number(device.clientId),
    Number(device.contractId),
    installedDeviceId,
  );

  return { createdTaskId, skippedReason: null, dueDate, intervalDays };
}

export async function generateNextPeriodicMaintenanceTask(
  db: Queryable,
  completedPeriodicTaskId: number,
  createdByUserId: number | null = null,
): Promise<PeriodicMaintenanceGenerationResult> {
  const settings = await getPeriodicMaintenanceSettings();
  if (!settings.autoGenerateEnabled) {
    return { createdTaskId: null, skippedReason: 'auto_generation_disabled', dueDate: null, intervalDays: null };
  }

  const { rows } = await db.query(
    `SELECT ot.id,
            ot.client_id AS "clientId",
            ot.branch_id AS "branchId",
            ot.contract_id AS "contractId",
            ot.device_id AS "installedDeviceId",
            ot.task_type AS "taskType",
            ot.due_date AS "currentDueDate",
            otp.interval_days_snapshot AS "intervalDaysSnapshot",
            d.status AS "deviceStatus",
            d.warranty_months AS "warrantyMonths",
            d.warranty_visits AS "warrantyVisits",
            c.maintenance_plan AS "maintenancePlan"
       FROM open_tasks ot
       LEFT JOIN open_task_periodic_payload otp ON otp.open_task_id = ot.id
       LEFT JOIN installed_devices d ON d.id = ot.device_id
       LEFT JOIN contracts c ON c.id = ot.contract_id
      WHERE ot.id = $1
      LIMIT 1`,
    [completedPeriodicTaskId],
  );
  const task = rows[0];
  if (!task) {
    return { createdTaskId: null, skippedReason: 'task_not_found', dueDate: null, intervalDays: null };
  }
  if (task.taskType !== 'periodic_maintenance') {
    return { createdTaskId: null, skippedReason: 'not_periodic_task', dueDate: null, intervalDays: null };
  }
  if (!task.installedDeviceId) {
    return { createdTaskId: null, skippedReason: 'missing_device', dueDate: null, intervalDays: null };
  }
  if (task.deviceStatus !== 'active') {
    return { createdTaskId: null, skippedReason: 'device_not_active', dueDate: null, intervalDays: null };
  }
  if (!task.clientId || !task.branchId || !task.contractId) {
    return { createdTaskId: null, skippedReason: 'missing_required_links', dueDate: null, intervalDays: null };
  }

  const intervalSnapshot = task.intervalDaysSnapshot == null ? null : Number(task.intervalDaysSnapshot);
  const intervalDays = Number.isFinite(intervalSnapshot) && intervalSnapshot! > 0
    ? Math.floor(intervalSnapshot!)
    : resolveIntervalDays({
        warrantyMonths: task.warrantyMonths == null ? null : Number(task.warrantyMonths),
        warrantyVisits: task.warrantyVisits == null ? null : Number(task.warrantyVisits),
        maintenancePlan: task.maintenancePlan ?? null,
        defaultIntervalMonths: settings.defaultIntervalMonths,
      });

  const { rows: dueRows } = await db.query(
    `SELECT (GREATEST(COALESCE($1::date, CURRENT_DATE), CURRENT_DATE) + $2::int) AS "dueDate"`,
    [task.currentDueDate ?? null, intervalDays],
  );
  const dueDate = dueRows[0]?.dueDate;

  const { rows: existingRows } = await db.query(
    `SELECT id
       FROM open_tasks
      WHERE task_type = 'periodic_maintenance'
        AND device_id = $1
        AND id <> $2
        AND status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 1`,
    [Number(task.installedDeviceId), completedPeriodicTaskId],
  );
  if (existingRows.length > 0) {
    return { createdTaskId: null, skippedReason: 'active_periodic_exists', dueDate, intervalDays };
  }

  const { rows: taskRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, contract_id, device_id,
       task_type, task_family, reason,
       status, due_date, priority,
       source, creation_origin, origin,
       notes, created_by
     ) VALUES (
       $1, $2, $3, $4,
       'periodic_maintenance', 'maintenance', 'other',
       'open', $5::date, 'medium',
       'system', 'system_trigger', 'system',
       $6, $7
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      Number(task.clientId),
      Number(task.branchId),
      Number(task.contractId),
      Number(task.installedDeviceId),
      dueDate,
      `صيانة دورية تالية مولدة تلقائياً بعد تنفيذ المهمة #${completedPeriodicTaskId}. الفاصل: ${intervalDays} يوم.`,
      createdByUserId,
    ],
  );

  const createdTaskId = taskRows[0]?.id ? Number(taskRows[0].id) : null;
  if (!createdTaskId) {
    return { createdTaskId: null, skippedReason: 'insert_skipped', dueDate, intervalDays };
  }

  await db.query(
    `INSERT INTO open_task_periodic_payload
       (open_task_id, generation_origin, interval_days_snapshot, created_by)
     VALUES ($1, 'system', $2, $3)
     ON CONFLICT (open_task_id) DO UPDATE
       SET interval_days_snapshot = EXCLUDED.interval_days_snapshot,
           updated_at = NOW()`,
    [createdTaskId, intervalDays, createdByUserId],
  );

  await persistOpenTaskSnapshots(
    db,
    createdTaskId,
    Number(task.clientId),
    Number(task.contractId),
    Number(task.installedDeviceId),
  );

  return { createdTaskId, skippedReason: null, dueDate, intervalDays };
}

export async function createManualPeriodicMaintenanceTask(
  db: Queryable,
  input: ManualPeriodicMaintenanceInput,
): Promise<{ createdTaskId: number; dueDate: string; intervalDays: number }> {
  const settings = await getPeriodicMaintenanceSettings();
  if (!settings.manualCreationEnabled) {
    throw new Error('الإنشاء اليدوي للصيانة الدورية غير مفعّل حالياً.');
  }

  const { rows } = await db.query(
    `SELECT d.id,
            d.customer_id AS "clientId",
            d.branch_id AS "branchId",
            d.contract_id AS "contractId",
            d.status,
            d.warranty_months AS "warrantyMonths",
            d.warranty_visits AS "warrantyVisits",
            c.maintenance_plan AS "maintenancePlan"
       FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
      WHERE d.id = $1
      LIMIT 1`,
    [input.installedDeviceId],
  );
  const device = rows[0];
  if (!device) throw new Error('الجهاز غير موجود.');
  if (device.status !== 'active') throw new Error('لا يمكن إنشاء دورية يدوية إلا لجهاز active.');
  if (!device.clientId || !device.branchId || !device.contractId) {
    throw new Error('الجهاز لا يملك روابط زبون/فرع/عقد كافية لإنشاء دورية.');
  }

  const dueDate = String(input.dueDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('تاريخ الاستحقاق مطلوب بصيغة صحيحة.');
  }
  const manualReason = String(input.manualReason ?? '').trim();
  if (!manualReason) throw new Error('سبب الإنشاء اليدوي مطلوب.');

  const overrideMonths = input.intervalMonths == null ? null : Number(input.intervalMonths);
  if (overrideMonths != null && (!Number.isFinite(overrideMonths) || overrideMonths <= 0)) {
    throw new Error('فترة الصيانة اليدوية يجب أن تكون أكبر من صفر.');
  }

  const intervalDays = overrideMonths != null
    ? Math.max(1, Math.floor(overrideMonths * 30))
    : resolveIntervalDays({
        warrantyMonths: device.warrantyMonths == null ? null : Number(device.warrantyMonths),
        warrantyVisits: device.warrantyVisits == null ? null : Number(device.warrantyVisits),
        maintenancePlan: device.maintenancePlan ?? null,
        defaultIntervalMonths: settings.defaultIntervalMonths,
      });

  const { rows: existingRows } = await db.query(
    `SELECT id
       FROM open_tasks
      WHERE task_type = 'periodic_maintenance'
        AND device_id = $1
        AND status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.installedDeviceId],
  );
  if (existingRows.length > 0) {
    throw new Error(`توجد دورية نشطة بالفعل لهذا الجهاز #${existingRows[0].id}.`);
  }

  const notes = [
    input.notes?.trim() || null,
    `إنشاء يدوي للصيانة الدورية. السبب: ${manualReason}. الفاصل: ${intervalDays} يوم.`,
  ].filter(Boolean).join('\n');

  const { rows: taskRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, contract_id, device_id,
       task_type, task_family, reason,
       status, due_date, priority,
       source, creation_origin, origin,
       creation_reason, notes, created_by
     ) VALUES (
       $1, $2, $3, $4,
       'periodic_maintenance', 'maintenance', 'other',
       'open', $5::date, 'medium',
       'manual', 'manual_creation', 'manual_entry',
       $6, $7, $8
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      Number(device.clientId),
      Number(device.branchId),
      Number(device.contractId),
      input.installedDeviceId,
      dueDate,
      manualReason,
      notes,
      input.createdByUserId ?? null,
    ],
  );
  const createdTaskId = taskRows[0]?.id ? Number(taskRows[0].id) : null;
  if (!createdTaskId) throw new Error('تعذر إنشاء الدورية بسبب وجود مهمة نشطة متزامنة.');

  await db.query(
    `INSERT INTO open_task_periodic_payload
       (open_task_id, generation_origin, interval_days_snapshot, manual_reason, created_by)
     VALUES ($1, 'manual', $2, $3, $4)`,
    [createdTaskId, intervalDays, manualReason, input.createdByUserId ?? null],
  );

  await persistOpenTaskSnapshots(
    db,
    createdTaskId,
    Number(device.clientId),
    Number(device.contractId),
    input.installedDeviceId,
  );

  return { createdTaskId, dueDate, intervalDays };
}

export async function findPeriodicAttachmentCandidate(
  db: Queryable,
  installedDeviceId: number | null | undefined,
): Promise<PeriodicAttachmentCandidate | null> {
  const deviceId = Number(installedDeviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return null;

  const settings = await getPeriodicMaintenanceSettings();
  if (settings.attachWarningDays <= 0 || settings.attachAllowedStatuses.length === 0) {
    return null;
  }

  const { rows } = await db.query(
    `SELECT ot.id AS "taskId",
            ot.device_id AS "installedDeviceId",
            ot.client_id AS "clientId",
            ot.branch_id AS "branchId",
            ot.contract_id AS "contractId",
            ot.status,
            ot.due_date::text AS "dueDate",
            (ot.due_date::date - CURRENT_DATE)::int AS "daysUntilDue",
            ot.priority,
            ot.reason,
            ot.notes
       FROM open_tasks ot
      WHERE ot.task_type = 'periodic_maintenance'
        AND ot.device_id = $1
        AND ot.due_date IS NOT NULL
        AND ot.due_date <= (CURRENT_DATE + $2::int)
        AND ot.status = ANY($3::text[])
      ORDER BY ABS((ot.due_date::date - CURRENT_DATE)::int) ASC,
               ot.due_date ASC,
               ot.id ASC
      LIMIT 1`,
    [deviceId, settings.attachWarningDays, settings.attachAllowedStatuses],
  );

  const candidate = rows[0];
  if (!candidate) return null;

  return {
    taskId: Number(candidate.taskId),
    installedDeviceId: Number(candidate.installedDeviceId),
    clientId: Number(candidate.clientId),
    branchId: Number(candidate.branchId),
    contractId: candidate.contractId == null ? null : Number(candidate.contractId),
    status: String(candidate.status),
    dueDate: String(candidate.dueDate),
    daysUntilDue: Number(candidate.daysUntilDue),
    attachWindowDays: settings.attachWarningDays,
    priority: candidate.priority ?? null,
    reason: candidate.reason ?? null,
    notes: candidate.notes ?? null,
  };
}

export async function supersedePeriodicWithinEmergency(
  db: Queryable,
  input: {
    emergencyTaskId: number;
    periodicTaskId: number;
    installedDeviceId: number | null | undefined;
    actorUserId?: number | null;
  },
): Promise<PeriodicSupersessionResult> {
  const candidate = await findPeriodicAttachmentCandidate(db, input.installedDeviceId);
  if (!candidate || candidate.taskId !== input.periodicTaskId) {
    throw new Error('periodic_attachment_candidate_not_available');
  }
  if (candidate.taskId === input.emergencyTaskId) {
    throw new Error('periodic_supersession_self_reference');
  }

  const { rows: taskRows } = await db.query(
    `SELECT id, status, task_type, device_id
       FROM open_tasks
      WHERE id = $1
      LIMIT 1`,
    [input.periodicTaskId],
  );
  const task = taskRows[0];
  if (!task) throw new Error('periodic_task_not_found');
  if (task.task_type !== 'periodic_maintenance') throw new Error('task_not_periodic_maintenance');
  if (Number(task.device_id) !== Number(input.installedDeviceId)) throw new Error('periodic_device_mismatch');

  const { rows: closedRows } = await db.query(
    `UPDATE open_tasks
        SET status = 'closed',
            notes = CONCAT_WS(E'\n',
              NULLIF(notes, ''),
              $3
            ),
            updated_at = NOW()
      WHERE id = $1
        AND task_type = 'periodic_maintenance'
        AND status = $2
      RETURNING id`,
    [
      input.periodicTaskId,
      candidate.status,
      `تم الاكتفاء بهذه الدورية ضمن مهمة طارئة #${input.emergencyTaskId}.`,
    ],
  );
  if (closedRows.length === 0) {
    throw new Error('periodic_task_status_changed');
  }

  await db.query(
    `INSERT INTO open_task_periodic_payload
       (open_task_id, generation_origin, superseded_by_open_task_id,
        superseded_reason, superseded_at, superseded_by_user_id)
     VALUES ($1, 'system', $2, 'superseded_within_emergency', NOW(), $3)
     ON CONFLICT (open_task_id) DO UPDATE
       SET superseded_by_open_task_id = EXCLUDED.superseded_by_open_task_id,
           superseded_reason = EXCLUDED.superseded_reason,
           superseded_at = EXCLUDED.superseded_at,
           superseded_by_user_id = EXCLUDED.superseded_by_user_id,
           updated_at = NOW()`,
    [input.periodicTaskId, input.emergencyTaskId, input.actorUserId ?? null],
  );

  await db.query(
    `INSERT INTO task_activity_log
       (task_id, event_type, performed_by, role, new_value, reason)
     VALUES ($1, 'status_change', $2, 'system', 'closed', $3)`,
    [
      input.periodicTaskId,
      input.actorUserId ?? null,
      `superseded_within_emergency:${input.emergencyTaskId}`,
    ],
  );

  const nextPeriodicTask = await generateNextPeriodicMaintenanceTask(
    db,
    input.periodicTaskId,
    input.actorUserId ?? null,
  );

  return { supersededTaskId: input.periodicTaskId, nextPeriodicTask };
}
