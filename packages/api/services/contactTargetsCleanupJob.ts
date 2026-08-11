// Daily planning-cycle finalization.
// The timer and manual endpoint intentionally call the same transactional
// service so contact targets, task lists, bridge links and assigned tasks can
// never be closed by divergent workflows.

import { getSystemSettingTime } from './systemSettings.js';
import { closeExpiredPlanningDayCycles } from './planningDayCycle.js';

let timer: NodeJS.Timeout | null = null;
let lastRunDate: string | null = null;
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
 * Close complete planning cycles. At the configured end-of-day minute the
 * current planning day is included; boot catch-up only closes older days.
 */
export async function runContactTargetsCleanupOnce(
  includeCurrentDate = false,
): Promise<{ closed: number; cyclesClosed: number }> {
  const result = await closeExpiredPlanningDayCycles(includeCurrentDate);
  return {
    closed: result.contactTargetsClosed,
    cyclesClosed: result.cyclesClosed,
  };
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cleanupTime = await getSystemSettingTime('contact_target_cleanup_time', '22:00');
    const wantHhMm = cleanupTime.slice(0, 5);
    const nowHhMm = currentHhMm();
    const today = todayLocal();

    if (nowHhMm === wantHhMm && lastRunDate !== today) {
      const result = await runContactTargetsCleanupOnce(true);
      lastRunDate = today;
      console.log(
        `[contactTargetsCleanupJob] closed ${result.cyclesClosed} planning cycles / ${result.closed} contact targets at ${nowHhMm}`,
      );
    }
  } catch (err) {
    // Do not mark the date successful: the next process/tick may retry safely.
    console.error('[contactTargetsCleanupJob] tick failed', err);
  } finally {
    running = false;
  }
}

export function startContactTargetsCleanupJob(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, 60_000);
  console.log('[contactTargetsCleanupJob] started (60s tick)');

  void (async () => {
    try {
      const result = await runContactTargetsCleanupOnce(false);
      if (result.cyclesClosed > 0) {
        console.log(
          `[contactTargetsCleanupJob] boot catch-up closed ${result.cyclesClosed} planning cycles / ${result.closed} contact targets`,
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
