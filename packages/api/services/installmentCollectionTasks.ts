import type { PoolClient } from 'pg';
import { persistOpenTaskSnapshots } from '../routes/openTasks.js';

type Queryable = Pick<PoolClient, 'query'>;

const ACTIVE_COLLECTION_TASK_STATUSES = [
  'open',
  'needs_follow_up',
  'assigned',
  'in_scheduling',
  'scheduled',
  'waiting_execution',
  'in_execution',
  'ended',
];

export type ReceivableSourceType = 'contract' | 'maintenance_task' | 'golden_warranty';

// Which installments table a collection task points at — one FK column each (migr 484).
export type InstallmentKind = 'contract' | 'maintenance' | 'warranty';

export const INSTALLMENT_FK_COLUMN: Record<InstallmentKind, 'installment_id' | 'maintenance_installment_id' | 'warranty_installment_id'> = {
  contract: 'installment_id',
  maintenance: 'maintenance_installment_id',
  warranty: 'warranty_installment_id',
};

export interface CreateInstallmentCollectionTaskArgs {
  installmentId: number;
  /** Defaults to 'contract' (contract_installments). */
  installmentKind?: InstallmentKind;
  dueDate?: string | null;
  priority?: 'high' | 'medium' | 'low' | null;
  reason:
    | 'contract_installment_due'
    | 'maintenance_receivable_due'
    | 'golden_warranty_receivable_due'
    | 'remaining_installment_balance'
    | 'rescheduled_collection'
    | 'previous_task_cancelled'
    | 'manager_followup'
    | 'data_correction'
    | 'other';
  creationOrigin?: 'system_trigger' | 'manual_creation' | 'branch_plan';
  creationReason?: string | null;
  notes?: string | null;
  createdBy?: number | null;
  sourceContextType?: string | null;
  sourceContextId?: number | null;
  receivableSourceType?: ReceivableSourceType;
  receivableSourceId?: number | null;
  receivableSourceLabel?: string | null;
}

export interface CreateInstallmentCollectionTaskResult {
  taskId: number | null;
  skipped: boolean;
  reason?: 'installment_not_found' | 'no_remaining_balance' | 'active_task_exists';
  existingTaskId?: number | null;
}

function normalizePriority(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'low' || value === 'medium' ? value : 'medium';
}

function asPositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type CollectableInstallment = {
  id: number;
  contractId: number | null;
  deviceId: number | null;
  installmentNumber: number;
  dueDate: string;
  remainingBalance: unknown;
  customerId: number;
  branchId: number;
  sourceType: ReceivableSourceType;
  sourceId: number;
  sourceLabel: string;
};

/** Reads one installment of any kind in a common shape (confirmed plans only). */
export async function loadCollectableInstallment(
  db: Queryable,
  kind: InstallmentKind,
  installmentId: number,
): Promise<CollectableInstallment | null> {
  if (kind === 'maintenance') {
    const { rows } = await db.query(
      `SELECT i.id, ot.contract_id AS "contractId", ot.device_id AS "deviceId",
              i.installment_number AS "installmentNumber", i.due_date AS "dueDate",
              i.remaining_balance AS "remainingBalance",
              ot.client_id AS "customerId", ot.branch_id AS "branchId",
              ot.id AS "taskId", ot.task_type AS "taskType"
         FROM emergency_installments i
         JOIN open_tasks ot ON ot.id = i.open_task_id
        WHERE i.id = $1 AND i.confirmed = TRUE
        LIMIT 1`,
      [installmentId],
    );
    const r = rows[0];
    if (!r) return null;
    const label = r.taskType === 'periodic_maintenance' ? 'صيانة دورية' : 'صيانة طارئة';
    return { ...r, sourceType: 'maintenance_task', sourceId: Number(r.taskId), sourceLabel: `${label} — مهمة #${r.taskId}` };
  }
  if (kind === 'warranty') {
    const { rows } = await db.query(
      `SELECT i.id, d.contract_id AS "contractId", d.id AS "deviceId",
              i.installment_number AS "installmentNumber", i.due_date AS "dueDate",
              i.remaining_balance AS "remainingBalance",
              d.customer_id AS "customerId", d.branch_id AS "branchId",
              w.id AS "warrantyId", d.serial_number AS "serial"
         FROM device_warranty_installments i
         JOIN device_warranties w ON w.id = i.warranty_id
         JOIN installed_devices d ON d.id = w.device_id
        WHERE i.id = $1 AND i.confirmed = TRUE AND w.warranty_type = 'golden'
        LIMIT 1`,
      [installmentId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ...r, sourceType: 'golden_warranty', sourceId: Number(r.warrantyId),
      sourceLabel: `الكفالة الذهبية #${r.warrantyId}${r.serial ? ` — جهاز ${r.serial}` : ''}`,
    };
  }
  const { rows } = await db.query(
    `SELECT i.id, i.contract_id AS "contractId", NULL::int AS "deviceId",
            i.installment_number AS "installmentNumber", i.due_date AS "dueDate",
            i.remaining_balance AS "remainingBalance",
            c.customer_id AS "customerId", COALESCE(c.service_branch_id, c.branch_id) AS "branchId",
            c.contract_number AS "contractNumber"
       FROM contract_installments i
       JOIN contracts c ON c.id = i.contract_id
      WHERE i.id = $1
      LIMIT 1`,
    [installmentId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...r, sourceType: 'contract', sourceId: Number(r.contractId),
    sourceLabel: `عقد رقم ${r.contractNumber ?? `#${r.contractId}`}`,
  };
}

async function resolveCollectionCreationReason(
  db: Queryable,
  systemReason: CreateInstallmentCollectionTaskArgs['reason'],
  creationReason?: string | null,
): Promise<string> {
  const requested = typeof creationReason === 'string' ? creationReason.trim() || null : null;
  const { rows } = await db.query(
    `SELECT value
       FROM system_lists
      WHERE category = 'installment_collection_creation_reasons'
        AND is_active = TRUE
        AND (
          ($1::text IS NOT NULL AND value = $1 AND COALESCE(metadata->>'systemReason', $2) = $2)
          OR ($1::text IS NULL AND metadata->>'systemReason' = $2)
        )
      ORDER BY
        CASE WHEN value = $1 THEN 0 ELSE 1 END,
        display_order ASC,
        id ASC
      LIMIT 1`,
    [requested, systemReason],
  );
  if (rows.length === 0) {
    throw new Error('سبب إنشاء مهمة التحصيل مطلوب ويجب اختياره من قائمته المعتمدة');
  }
  return String(rows[0].value);
}

export async function createInstallmentCollectionTask(
  db: Queryable,
  args: CreateInstallmentCollectionTaskArgs,
): Promise<CreateInstallmentCollectionTaskResult> {
  const installmentId = Number(args.installmentId);
  if (!Number.isInteger(installmentId) || installmentId <= 0) {
    return { taskId: null, skipped: true, reason: 'installment_not_found' };
  }

  const kind: InstallmentKind = args.installmentKind ?? 'contract';
  const fkColumn = INSTALLMENT_FK_COLUMN[kind];
  const installment = await loadCollectableInstallment(db, kind, installmentId);
  if (!installment) {
    return { taskId: null, skipped: true, reason: 'installment_not_found' };
  }

  const remainingBalance = asPositiveNumber(installment.remainingBalance);
  if (remainingBalance <= 0) {
    return { taskId: null, skipped: true, reason: 'no_remaining_balance' };
  }

  const { rows: activeRows } = await db.query(
    `SELECT id
       FROM open_tasks
      WHERE task_type = 'installment_collection'
        AND ${fkColumn} = $1
        AND status = ANY($2::varchar[])
      ORDER BY created_at DESC
      LIMIT 1`,
    [installmentId, ACTIVE_COLLECTION_TASK_STATUSES],
  );
  if (activeRows.length > 0) {
    return {
      taskId: null,
      skipped: true,
      reason: 'active_task_exists',
      existingTaskId: Number(activeRows[0].id),
    };
  }

  // The installment's own kind decides the receivable source; callers may only relabel.
  const sourceType = installment.sourceType;
  const sourceId = args.receivableSourceId ?? installment.sourceId;
  const sourceLabel = args.receivableSourceLabel ?? installment.sourceLabel;
  const dueDate = args.dueDate ?? installment.dueDate;
  const creationReason = await resolveCollectionCreationReason(db, args.reason, args.creationReason);
  const contractId = installment.contractId != null ? Number(installment.contractId) : null;

  const { rows: insertedRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, task_type, task_family, reason, status,
       due_date, priority, source, notes, created_by, origin,
       contract_id, device_id, ${fkColumn}, creation_origin, creation_reason,
       source_context_type, source_context_id,
       receivable_source_type, receivable_source_id, receivable_source_label,
       expected_amount_syp
     ) VALUES (
       $1, $2, 'installment_collection', 'collection', $3, 'open',
       $4::date, $5, 'system', $6, $7, 'system_trigger',
       $8, $9, $10, $11, $12,
       $13, $14,
       $15, $16, $17,
       $18
     )
     RETURNING id`,
    [
      Number(installment.customerId),
      Number(installment.branchId),
      args.reason,
      dueDate,
      normalizePriority(args.priority),
      args.notes ?? null,
      args.createdBy ?? null,
      contractId,
      installment.deviceId != null ? Number(installment.deviceId) : null,
      installmentId,
      args.creationOrigin ?? 'system_trigger',
      creationReason,
      args.sourceContextType ?? null,
      args.sourceContextId ?? null,
      sourceType,
      sourceId,
      sourceLabel,
      remainingBalance,
    ],
  );

  const taskId = Number(insertedRows[0].id);
  await persistOpenTaskSnapshots(db, taskId, Number(installment.customerId), contractId);
  return { taskId, skipped: false };
}

export async function createInstallmentCollectionTasksForContract(
  db: Queryable,
  contractId: number,
): Promise<{ created: number[]; skipped: CreateInstallmentCollectionTaskResult[] }> {
  const { rows } = await db.query(
    `SELECT id
       FROM contract_installments
      WHERE contract_id = $1
        AND confirmed = TRUE
        AND remaining_balance > 0
      ORDER BY installment_number ASC`,
    [contractId],
  );

  const created: number[] = [];
  const skipped: CreateInstallmentCollectionTaskResult[] = [];
  for (const row of rows) {
    const result = await createInstallmentCollectionTask(db, {
      installmentId: Number(row.id),
      reason: 'contract_installment_due',
      creationOrigin: 'system_trigger',
      priority: 'medium',
    });
    if (result.taskId) created.push(result.taskId);
    else skipped.push(result);
  }
  return { created, skipped };
}

/** مهام تحصيل لأقساط صيانة مؤكَّدة (عند اعتماد جدول الأقساط). نفس طابور أقساط العقود. */
export async function createInstallmentCollectionTasksForMaintenance(
  db: Queryable,
  installmentIds: number[],
  createdBy?: number | null,
): Promise<{ created: number[]; skipped: CreateInstallmentCollectionTaskResult[] }> {
  return createForKind(db, 'maintenance', installmentIds, 'maintenance_receivable_due', createdBy);
}

/** مهام تحصيل لأقساط كفالة ذهبية (عند تفعيلها بالتقسيط). */
export async function createInstallmentCollectionTasksForWarranty(
  db: Queryable,
  warrantyId: number,
  createdBy?: number | null,
): Promise<{ created: number[]; skipped: CreateInstallmentCollectionTaskResult[] }> {
  const { rows } = await db.query(
    `SELECT id FROM device_warranty_installments
      WHERE warranty_id = $1 AND confirmed = TRUE AND remaining_balance > 0
      ORDER BY installment_number ASC`,
    [warrantyId],
  );
  return createForKind(db, 'warranty', rows.map((r: any) => Number(r.id)), 'golden_warranty_receivable_due', createdBy);
}

async function createForKind(
  db: Queryable,
  kind: InstallmentKind,
  installmentIds: number[],
  reason: CreateInstallmentCollectionTaskArgs['reason'],
  createdBy?: number | null,
) {
  const created: number[] = [];
  const skipped: CreateInstallmentCollectionTaskResult[] = [];
  for (const id of installmentIds) {
    const result = await createInstallmentCollectionTask(db, {
      installmentId: id,
      installmentKind: kind,
      reason,
      creationOrigin: 'system_trigger',
      priority: 'medium',
      createdBy: createdBy ?? null,
    });
    if (result.taskId) created.push(result.taskId);
    else skipped.push(result);
  }
  return { created, skipped };
}
