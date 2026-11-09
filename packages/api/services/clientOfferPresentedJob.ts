// ============================================================
// services/clientOfferPresentedJob.ts
// ============================================================
// Keeps client_offer_presented (migration 492) true without a manual step.
// Triggers keep it current for every write the application makes; this job
// catches what they cannot see — data copied with triggers disabled (the
// migration team copies tasks and visits into production that way).
//
// Runs at boot, then once a day at 03:00 (a one-minute tick + lastRunDate, the
// shape of the notification sweep). The reconcile is set-based and idempotent
// (≈1 s on staging data), so running it late or twice changes nothing.
// ============================================================
import pool from '../db.js';

type Queryable = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

const DAILY_MINUTE = 3 * 60;

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunDate: string | null = null;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runClientOfferPresentedReconcileOnce(
  db: Queryable = pool,
): Promise<{ added: number; removed: number }> {
  const { rows } = await db.query('SELECT added, removed FROM public.reconcile_client_offer_presented()');
  return { added: Number(rows[0]?.added ?? 0), removed: Number(rows[0]?.removed ?? 0) };
}

async function run(reason: 'boot' | 'daily'): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runClientOfferPresentedReconcileOnce();
    if (result.added > 0 || result.removed > 0) {
      console.log(`[clientOfferPresentedJob] ${reason}: +${result.added} / -${result.removed} clients`);
    }
    if (reason === 'daily') lastRunDate = todayLocal();
  } catch (error) {
    // Not marking the day done: the next tick retries.
    console.error(`[clientOfferPresentedJob] ${reason} reconcile failed`, error);
  } finally {
    running = false;
  }
}

function tick(): void {
  const now = new Date();
  if (lastRunDate === todayLocal()) return;
  if (now.getHours() * 60 + now.getMinutes() < DAILY_MINUTE) return;
  void run('daily');
}

export function startClientOfferPresentedJob(): void {
  if (timer) return;
  void run('boot');
  timer = setInterval(tick, 60_000);
  timer.unref?.();
  console.log('[clientOfferPresentedJob] started (boot + daily at 03:00)');
}
