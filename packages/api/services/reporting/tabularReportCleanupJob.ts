import type { Pool } from 'pg';
import pool from '../../db.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const CLEANUP_BATCH_SIZE = 10;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function cleanupExpiredTabularReportRuns(
  limit = CLEANUP_BATCH_SIZE,
  db: Pick<Pool, 'query'> = pool,
): Promise<number> {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : CLEANUP_BATCH_SIZE;
  const { rowCount } = await db.query(
    `WITH expired AS (
       SELECT id FROM report_runs
        WHERE expires_at <= NOW()
          AND is_pinned IS FALSE
          AND status IN ('completed','failed')
        ORDER BY expires_at,id
        LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM report_runs run USING expired WHERE run.id=expired.id`,
    [safeLimit],
  );
  return rowCount ?? 0;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const deleted = await cleanupExpiredTabularReportRuns();
    if (deleted > 0) console.log(`[tabularReportCleanup] deleted=${deleted}`);
  } catch (error) {
    console.error('[tabularReportCleanup] tick failed', error);
  } finally { running = false; }
}

export function startTabularReportCleanupJob(): void {
  if (timer) return;
  void tick();
  timer = setInterval(tick, CLEANUP_INTERVAL_MS);
  timer.unref?.();
  console.log('[tabularReportCleanup] started (hourly, batch=10)');
}

export function stopTabularReportCleanupJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
