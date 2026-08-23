// ============================================================
// services/appNotifications/timeSweepJob.ts
// ============================================================
// Runs the time-based sweep once a day at the configured minute, with boot
// catch-up (DEC-019 D-N4 / D-N5).
//
// Same shape as contactTargetsCleanupJob: a one-minute tick, a `running` guard,
// and a `lastRunDate` so the run happens once per calendar day even though the
// timer fires 1440 times.
//
// Catch-up is deliberately simple. Because every type in the sweep carries dedup
// coordinates, running it late — or twice — cannot duplicate anything, so there
// is no need to reason about what was already sent. The only thing bounded is
// how late is still worth doing at all: past the catch-up window the day is
// written off rather than announced retroactively.
// ============================================================

import { getSystemSettingNumber, getSystemSettingTime } from '../systemSettings.js';
import { runNotificationSweep } from './timeSweep.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunDate: string | null = null;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minutesSinceMidnight(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function parseHhMm(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 8) * 60 + (Number.isFinite(m) ? m : 0);
}

export async function runNotificationSweepOnce(): Promise<void> {
  const summary = await runNotificationSweep();
  const total = summary.visitReminders + summary.maintenanceDue + summary.warrantyExpiring;
  if (total > 0 || summary.skipped > 0) {
    console.log(
      `[notifSweepJob] visits=${summary.visitReminders} maintenance=${summary.maintenanceDue} `
      + `warranty=${summary.warrantyExpiring} skipped=${summary.skipped}`,
    );
  }
  lastRunDate = todayLocal();
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const today = todayLocal();
    if (lastRunDate === today) return;

    const dueMinute = parseHhMm(await getSystemSettingTime('notif_visit_reminder_time', '08:00'));
    const now = minutesSinceMidnight();
    if (now < dueMinute) return;

    // How late a missed run may still go out. Beyond it the day is skipped: a
    // "your visit is today" that lands at 23:50 is an annoyance, not a service.
    const windowMinutes = (await getSystemSettingNumber('notif_catchup_window_hours', 12)) * 60;
    if (now - dueMinute > windowMinutes) {
      // Claim the day so this does not re-evaluate every minute until midnight.
      lastRunDate = today;
      console.warn(
        `[notifSweepJob] skipped ${today}: ${now - dueMinute} minutes past the due time, `
        + `outside the ${windowMinutes}-minute catch-up window`,
      );
      return;
    }

    await runNotificationSweepOnce();
  } catch (err) {
    // Do NOT mark the day done: the next tick retries, and the dedup index makes
    // a partially-completed sweep safe to repeat.
    console.error('[notifSweepJob] tick failed', err);
  } finally {
    running = false;
  }
}

export function startNotificationSweepJob(): void {
  if (timer) return;
  // First tick immediately: a restart mid-morning is exactly when the day's
  // sweep may still be owed.
  void tick();
  timer = setInterval(tick, 60_000);
  timer.unref?.();
  console.log('[notifSweepJob] started (checks every minute, runs once per day)');
}

/** Visible for tests. */
export function stopNotificationSweepJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastRunDate = null;
}
