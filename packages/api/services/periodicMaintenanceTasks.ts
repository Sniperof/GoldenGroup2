import { persistOpenTaskSnapshots } from '../routes/openTasks.js';
import {
  getPeriodicMaintenanceSettings,
  type PeriodicMaintenanceSettings,
} from './systemSettings.js';

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export interface PeriodicMaintenanceGenerationResult {
  createdTaskId: number | null;
  skippedReason: string | null;
  dueDate: string | null;
  intervalDays: number | null;
}

export interface FirstPeriodicMaintenanceGenerationOptions {
  settings?: PeriodicMaintenanceSettings;
  dryRun?: boolean;
  activationDateOverride?: string | Date | null;
}

export interface ManualPeriodicMaintenanceInput {
  installedDeviceId: number;
  dueDate: string;
  manualReason: string;
  intervalMonths?: number | null;
  notes?: string | null;
  createdByUserId?: number | null;
}

export interface ServiceRequestPeriodicMaintenanceInput {
  serviceRequestId: number;
  installedDeviceId: number;
  requestReasonId: number;
  requestReasonSnapshot: Record<string, unknown>;
  createdByUserId: number;
  /** Injectable for deterministic verification; runtime normally reads system settings. */
  settings?: PeriodicMaintenanceSettings;
}

export type ServiceRequestPeriodicMaintenanceResult =
  | { outcome: 'created'; taskId: number; dueDate: string; intervalDays: number; branchId: number }
  | { outcome: 'active_task_exists'; taskId: number }
  | { outcome: 'ineligible'; reason: string }
  | { outcome: 'missing_schedule_anchor'; reason: string };

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

export class PeriodicMaintenanceTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodicMaintenanceTransferError';
  }
}

const UPCOMING_PERIODIC_STATUSES = [
  'open',
  'needs_follow_up',
  'assigned',
  'in_scheduling',
  'scheduled',
  'waiting_execution',
] as const;

export async function cancelUpcomingPeriodicMaintenanceForTransfer(
  db: Queryable,
  input: {
    installedDeviceId: number;
    fromClientId: number;
    toClientId: number;
    performedByUserId: number;
  },
): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT ot.id,
            ot.status,
            EXISTS (
              SELECT 1
                FROM visit_tasks vt
                JOIN field_visits fv ON fv.id = vt.field_visit_id
                LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
               WHERE vt.source_open_task_id = ot.id
                 AND vt.status = 'in_progress'
                 AND fv.status IN ('in_progress', 'ended')
                 AND vtr.final_decision IS NULL
            ) AS "hasExecutionAttempt"
       FROM open_tasks ot
      WHERE ot.task_type = 'periodic_maintenance'
        AND ot.device_id = $1
        AND ot.client_id = $2
        AND ot.status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY ot.id
      FOR UPDATE OF ot`,
    [input.installedDeviceId, input.fromClientId],
  );

  const executingTask = rows.find(row =>
    row.hasExecutionAttempt === true
    || row.status === 'in_execution'
    || row.status === 'ended'
  );
  if (executingTask) {
    throw new PeriodicMaintenanceTransferError(
      `لا يمكن نقل حيازة الجهاز قبل إنهاء مهمة الصيانة الدورية قيد التنفيذ #${executingTask.id}`,
    );
  }

  const cancellableRows = rows.filter(row =>
    UPCOMING_PERIODIC_STATUSES.includes(row.status as typeof UPCOMING_PERIODIC_STATUSES[number])
  );
  if (cancellableRows.length === 0) return [];

  const taskIds = cancellableRows.map(row => Number(row.id));
  const previousStatuses = cancellableRows.map(row => String(row.status));
  const cancellationReason = 'نقل حيازة الجهاز إلى زبون آخر';
  const auditReason = `device_possession_transferred_to_client:${input.toClientId}`;

  const { rows: cancelledRows } = await db.query(
    `UPDATE open_tasks
        SET status = 'cancelled',
            cancellation_reason = $2,
            updated_at = NOW()
      WHERE id = ANY($1::int[])
        AND status = ANY($3::text[])
      RETURNING id`,
    [taskIds, cancellationReason, [...UPCOMING_PERIODIC_STATUSES]],
  );
  if (cancelledRows.length !== taskIds.length) {
    throw new PeriodicMaintenanceTransferError(
      'تغيرت حالة مهمة صيانة دورية أثناء نقل الحيازة؛ أعد المحاولة',
    );
  }

  await db.query(
    `UPDATE visit_tasks
        SET status = 'cancelled',
            updated_at = NOW()
      WHERE source_open_task_id = ANY($1::int[])
        AND status NOT IN ('completed', 'cancelled')`,
    [taskIds],
  );

  await db.query(
    `INSERT INTO task_activity_log (
       task_id, event_type, performed_by, role, old_value, new_value, reason
     )
     SELECT transition.task_id,
            'status_change',
            $3,
            'system',
            transition.old_status,
            'cancelled',
            $4
       FROM unnest($1::int[], $2::text[]) AS transition(task_id, old_status)`,
    [taskIds, previousStatuses, input.performedByUserId, auditReason],
  );

  return taskIds;
}

/**
 * إلغاء مهام الصيانة الدورية المفتوحة لجهاز عند إلغاء عقده. نظير
 * cancelUpcomingPeriodicMaintenanceForTransfer: يمنع الإلغاء إن كانت مهمة
 * دورية قيد التنفيذ فعلاً (يرمي PeriodicMaintenanceTransferError → 409)، وإلا
 * يُلغي المهام المفتوحة + زياراتها ويسجّل في task_activity_log.
 */
export async function cancelUpcomingPeriodicMaintenanceForContractCancel(
  db: Queryable,
  input: {
    installedDeviceId: number;
    performedByUserId: number | null;
  },
): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT ot.id,
            ot.status,
            EXISTS (
              SELECT 1
                FROM visit_tasks vt
                JOIN field_visits fv ON fv.id = vt.field_visit_id
                LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
               WHERE vt.source_open_task_id = ot.id
                 AND vt.status = 'in_progress'
                 AND fv.status IN ('in_progress', 'ended')
                 AND vtr.final_decision IS NULL
            ) AS "hasExecutionAttempt"
       FROM open_tasks ot
      WHERE ot.task_type = 'periodic_maintenance'
        AND ot.device_id = $1
        AND ot.status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY ot.id
      FOR UPDATE OF ot`,
    [input.installedDeviceId],
  );

  const executingTask = rows.find(row =>
    row.hasExecutionAttempt === true
    || row.status === 'in_execution'
    || row.status === 'ended'
  );
  if (executingTask) {
    throw new PeriodicMaintenanceTransferError(
      `لا يمكن إلغاء العقد قبل إنهاء مهمة الصيانة الدورية قيد التنفيذ #${executingTask.id}`,
    );
  }

  const cancellableRows = rows.filter(row =>
    UPCOMING_PERIODIC_STATUSES.includes(row.status as typeof UPCOMING_PERIODIC_STATUSES[number])
  );
  if (cancellableRows.length === 0) return [];

  const taskIds = cancellableRows.map(row => Number(row.id));
  const previousStatuses = cancellableRows.map(row => String(row.status));

  const { rows: cancelledRows } = await db.query(
    `UPDATE open_tasks
        SET status = 'cancelled',
            cancellation_reason = 'إلغاء العقد',
            updated_at = NOW()
      WHERE id = ANY($1::int[])
        AND status = ANY($2::text[])
      RETURNING id`,
    [taskIds, [...UPCOMING_PERIODIC_STATUSES]],
  );
  if (cancelledRows.length !== taskIds.length) {
    throw new PeriodicMaintenanceTransferError(
      'تغيرت حالة مهمة صيانة دورية أثناء إلغاء العقد؛ أعد المحاولة',
    );
  }

  await db.query(
    `UPDATE visit_tasks
        SET status = 'cancelled',
            updated_at = NOW()
      WHERE source_open_task_id = ANY($1::int[])
        AND status NOT IN ('completed', 'cancelled')`,
    [taskIds],
  );

  await db.query(
    `INSERT INTO task_activity_log (
       task_id, event_type, performed_by, role, old_value, new_value, reason
     )
     SELECT transition.task_id,
            'status_change',
            $3,
            'system',
            transition.old_status,
            'cancelled',
            'contract_cancelled'
       FROM unnest($1::int[], $2::text[]) AS transition(task_id, old_status)`,
    [taskIds, previousStatuses, input.performedByUserId],
  );

  return taskIds;
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

function daysBetweenDates(start: string | Date | null | undefined, end: string | Date | null | undefined): number | null {
  if (!start || !end) return null;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;
  return Math.max(1, Math.ceil((endTime - startTime) / 86_400_000));
}

function resolveServiceAgreementIntervalDays(input: {
  maintenancePlan: string | null;
  visitsCount: number | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
  defaultIntervalMonths: number;
}): number {
  const plan = String(input.maintenancePlan ?? '').trim();
  if (plan) return Math.max(1, parseMaintenancePlanDays(plan, input.defaultIntervalMonths));

  const visitsCount = Number(input.visitsCount);
  const durationDays = daysBetweenDates(input.startDate, input.endDate);
  if (Number.isFinite(visitsCount) && visitsCount > 0 && durationDays != null) {
    return Math.max(1, Math.floor(durationDays / visitsCount));
  }

  return Math.max(1, input.defaultIntervalMonths * 30);
}

function activeServiceAgreementJoin(alias = 'd') {
  return `LEFT JOIN LATERAL (
          SELECT sa.id,
                 sa.maintenance_plan,
                 sa.visits_count,
                 sa.start_date,
                 sa.end_date
            FROM service_agreements sa
           WHERE sa.installed_device_id = ${alias}.id
             AND sa.status = 'active'
             AND (sa.start_date IS NULL OR sa.start_date <= CURRENT_DATE)
             AND (sa.end_date IS NULL OR sa.end_date >= CURRENT_DATE)
           ORDER BY COALESCE(sa.start_date, sa.agreement_date) DESC, sa.id DESC
           LIMIT 1
        ) sa ON TRUE`;
}

function resolvePeriodicPlanSource(row: any, defaultIntervalMonths: number): {
  ok: boolean;
  skippedReason: string | null;
  intervalDays: number | null;
  contractId: number | null;
  serviceAgreementId: number | null;
} {
  if (!row.clientId || !row.branchId) {
    return { ok: false, skippedReason: 'missing_customer_or_branch', intervalDays: null, contractId: null, serviceAgreementId: null };
  }

  const contractId = row.contractId == null ? null : Number(row.contractId);
  if (Number.isInteger(contractId) && contractId > 0) {
    return {
      ok: true,
      skippedReason: null,
      intervalDays: resolveIntervalDays({
        warrantyMonths: row.warrantyMonths == null ? null : Number(row.warrantyMonths),
        warrantyVisits: row.warrantyVisits == null ? null : Number(row.warrantyVisits),
        maintenancePlan: row.maintenancePlan ?? null,
        defaultIntervalMonths,
      }),
      contractId,
      serviceAgreementId: null,
    };
  }

  const serviceAgreementId = row.serviceAgreementId == null ? null : Number(row.serviceAgreementId);
  if (Number.isInteger(serviceAgreementId) && serviceAgreementId > 0) {
    return {
      ok: true,
      skippedReason: null,
      intervalDays: resolveServiceAgreementIntervalDays({
        maintenancePlan: row.serviceAgreementMaintenancePlan ?? null,
        visitsCount: row.serviceAgreementVisitsCount == null ? null : Number(row.serviceAgreementVisitsCount),
        startDate: row.serviceAgreementStartDate ?? null,
        endDate: row.serviceAgreementEndDate ?? null,
        defaultIntervalMonths,
      }),
      contractId: null,
      serviceAgreementId,
    };
  }

  return { ok: false, skippedReason: 'missing_active_service_agreement', intervalDays: null, contractId: null, serviceAgreementId: null };
}

export async function generateFirstPeriodicMaintenanceTask(
  db: Queryable,
  installedDeviceId: number,
  createdByUserId: number | null = null,
  options: FirstPeriodicMaintenanceGenerationOptions = {},
): Promise<PeriodicMaintenanceGenerationResult> {
  const settings = options.settings ?? await getPeriodicMaintenanceSettings();
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
            c.maintenance_plan AS "maintenancePlan",
            sa.id AS "serviceAgreementId",
            sa.maintenance_plan AS "serviceAgreementMaintenancePlan",
            sa.visits_count AS "serviceAgreementVisitsCount",
            sa.start_date AS "serviceAgreementStartDate",
            sa.end_date AS "serviceAgreementEndDate"
       FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
       ${activeServiceAgreementJoin('d')}
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
  const plan = resolvePeriodicPlanSource(device, settings.defaultIntervalMonths);
  if (!plan.ok || plan.intervalDays == null) {
    return { createdTaskId: null, skippedReason: plan.skippedReason, dueDate: null, intervalDays: null };
  }
  const intervalDays = plan.intervalDays;
  const activationDate = options.activationDateOverride ?? device.activatedAt ?? null;
  if (!activationDate) {
    return { createdTaskId: null, skippedReason: 'missing_activation_timestamp', dueDate: null, intervalDays };
  }

  const { rows: dueRows } = await db.query(
    `SELECT ($1::timestamptz::date + $2::int) AS "dueDate"`,
    [activationDate, intervalDays],
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
  if (options.dryRun === true) {
    return { createdTaskId: null, skippedReason: 'dry_run_would_create', dueDate, intervalDays };
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
      plan.contractId,
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
       (open_task_id, generation_origin, interval_days_snapshot, service_agreement_id, created_by)
     VALUES ($1, 'system', $2, $3, $4)
     ON CONFLICT (open_task_id) DO UPDATE
       SET interval_days_snapshot = EXCLUDED.interval_days_snapshot,
           service_agreement_id = EXCLUDED.service_agreement_id,
           updated_at = NOW()`,
    [createdTaskId, intervalDays, plan.serviceAgreementId, createdByUserId],
  );

  await persistOpenTaskSnapshots(
    db,
    createdTaskId,
    Number(device.clientId),
    plan.contractId,
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
            c.maintenance_plan AS "maintenancePlan",
            sa.id AS "serviceAgreementId",
            sa.maintenance_plan AS "serviceAgreementMaintenancePlan",
            sa.visits_count AS "serviceAgreementVisitsCount",
            sa.start_date AS "serviceAgreementStartDate",
            sa.end_date AS "serviceAgreementEndDate"
       FROM open_tasks ot
       LEFT JOIN open_task_periodic_payload otp ON otp.open_task_id = ot.id
       LEFT JOIN installed_devices d ON d.id = ot.device_id
       LEFT JOIN contracts c ON c.id = ot.contract_id
       ${activeServiceAgreementJoin('d')}
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
  const plan = resolvePeriodicPlanSource(task, settings.defaultIntervalMonths);
  if (!plan.ok) {
    return { createdTaskId: null, skippedReason: plan.skippedReason, dueDate: null, intervalDays: null };
  }

  const intervalSnapshot = task.intervalDaysSnapshot == null ? null : Number(task.intervalDaysSnapshot);
  const intervalDays = Number.isFinite(intervalSnapshot) && intervalSnapshot! > 0
    ? Math.floor(intervalSnapshot!)
    : Number(plan.intervalDays);

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
      plan.contractId,
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
       (open_task_id, generation_origin, interval_days_snapshot, service_agreement_id, created_by)
     VALUES ($1, 'system', $2, $3, $4)
     ON CONFLICT (open_task_id) DO UPDATE
       SET interval_days_snapshot = EXCLUDED.interval_days_snapshot,
           service_agreement_id = EXCLUDED.service_agreement_id,
           updated_at = NOW()`,
    [createdTaskId, intervalDays, plan.serviceAgreementId, createdByUserId],
  );

  await persistOpenTaskSnapshots(
    db,
    createdTaskId,
    Number(task.clientId),
    plan.contractId,
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
            c.maintenance_plan AS "maintenancePlan",
            sa.id AS "serviceAgreementId",
            sa.maintenance_plan AS "serviceAgreementMaintenancePlan",
            sa.visits_count AS "serviceAgreementVisitsCount",
            sa.start_date AS "serviceAgreementStartDate",
            sa.end_date AS "serviceAgreementEndDate"
       FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
       ${activeServiceAgreementJoin('d')}
      WHERE d.id = $1
      LIMIT 1`,
    [input.installedDeviceId],
  );
  const device = rows[0];
  if (!device) throw new Error('الجهاز غير موجود.');
  if (device.status !== 'active') throw new Error('لا يمكن إنشاء دورية يدوية إلا لجهاز active.');
  const plan = resolvePeriodicPlanSource(device, settings.defaultIntervalMonths);
  if (!plan.ok) {
    throw new Error(plan.skippedReason === 'missing_active_service_agreement'
      ? 'الجهاز الخارجي يحتاج اتفاق خدمة فعالاً قبل إنشاء صيانة دورية.'
      : 'الجهاز لا يملك روابط زبون/فرع كافية لإنشاء دورية.');
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
    : Number(plan.intervalDays);

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
      plan.contractId,
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
       (open_task_id, generation_origin, interval_days_snapshot, service_agreement_id, manual_reason, created_by)
     VALUES ($1, 'manual', $2, $3, $4, $5)`,
    [createdTaskId, intervalDays, plan.serviceAgreementId, manualReason, input.createdByUserId ?? null],
  );

  await persistOpenTaskSnapshots(
    db,
    createdTaskId,
    Number(device.clientId),
    plan.contractId,
    input.installedDeviceId,
  );

  return { createdTaskId, dueDate, intervalDays };
}

/**
 * Create one periodic task from an approved service request.
 * The caller owns the transaction and request row lock. This function locks
 * the device and rechecks eligibility/active-task uniqueness at decision time.
 */
export async function createPeriodicMaintenanceTaskFromServiceRequest(
  db: Queryable,
  input: ServiceRequestPeriodicMaintenanceInput,
): Promise<ServiceRequestPeriodicMaintenanceResult> {
  const settings = input.settings ?? await getPeriodicMaintenanceSettings();
  const { rows } = await db.query(
    `SELECT d.id,
            d.customer_id AS "clientId",
            d.branch_id AS "branchId",
            d.contract_id AS "contractId",
            d.status,
            d.activated_at AS "activatedAt",
            d.warranty_months AS "warrantyMonths",
            d.warranty_visits AS "warrantyVisits",
            c.maintenance_plan AS "maintenancePlan",
            sa.id AS "serviceAgreementId",
            sa.maintenance_plan AS "serviceAgreementMaintenancePlan",
            sa.visits_count AS "serviceAgreementVisitsCount",
            sa.start_date AS "serviceAgreementStartDate",
            sa.end_date AS "serviceAgreementEndDate"
       FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
       ${activeServiceAgreementJoin('d')}
      WHERE d.id = $1
      LIMIT 1
      FOR UPDATE OF d`,
    [input.installedDeviceId],
  );
  const device = rows[0];
  if (!device) return { outcome: 'ineligible', reason: 'device_not_found' };
  if (device.status !== 'active') return { outcome: 'ineligible', reason: 'device_not_active' };
  const plan = resolvePeriodicPlanSource(device, settings.defaultIntervalMonths);
  if (!plan.ok || plan.intervalDays == null) {
    return { outcome: 'ineligible', reason: plan.skippedReason ?? 'periodic_plan_unavailable' };
  }
  const intervalDays = Number(plan.intervalDays);

  const { rows: activeRows } = await db.query(
    `SELECT id
       FROM open_tasks
      WHERE task_type = 'periodic_maintenance'
        AND device_id = $1
        AND status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE`,
    [input.installedDeviceId],
  );
  if (activeRows[0]) {
    return { outcome: 'active_task_exists', taskId: Number(activeRows[0].id) };
  }

  const { rows: historyRows } = await db.query(
    `SELECT ot.id, ot.status, ot.due_date::text AS "dueDate",
            ot.closed_at AS "closedAt",
            otp.superseded_by_open_task_id AS "supersededByOpenTaskId",
            superseding.closed_at AS "supersedingClosedAt"
       FROM open_tasks ot
       LEFT JOIN open_task_periodic_payload otp ON otp.open_task_id = ot.id
       LEFT JOIN open_tasks superseding ON superseding.id = otp.superseded_by_open_task_id
      WHERE ot.task_type = 'periodic_maintenance'
        AND ot.device_id = $1
      ORDER BY COALESCE(ot.closed_at, ot.updated_at, ot.created_at) DESC, ot.id DESC
      LIMIT 1`,
    [input.installedDeviceId],
  );
  const previous = historyRows[0] ?? null;
  let dueDate: string | null = null;
  if (!previous) {
    if (!device.activatedAt) {
      return { outcome: 'missing_schedule_anchor', reason: 'missing_activation_timestamp' };
    }
    const { rows: dueRows } = await db.query(
      `SELECT ($1::timestamptz::date + $2::int)::text AS "dueDate"`,
      [device.activatedAt, intervalDays],
    );
    dueDate = dueRows[0]?.dueDate ?? null;
  } else if (previous.supersededByOpenTaskId != null) {
    if (!previous.supersedingClosedAt) {
      return { outcome: 'missing_schedule_anchor', reason: 'missing_superseding_execution_timestamp' };
    }
    const { rows: dueRows } = await db.query(
      `SELECT ($1::timestamptz::date + $2::int)::text AS "dueDate"`,
      [previous.supersedingClosedAt, intervalDays],
    );
    dueDate = dueRows[0]?.dueDate ?? null;
  } else if (previous.status === 'cancelled') {
    dueDate = previous.dueDate ?? null;
  } else {
    if (!previous.closedAt) {
      return { outcome: 'missing_schedule_anchor', reason: 'missing_previous_closed_timestamp' };
    }
    const { rows: dueRows } = await db.query(
      `SELECT ($1::timestamptz::date + $2::int)::text AS "dueDate"`,
      [previous.closedAt, intervalDays],
    );
    dueDate = dueRows[0]?.dueDate ?? null;
  }
  if (!dueDate) return { outcome: 'missing_schedule_anchor', reason: 'due_date_not_resolved' };

  const reasonLabel = String(input.requestReasonSnapshot.label ?? 'طلب صيانة دورية').trim();
  const { rows: taskRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, contract_id, device_id,
       task_type, task_family, reason,
       status, due_date, priority,
       source, creation_origin, origin,
       notes, created_by, source_service_request_id
     ) VALUES (
       $1, $2, $3, $4,
       'periodic_maintenance', 'maintenance', 'service_request',
       'open', $5::date, 'medium',
       'service_request', 'periodic_request', 'service_request',
       $6, $7, $8
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      Number(device.clientId),
      Number(device.branchId),
      plan.contractId,
      input.installedDeviceId,
      dueDate,
      reasonLabel,
      input.createdByUserId,
      input.serviceRequestId,
    ],
  );
  let taskId = taskRows[0]?.id ? Number(taskRows[0].id) : null;
  if (taskId == null) {
    const { rows: concurrentRows } = await db.query(
      `SELECT id FROM open_tasks
        WHERE task_type = 'periodic_maintenance'
          AND device_id = $1
          AND status NOT IN ('completed', 'closed', 'cancelled')
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [input.installedDeviceId],
    );
    if (concurrentRows[0]) {
      return { outcome: 'active_task_exists', taskId: Number(concurrentRows[0].id) };
    }
    throw new Error('periodic_service_request_task_insert_failed');
  }

  await db.query(
    `INSERT INTO open_task_periodic_payload
       (open_task_id, generation_origin, interval_days_snapshot,
        service_agreement_id, request_reason_id, request_reason_snapshot, created_by)
     VALUES ($1, 'service_request', $2, $3, $4, $5::jsonb, $6)`,
    [
      taskId,
      intervalDays,
      plan.serviceAgreementId,
      input.requestReasonId,
      JSON.stringify(input.requestReasonSnapshot),
      input.createdByUserId,
    ],
  );
  await persistOpenTaskSnapshots(
    db,
    taskId,
    Number(device.clientId),
    plan.contractId,
    input.installedDeviceId,
  );
  return {
    outcome: 'created',
    taskId,
    dueDate,
    intervalDays,
    branchId: Number(device.branchId),
  };
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
