// ============================================================
// uncoveredReceivables.ts — «ذمم بلا مهمة تحصيل» (detection only)
// ============================================================
// Every receivable installment is meant to carry an installment_collection
// task. This service finds installments that still owe money but have NO active
// collection task (never created, cancelled, or completed with balance left),
// across the three installment tables that collection tasks point at (migr 484):
//   contract    → contract_installments        (open_tasks.installment_id)
//   maintenance → emergency_installments       (open_tasks.maintenance_installment_id)
//   warranty    → device_warranty_installments (open_tasks.warranty_installment_id)
//
// "Active task" = the SAME status set createInstallmentCollectionTask refuses to
// duplicate (ACTIVE_COLLECTION_TASK_STATUSES = every status except
// completed / closed / cancelled), so the list and the create action agree.
//
// Branch of a row = the branch a collection task for it would get
// (loadCollectableInstallment): contract → COALESCE(service_branch_id, branch_id),
// maintenance → the maintenance task's branch, warranty → the device's branch.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import type { AuthContext, ListAccessPlan } from '@golden-crm/shared';
import { canEditOpenTask } from '../policies/openTaskPolicy.js';
import { attachReceivableUsdDues } from './fxRates.js';
import {
  ACTIVE_COLLECTION_TASK_STATUSES,
  INSTALLMENT_FK_COLUMN,
  createInstallmentCollectionTask,
  type CreateInstallmentCollectionTaskArgs,
  type InstallmentKind,
} from './installmentCollectionTasks.js';

type Queryable = Pool | PoolClient;

export type UncoveredReason = 'never_created' | 'task_cancelled' | 'task_completed_with_balance';
export const UNCOVERED_REASONS: UncoveredReason[] = ['never_created', 'task_cancelled', 'task_completed_with_balance'];
export const UNCOVERED_KINDS: InstallmentKind[] = ['contract', 'maintenance', 'warranty'];

/** Max installments per create-tasks click. */
export const UNCOVERED_CREATE_BATCH_LIMIT = 50;

export interface UncoveredFilters {
  /** Narrow to one branch (must be inside the caller's scope). */
  branchId?: number | null;
  kind?: InstallmentKind | null;
  reason?: UncoveredReason | null;
  overdueOnly?: boolean;
  dueFrom?: string | null;
  dueTo?: string | null;
  search?: string | null;
  clientId?: number | null;
}

const TODAY_SQL = `(NOW() AT TIME ZONE 'Asia/Damascus')::date`;

/** Last collection task (any status) of an installment, by FK column. */
function lastTaskJoin(fk: string, alias: string): string {
  return `
    LEFT JOIN LATERAL (
      SELECT lt.id, lt.status, COALESCE(lt.updated_at, lt.created_at) AS at
        FROM open_tasks lt
       WHERE lt.task_type = 'installment_collection' AND lt.${fk} = ${alias}.id
       ORDER BY lt.created_at DESC, lt.id DESC
       LIMIT 1
    ) last_task ON TRUE`;
}

function noActiveTask(fk: string, alias: string, activeParam: string): string {
  return `
      AND NOT EXISTS (
        SELECT 1 FROM open_tasks act
         WHERE act.task_type = 'installment_collection'
           AND act.${fk} = ${alias}.id
           AND act.status = ANY(${activeParam}::varchar[]))`;
}

/**
 * The union of all uncovered installments, one row each. `activeParam` is the
 * placeholder holding ACTIVE_COLLECTION_TASK_STATUSES.
 */
function uncoveredUnionSql(activeParam: string): string {
  return `
    SELECT 'contract'::text AS kind, i.id AS installment_id, i.installment_number, i.due_date,
           i.amount_syp::numeric AS amount_syp, i.remaining_balance::numeric AS remaining_balance,
           c.customer_id AS client_id, COALESCE(c.service_branch_id, c.branch_id) AS branch_id,
           'contract'::text AS source_type, c.id AS source_id,
           ('عقد رقم ' || COALESCE(c.contract_number::text, c.id::text)) AS source_label,
           c.id AS contract_id, c.contract_number::text AS contract_number, NULL::int AS device_id,
           last_task.id AS last_task_id, last_task.status::text AS last_task_status, last_task.at AS last_task_at
      FROM contract_installments i
      JOIN contracts c ON c.id = i.contract_id
      ${lastTaskJoin('installment_id', 'i')}
     WHERE i.confirmed = TRUE AND i.remaining_balance > 0 AND c.status = 'active'
      ${noActiveTask('installment_id', 'i', activeParam)}
    UNION ALL
    SELECT 'maintenance'::text, mi.id, mi.installment_number, mi.due_date,
           mi.amount_syp::numeric, mi.remaining_balance::numeric,
           ot.client_id, ot.branch_id,
           'maintenance_task'::text, ot.id,
           ((CASE WHEN ot.task_type = 'periodic_maintenance' THEN 'صيانة دورية' ELSE 'صيانة طارئة' END) || ' — مهمة #' || ot.id),
           ot.contract_id, NULL::text, ot.device_id,
           last_task.id, last_task.status::text, last_task.at
      FROM emergency_installments mi
      JOIN open_tasks ot ON ot.id = mi.open_task_id
      ${lastTaskJoin('maintenance_installment_id', 'mi')}
     WHERE mi.confirmed = TRUE AND mi.remaining_balance > 0
      ${noActiveTask('maintenance_installment_id', 'mi', activeParam)}
    UNION ALL
    SELECT 'warranty'::text, wi.id, wi.installment_number, wi.due_date,
           wi.amount_syp::numeric, wi.remaining_balance::numeric,
           d.customer_id, d.branch_id,
           'golden_warranty'::text, w.id,
           ('الكفالة الذهبية #' || w.id || COALESCE(' — جهاز ' || d.serial_number, '')),
           d.contract_id, NULL::text, d.id,
           last_task.id, last_task.status::text, last_task.at
      FROM device_warranty_installments wi
      JOIN device_warranties w ON w.id = wi.warranty_id AND w.warranty_type = 'golden'
      JOIN installed_devices d ON d.id = w.device_id
      ${lastTaskJoin('warranty_installment_id', 'wi')}
     WHERE wi.confirmed = TRUE AND wi.remaining_balance > 0
       AND COALESCE(w.status, '') <> 'cancelled'
      ${noActiveTask('warranty_installment_id', 'wi', activeParam)}`;
}

const REASON_SQL = `CASE
    WHEN u.last_task_id IS NULL THEN 'never_created'
    WHEN u.last_task_status = 'cancelled' THEN 'task_cancelled'
    ELSE 'task_completed_with_balance' END`;

/**
 * Builds `FROM (...) u JOIN clients ... WHERE ...` with the caller's scope and
 * the common filters. kind/reason are optional so the summary can ignore them.
 */
function buildScopedQuery(
  plan: ListAccessPlan,
  filters: UncoveredFilters,
  opts: { applyKindReason: boolean },
): { fromSql: string; params: any[] } {
  const params: any[] = [ACTIVE_COLLECTION_TASK_STATUSES];
  const where: string[] = [];

  if (plan.scope !== 'GLOBAL') {
    params.push(plan.allowedBranchIds ?? []);
    where.push(`u.branch_id = ANY($${params.length}::int[])`);
  }
  if (filters.branchId) {
    params.push(filters.branchId);
    where.push(`u.branch_id = $${params.length}`);
  }
  if (filters.clientId) {
    params.push(filters.clientId);
    where.push(`u.client_id = $${params.length}`);
  }
  if (filters.overdueOnly) where.push(`u.due_date < ${TODAY_SQL}`);
  if (filters.dueFrom) {
    params.push(filters.dueFrom);
    where.push(`u.due_date >= $${params.length}::date`);
  }
  if (filters.dueTo) {
    params.push(filters.dueTo);
    where.push(`u.due_date <= $${params.length}::date`);
  }
  const search = filters.search?.trim();
  if (search) {
    params.push(`%${search}%`);
    const like = `$${params.length}`;
    const parts = [`cl.name ILIKE ${like}`, `cl.mobile ILIKE ${like}`, `u.contract_number ILIKE ${like}`, `u.source_label ILIKE ${like}`];
    if (/^\d+$/.test(search)) {
      params.push(Number(search));
      parts.push(`u.client_id = $${params.length}`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (opts.applyKindReason) {
    if (filters.kind) {
      params.push(filters.kind);
      where.push(`u.kind = $${params.length}`);
    }
    if (filters.reason) {
      params.push(filters.reason);
      where.push(`(${REASON_SQL}) = $${params.length}`);
    }
  }

  const fromSql = `
    FROM (${uncoveredUnionSql('$1')}) u
    LEFT JOIN clients cl ON cl.id = u.client_id
    LEFT JOIN branches b ON b.id = u.branch_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return { fromSql, params };
}

export interface UncoveredBucket { count: number; amountSyp: number; overdueCount: number; overdueAmountSyp: number }
export interface UncoveredSummary {
  total: UncoveredBucket;
  byReason: Record<UncoveredReason, UncoveredBucket>;
  byKind: Record<InstallmentKind, UncoveredBucket>;
}

function emptyBucket(): UncoveredBucket {
  return { count: 0, amountSyp: 0, overdueCount: 0, overdueAmountSyp: 0 };
}

function addTo(bucket: UncoveredBucket, row: any) {
  bucket.count += Number(row.count) || 0;
  bucket.amountSyp += Number(row.amount) || 0;
  bucket.overdueCount += Number(row.overdue_count) || 0;
  bucket.overdueAmountSyp += Number(row.overdue_amount) || 0;
}

async function loadSummaryCells(db: Queryable, plan: ListAccessPlan, filters: UncoveredFilters) {
  const { fromSql, params } = buildScopedQuery(plan, filters, { applyKindReason: false });
  const { rows } = await db.query(
    `SELECT u.kind, ${REASON_SQL} AS reason,
            COUNT(*)::int AS count, COALESCE(SUM(u.remaining_balance), 0)::float8 AS amount,
            COUNT(*) FILTER (WHERE u.due_date < ${TODAY_SQL})::int AS overdue_count,
            COALESCE(SUM(u.remaining_balance) FILTER (WHERE u.due_date < ${TODAY_SQL}), 0)::float8 AS overdue_amount
       ${fromSql}
      GROUP BY 1, 2`,
    params,
  );
  return rows;
}

/**
 * Totals per reason and per kind. Ignores the kind/reason filters (the cards
 * act as quick filters) but honours scope + every other filter.
 * `listTotal` = count matching ALL filters (the paged list's total).
 */
export async function getUncoveredSummary(
  db: Queryable,
  plan: ListAccessPlan,
  filters: UncoveredFilters,
): Promise<UncoveredSummary & { listTotal: number; listAmountSyp: number }> {
  const cells = await loadSummaryCells(db, plan, filters);
  const summary: UncoveredSummary = {
    total: emptyBucket(),
    byReason: { never_created: emptyBucket(), task_cancelled: emptyBucket(), task_completed_with_balance: emptyBucket() },
    byKind: { contract: emptyBucket(), maintenance: emptyBucket(), warranty: emptyBucket() },
  };
  let listTotal = 0;
  let listAmountSyp = 0;
  for (const row of cells) {
    addTo(summary.total, row);
    addTo(summary.byReason[row.reason as UncoveredReason], row);
    addTo(summary.byKind[row.kind as InstallmentKind], row);
    if ((!filters.kind || filters.kind === row.kind) && (!filters.reason || filters.reason === row.reason)) {
      listTotal += Number(row.count) || 0;
      listAmountSyp += Number(row.amount) || 0;
    }
  }
  return { ...summary, listTotal, listAmountSyp };
}

export interface UncoveredRow {
  kind: InstallmentKind;
  installmentId: number;
  installmentNumber: number;
  dueDate: string;
  overdueDays: number;
  amountSyp: number;
  remainingSyp: number;
  clientId: number;
  clientName: string | null;
  clientMobile: string | null;
  branchId: number | null;
  branchName: string | null;
  sourceType: 'contract' | 'maintenance_task' | 'golden_warranty';
  sourceId: number;
  sourceLabel: string;
  contractId: number | null;
  contractNumber: string | null;
  deviceId: number | null;
  reason: UncoveredReason;
  lastTaskId: number | null;
  lastTaskStatus: string | null;
  lastTaskAt: string | null;
  usdDue: unknown;
}

export async function listUncoveredReceivables(
  db: Queryable,
  plan: ListAccessPlan,
  filters: UncoveredFilters,
  paging: { page: number; pageSize: number; sortDir: 'asc' | 'desc' },
): Promise<{ rows: UncoveredRow[]; total: number; page: number; pageSize: number; summary: UncoveredSummary }> {
  const { fromSql, params } = buildScopedQuery(plan, filters, { applyKindReason: true });
  const dir = paging.sortDir === 'desc' ? 'DESC' : 'ASC';
  params.push(paging.pageSize, (paging.page - 1) * paging.pageSize);
  const [{ rows }, summary] = await Promise.all([
    db.query(
      `SELECT u.kind, u.installment_id AS "installmentId", u.installment_number AS "installmentNumber",
              to_char(u.due_date, 'YYYY-MM-DD') AS "dueDate",
              GREATEST(${TODAY_SQL} - u.due_date, 0)::int AS "overdueDays",
              u.amount_syp::float8 AS "amountSyp", u.remaining_balance::float8 AS "remainingSyp",
              u.client_id AS "clientId", cl.name AS "clientName", cl.mobile AS "clientMobile",
              u.branch_id AS "branchId", b.name AS "branchName",
              u.source_type AS "sourceType", u.source_id AS "sourceId", u.source_label AS "sourceLabel",
              u.contract_id AS "contractId", u.contract_number AS "contractNumber", u.device_id AS "deviceId",
              ${REASON_SQL} AS reason,
              u.last_task_id AS "lastTaskId", u.last_task_status AS "lastTaskStatus", u.last_task_at AS "lastTaskAt",
              CASE WHEN u.kind = 'contract' THEN u.installment_id END AS "contractInstallmentId",
              CASE WHEN u.kind = 'maintenance' THEN u.installment_id END AS "maintenanceInstallmentId"
         ${fromSql}
        ORDER BY u.due_date ${dir}, u.kind, u.installment_number, u.installment_id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    getUncoveredSummary(db, plan, filters),
  ]);
  // USD-linked contract / maintenance installments carry today's due (migr 493/495).
  const withUsd = await attachReceivableUsdDues(db, rows, 'contractInstallmentId', 'maintenanceInstallmentId');
  const cleaned = withUsd.map(({ contractInstallmentId: _c, maintenanceInstallmentId: _m, ...rest }: any) => rest as UncoveredRow);
  const { listTotal, listAmountSyp: _amount, ...plainSummary } = summary;
  return { rows: cleaned, total: listTotal, page: paging.page, pageSize: paging.pageSize, summary: plainSummary };
}

// ── Create action ────────────────────────────────────────────────────────────

const INSTALLMENT_TABLE: Record<InstallmentKind, string> = {
  contract: 'contract_installments',
  maintenance: 'emergency_installments',
  warranty: 'device_warranty_installments',
};

const DUE_REASON: Record<InstallmentKind, CreateInstallmentCollectionTaskArgs['reason']> = {
  contract: 'contract_installment_due',
  maintenance: 'maintenance_receivable_due',
  warranty: 'golden_warranty_receivable_due',
};

export type CreateOutcome =
  | { kind: InstallmentKind; installmentId: number; status: 'created'; taskId: number }
  | {
      kind: InstallmentKind;
      installmentId: number;
      status: 'skipped';
      code: 'not_uncovered' | 'forbidden' | 'branch_inactive' | 'active_task_exists' | 'no_remaining_balance' | 'installment_not_found' | 'error';
      message: string;
      existingTaskId?: number | null;
    };

const SKIP_MESSAGES = {
  not_uncovered: 'القسط لم يعد ضمن الذمم بلا مهمة (سُدِّد أو أُنشئت له مهمة أو تغيّرت حالة مصدره)',
  forbidden: 'ليس لديك صلاحية إنشاء مهمة تحصيل ضمن فرع هذا القسط',
  branch_inactive: 'فرع القسط موقوف عن العمل',
  active_task_exists: 'توجد مهمة تحصيل نشطة لهذا القسط',
  no_remaining_balance: 'لا رصيد متبقٍ على القسط',
  installment_not_found: 'القسط غير موجود',
} as const;

/**
 * Creates one collection task per uncovered installment through the system's
 * own createInstallmentCollectionTask (one-active-task rule, creation-reason
 * list, snapshots). Each installment runs in its own transaction with the
 * installment row locked, so a double click cannot produce two tasks.
 */
export async function createTasksForUncovered(
  connect: () => Promise<PoolClient>,
  authContext: AuthContext,
  items: Array<{ kind: InstallmentKind; installmentId: number }>,
): Promise<CreateOutcome[]> {
  const outcomes: CreateOutcome[] = [];
  for (const item of items) {
    const client = await connect();
    try {
      await client.query('BEGIN');
      outcomes.push(await createOne(client, authContext, item));
      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      const duplicate = err?.code === '23505';
      outcomes.push({
        kind: item.kind,
        installmentId: item.installmentId,
        status: 'skipped',
        code: duplicate ? 'active_task_exists' : 'error',
        message: duplicate ? SKIP_MESSAGES.active_task_exists : String(err?.message ?? err),
      });
    } finally {
      client.release();
    }
  }
  return outcomes;
}

/** One installment, inside the caller's open transaction (exported for tests). */
export async function createOne(
  db: Queryable,
  authContext: AuthContext,
  item: { kind: InstallmentKind; installmentId: number },
): Promise<CreateOutcome> {
  const { kind, installmentId } = item;
  const skip = (code: keyof typeof SKIP_MESSAGES, existingTaskId?: number | null): CreateOutcome => ({
    kind, installmentId, status: 'skipped', code, message: SKIP_MESSAGES[code], existingTaskId: existingTaskId ?? null,
  });

  // Serialise concurrent creates for the same installment.
  await db.query(`SELECT id FROM ${INSTALLMENT_TABLE[kind]} WHERE id = $1 FOR UPDATE`, [installmentId]);

  // Re-check eligibility with the very query the list uses (GLOBAL here; the
  // branch permission is checked right after against the row's own branch).
  const { rows } = await db.query(
    `SELECT u.branch_id AS "branchId", ${REASON_SQL} AS reason
       FROM (${uncoveredUnionSql('$1')}) u
      WHERE u.kind = $2 AND u.installment_id = $3`,
    [ACTIVE_COLLECTION_TASK_STATUSES, kind, installmentId],
  );
  const row = rows[0];
  if (!row) {
    const { rows: active } = await db.query(
      `SELECT id FROM open_tasks
        WHERE task_type = 'installment_collection' AND ${INSTALLMENT_FK_COLUMN[kind]} = $1
          AND status = ANY($2::varchar[])
        ORDER BY created_at DESC LIMIT 1`,
      [installmentId, ACTIVE_COLLECTION_TASK_STATUSES],
    );
    return active[0] ? skip('active_task_exists', Number(active[0].id)) : skip('not_uncovered');
  }

  const branchId = row.branchId != null ? Number(row.branchId) : null;
  if (!canEditOpenTask(authContext, branchId).allowed) return skip('forbidden');
  const { rows: branchRows } = await db.query('SELECT status FROM branches WHERE id = $1', [branchId]);
  if (branchRows[0]?.status === 'inactive') return skip('branch_inactive');

  const reason: CreateInstallmentCollectionTaskArgs['reason'] = row.reason === 'task_cancelled'
    ? 'previous_task_cancelled'
    : row.reason === 'task_completed_with_balance'
      ? 'remaining_installment_balance'
      : DUE_REASON[kind];

  const result = await createInstallmentCollectionTask(db, {
    installmentId,
    installmentKind: kind,
    reason,
    creationOrigin: 'manual_creation',
    createdBy: authContext.userId ?? null,
    priority: 'medium',
    sourceContextType: 'uncovered_receivables',
  });
  if (result.taskId) return { kind, installmentId, status: 'created', taskId: result.taskId };
  return skip(result.reason ?? 'installment_not_found', result.existingTaskId);
}
