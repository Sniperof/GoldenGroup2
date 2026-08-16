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

export interface CreateInstallmentCollectionTaskArgs {
  installmentId: number;
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

  const { rows: installmentRows } = await db.query(
    `SELECT
       i.id,
       i.contract_id,
       i.installment_number,
       i.due_date,
       i.amount_syp,
       i.remaining_balance,
       i.collection_owner_id,
       c.contract_number,
       c.customer_id,
       c.branch_id,
       c.service_branch_id
     FROM contract_installments i
     JOIN contracts c ON c.id = i.contract_id
     WHERE i.id = $1
     LIMIT 1`,
    [installmentId],
  );

  const installment = installmentRows[0];
  if (!installment) {
    return { taskId: null, skipped: true, reason: 'installment_not_found' };
  }

  const remainingBalance = asPositiveNumber(installment.remaining_balance);
  if (remainingBalance <= 0) {
    return { taskId: null, skipped: true, reason: 'no_remaining_balance' };
  }

  const { rows: activeRows } = await db.query(
    `SELECT id
       FROM open_tasks
      WHERE task_type = 'installment_collection'
        AND installment_id = $1
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

  const contractNumber = installment.contract_number ?? `#${installment.contract_id}`;
  const sourceType = args.receivableSourceType ?? 'contract';
  const sourceId = args.receivableSourceId ?? Number(installment.contract_id);
  const sourceLabel = args.receivableSourceLabel ?? `عقد رقم ${contractNumber}`;
  const branchId = Number(installment.service_branch_id ?? installment.branch_id);
  const dueDate = args.dueDate ?? installment.due_date;
  const creationReason = await resolveCollectionCreationReason(db, args.reason, args.creationReason);

  const { rows: insertedRows } = await db.query(
    `INSERT INTO open_tasks (
       client_id, branch_id, task_type, task_family, reason, status,
       due_date, priority, source, notes, created_by, origin,
       contract_id, installment_id, creation_origin, creation_reason,
       source_context_type, source_context_id,
       receivable_source_type, receivable_source_id, receivable_source_label,
       expected_amount_syp
     ) VALUES (
       $1, $2, 'installment_collection', 'collection', $3, 'open',
       $4::date, $5, 'system', $6, $7, 'system_trigger',
       $8, $9, $10, $11,
       $12, $13,
       $14, $15, $16,
       $17
     )
     RETURNING id`,
    [
      Number(installment.customer_id),
      branchId,
      args.reason,
      dueDate,
      normalizePriority(args.priority),
      args.notes ?? null,
      args.createdBy ?? null,
      Number(installment.contract_id),
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
  await persistOpenTaskSnapshots(db, taskId, Number(installment.customer_id), Number(installment.contract_id));
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
