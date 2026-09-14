import type { PoolClient } from 'pg';
import pool from '../../db.js';
import { buildAuthContext } from '../authorizationService.js';
import { resolveTabularReportAccess, type TabularReportAccess, type TabularReportRequestParams } from './tabularReportAccess.js';
import {
  buildReportQuery,
  persistTabularReportSnapshot,
  requireDefinition,
  TABULAR_SNAPSHOT_BATCH_SIZE,
} from './tabularReportService.js';

const WORKER_INTERVAL_MS = 2_000;
const MAX_CONCURRENT_REPORTS = 2;
const ADVISORY_LOCK_NAMESPACE = 44_601;
const CURSOR_QUERY_LIMIT = 2_147_483_647;
let timer: NodeJS.Timeout | null = null;
let ticking = false;

type ClaimedRun = {
  id: string; reportKey: string; generatedBy: number; scopeType: 'GLOBAL' | 'BRANCH' | 'ASSIGNED';
  branchIds: number[]; filters: TabularReportRequestParams;
};

function elapsedMs(startedAt: number): number { return Math.round((performance.now() - startedAt) * 100) / 100; }

async function acquireSlot(client: PoolClient): Promise<number | null> {
  for (let slot = 1; slot <= MAX_CONCURRENT_REPORTS; slot += 1) {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [ADVISORY_LOCK_NAMESPACE, slot]);
    if (rows[0]?.locked === true) return slot;
  }
  return null;
}

async function claimNextRun(client: PoolClient): Promise<ClaimedRun | null> {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `UPDATE report_runs run
        SET status='running',started_at=NOW(),heartbeat_at=NOW(),attempt_count=attempt_count+1,
            failure_message=NULL,failed_at=NULL,progress_rows=0,progress_batches=0
      WHERE run.id=(
        SELECT queued.id FROM report_runs queued
         WHERE queued.status='queued'
         ORDER BY queued.requested_at,queued.id
         LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING run.id,run.report_key AS "reportKey",run.generated_by AS "generatedBy",
                run.scope_type AS "scopeType",run.branch_ids AS "branchIds",run.filters`,
  );
  if (rows[0]) {
    await client.query(
      `INSERT INTO report_run_runtime (report_run_id,heartbeat_at,progress_rows,progress_batches)
       VALUES ($1,NOW(),0,0)
       ON CONFLICT (report_run_id) DO UPDATE
         SET heartbeat_at=EXCLUDED.heartbeat_at,progress_rows=0,progress_batches=0`,
      [rows[0].id],
    );
  }
  await client.query('COMMIT');
  if (!rows[0]) return null;
  return { ...rows[0], id: String(rows[0].id), branchIds: (rows[0].branchIds ?? []).map(Number) } as ClaimedRun;
}

async function rebuildAndVerifyAccess(run: ClaimedRun): Promise<TabularReportAccess> {
  const { rows } = await pool.query(
    `SELECT id,role_id AS "roleId",is_super_admin AS "isSuperAdmin",branch_id AS "branchId"
       FROM hr_users WHERE id=$1 AND is_active IS TRUE`,
    [run.generatedBy],
  );
  if (!rows[0]) throw new Error('مستخدم التقرير غير نشط أو غير موجود');
  const context = await buildAuthContext({ user: rows[0], headerBranchId: run.filters.branchId });
  const definition = requireDefinition(run.reportKey);
  const current = resolveTabularReportAccess(context, definition.viewPermission, run.filters, definition.supportedScopes);
  const scopeRank = { ASSIGNED: 1, BRANCH: 2, GLOBAL: 3 } as const;
  if (scopeRank[current.grantedScope] < scopeRank[run.scopeType]) throw new Error('تم تقليص صلاحية نطاق التقرير قبل بدء التوليد');
  if (run.branchIds.some(id => current.grantedScope !== 'GLOBAL' && !current.branchIds.includes(id))) {
    throw new Error('لم تعد فروع التقرير ضمن صلاحية المستخدم');
  }
  return { scope: run.scopeType, grantedScope: run.scopeType, branchIds: run.branchIds, userId: run.generatedBy };
}

async function processClaimedRun(client: PoolClient, run: ClaimedRun): Promise<void> {
  const generationStarted = performance.now();
  try {
    const access = await rebuildAndVerifyAccess(run);
    const query = buildReportQuery(run.reportKey, access, run.filters, {
      limit: CURSOR_QUERY_LIMIT, includeTotalRows: false,
    });
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await client.query('DELETE FROM report_run_rows WHERE run_id=$1', [run.id]);
    const snapshot = await persistTabularReportSnapshot(
      client,
      run.id,
      query,
      TABULAR_SNAPSHOT_BATCH_SIZE,
      async progress => {
        await pool.query(
          `UPDATE report_run_runtime
              SET progress_rows=$2,progress_batches=$3,heartbeat_at=NOW()
            WHERE report_run_id=$1`,
          [run.id, progress.rowCount, progress.batchCount],
        );
      },
    );
    const firstPageStarted = performance.now();
    await client.query(
      `SELECT row_number FROM report_run_rows WHERE run_id=$1 AND row_number BETWEEN 1 AND 10 ORDER BY row_number`,
      [run.id],
    );
    const metrics = {
      ...snapshot.metrics,
      firstPageReadMs: elapsedMs(firstPageStarted),
      totalGenerationMs: elapsedMs(generationStarted),
    };
    await client.query(
      `UPDATE report_runs
          SET status='completed',row_count=$2,progress_rows=$2,progress_batches=$3,
              generation_metrics=$4::jsonb,generated_at=NOW(),completed_at=NOW(),heartbeat_at=NOW()
        WHERE id=$1`,
      [run.id, snapshot.rowCount, snapshot.metrics.batchCount, JSON.stringify(metrics)],
    );
    await client.query('COMMIT');
    await pool.query('DELETE FROM report_run_runtime WHERE report_run_id=$1', [run.id]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await pool.query(
      `UPDATE report_runs SET status='failed',failed_at=NOW(),heartbeat_at=NOW(),failure_message=$2 WHERE id=$1`,
      [run.id, String((error as Error)?.message ?? error).slice(0, 1000)],
    );
    await pool.query('DELETE FROM report_run_runtime WHERE report_run_id=$1', [run.id]).catch(() => undefined);
    console.error(`[tabularReportWorker] run=${run.id} failed`, error);
  }
}

export async function runTabularReportWorkerOnce(): Promise<boolean> {
  const client = await pool.connect();
  let slot: number | null = null;
  try {
    slot = await acquireSlot(client);
    if (slot == null) return false;
    const run = await claimNextRun(client);
    if (!run) return false;
    await processClaimedRun(client, run);
    return true;
  } finally {
    if (slot != null) await client.query('SELECT pg_advisory_unlock($1,$2)', [ADVISORY_LOCK_NAMESPACE, slot]).catch(() => undefined);
    client.release();
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await pool.query(
      `UPDATE report_runs run
          SET status='failed',failed_at=NOW(),failure_message='توقف عامل التوليد قبل اكتمال التقرير'
         FROM report_run_runtime runtime
        WHERE run.id=runtime.report_run_id AND run.status='running'
          AND runtime.heartbeat_at < NOW()-INTERVAL '15 minutes' AND run.attempt_count >= 3`,
    );
    await pool.query(
      `UPDATE report_runs run
          SET status='queued',started_at=NULL,heartbeat_at=NULL
         FROM report_run_runtime runtime
        WHERE run.id=runtime.report_run_id AND run.status='running'
          AND runtime.heartbeat_at < NOW()-INTERVAL '15 minutes' AND run.attempt_count < 3`,
    );
    await pool.query(
      `DELETE FROM report_run_runtime runtime
        USING report_runs run
        WHERE runtime.report_run_id=run.id AND run.status<>'running'`,
    );
    await Promise.all(Array.from({ length: MAX_CONCURRENT_REPORTS }, () => runTabularReportWorkerOnce()));
  } catch (error) {
    console.error('[tabularReportWorker] tick failed', error);
  } finally { ticking = false; }
}

export function startTabularReportWorker(): void {
  if (timer) return;
  void tick();
  timer = setInterval(tick, WORKER_INTERVAL_MS);
  timer.unref?.();
  console.log(`[tabularReportWorker] started (concurrency=${MAX_CONCURRENT_REPORTS})`);
}

export function stopTabularReportWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
