// ============================================================
// contactTargetsCleanupJob.ts — Daily auto-close stale contact_targets
// ============================================================
// Constitution source:
//   DEC-005 D26 — "CRON الأمان يعمل يومياً في وقت قابل للضبط"
//   DEC-004 D10 — open_tasks return to last_waiting_status when their CT closes
//
// Mechanism:
//   - Runs a setInterval that ticks every minute.
//   - Each tick reads system_settings.contact_target_cleanup_time (default
//     "22:00") and compares to the local server hour:minute.
//   - When it matches, runs the cleanup once and records the date in
//     `lastRunDate` so it does not run twice on the same day if the server
//     happens to wake on the boundary minute repeatedly.
//
// This is staging-grade scheduling — sufficient for a single-instance API.
// A production deployment with multiple replicas should switch to an
// external scheduler hitting a dedicated /api/jobs/* endpoint.
// ============================================================

import pool from '../db.js';
import { getSystemSettingTime } from './systemSettings.js';

let timer: NodeJS.Timeout | null = null;
let lastRunDate: string | null = null; // YYYY-MM-DD of last successful run
let running = false;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentHhMm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Auto-close all contact_targets where status != 'closed' AND date < today.
 * Returns the affected row count.
 *
 * Exported for tests + the manual admin trigger endpoint.
 */
export async function runContactTargetsCleanupOnce(): Promise<{ closed: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find the targets we are about to close so we can also release
    //    their open_tasks back to last_waiting_status (DEC-004 D10).
    const { rows: staleRows } = await client.query<{ id: number }>(
      `SELECT id
         FROM contact_targets
        WHERE status != 'closed'
          AND date < CURRENT_DATE`,
    );

    if (staleRows.length === 0) {
      await client.query('COMMIT');
      return { closed: 0 };
    }
    const staleIds = staleRows.map((r) => r.id);

    // 2. Close them in one shot with closing_reason = auto_closed_by_cron.
    await client.query(
      `UPDATE contact_targets
          SET status         = 'closed',
              closing_reason = 'auto_closed_by_cron',
              closed_at      = NOW(),
              updated_at     = NOW()
        WHERE id = ANY($1::bigint[])`,
      [staleIds],
    );

    // 3. Release open_tasks tied to these targets — strictly through the
    //    contact_target_open_tasks bridge (DEC-009 لبنة 6), NOT a broad
    //    client_id match. The old `ot.client_id = ct.target_id` join released
    //    EVERY waiting task of the same customer, even those belonging to a
    //    different contact_target (other work location). Going through the
    //    junction releases only the tasks actually linked to the closing target.
    //    DEC-004 D10: tasks fall back to their last_waiting_status (NULL-safe).
    //    Also clears the rest of the assignment metadata to match the canonical
    //    release path in syncAssignedTasks (assignedTasks.ts §Step 8).
    await client.query(
      `UPDATE open_tasks ot
          SET status            = COALESCE(NULLIF(ot.last_waiting_status, ''), 'open'),
              assigned_team_key = NULL,
              assigned_for_date = NULL,
              assigned_at       = NULL,
              assigned_scope_id = NULL,
              updated_at        = NOW()
        FROM contact_target_open_tasks ctot
        WHERE ctot.contact_target_id = ANY($1::bigint[])
          AND ot.id = ctot.open_task_id
          AND ot.status IN ('assigned', 'in_scheduling')`,
      [staleIds],
    );

    await client.query('COMMIT');
    return { closed: staleIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cleanupTime = await getSystemSettingTime('contact_target_cleanup_time', '22:00');
    // Normalise to HH:MM (we store "22:00:00" or "22:00")
    const wantHhMm = cleanupTime.slice(0, 5);
    const nowHhMm = currentHhMm();
    const today = todayLocal();

    if (nowHhMm === wantHhMm && lastRunDate !== today) {
      lastRunDate = today;
      const result = await runContactTargetsCleanupOnce();
      console.log(
        `[contactTargetsCleanupJob] closed ${result.closed} stale contact_targets at ${nowHhMm}`,
      );
    }
  } catch (err) {
    console.error('[contactTargetsCleanupJob] tick failed', err);
  } finally {
    running = false;
  }
}

export function startContactTargetsCleanupJob(): void {
  if (timer) return; // already started
  // Tick every 60 seconds — light enough, hits the configured minute exactly once.
  timer = setInterval(() => { void tick(); }, 60_000);
  console.log('[contactTargetsCleanupJob] started (60s tick)');

  // Boot catch-up: the scheduled tick only fires if the process is alive at the
  // exact configured minute. If the server was down at cleanup time (or runs
  // on-demand in dev), yesterday's stale targets stay open forever. Since
  // runContactTargetsCleanupOnce only closes past-day targets (date < today),
  // it is always safe to run immediately on boot, and idempotent (already-closed
  // targets are skipped by the status != 'closed' filter). We deliberately do
  // NOT set lastRunDate here, so the normal scheduled run still fires today.
  void (async () => {
    try {
      const result = await runContactTargetsCleanupOnce();
      if (result.closed > 0) {
        console.log(
          `[contactTargetsCleanupJob] boot catch-up closed ${result.closed} stale contact_targets`,
        );
      }
    } catch (err) {
      console.error('[contactTargetsCleanupJob] boot catch-up failed', err);
    }
  })();
}

export function stopContactTargetsCleanupJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
