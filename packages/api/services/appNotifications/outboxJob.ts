// ============================================================
// services/appNotifications/outboxJob.ts
// ============================================================
// The runner that keeps the outbox drained (DEC-019 D-N15).
//
// Same shape as the other boot jobs (contactTargetsCleanupJob, vacancyExpiryJob):
// a single interval with a re-entrancy guard, started after the HTTP listener is
// up so a failing drain can never stop the server from booting.
//
// Polling, not LISTEN/NOTIFY: the delay this adds is bounded by the interval and
// notifications are not a real-time channel. A NOTIFY signal is the obvious
// upgrade if the wait ever matters, and it would not change the consumer.
// ============================================================

import { NOTIF_OUTBOX_INTERVAL_S, NOTIF_OUTBOX_BATCH } from '../../config/env.js';
import { drainOutbox } from './outboxConsumer.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  // A slow drain must not overlap itself: two concurrent drains would still be
  // correct (SKIP LOCKED), but they would multiply DB connections for no gain.
  if (running) return;
  running = true;
  try {
    const summary = await drainOutbox(NOTIF_OUTBOX_BATCH);
    if (summary.processed > 0 || summary.failed > 0) {
      console.log(
        `[outboxJob] processed=${summary.processed} notified=${summary.notified} ` +
        `skipped=${summary.skipped} failed=${summary.failed}`,
      );
    }
  } catch (err) {
    // Never rethrow from a timer: an unhandled rejection here would take the
    // process down and stop every other job with it.
    console.error('[outboxJob] tick failed', err);
  } finally {
    running = false;
  }
}

export function startNotificationOutboxJob(): void {
  if (timer) return;
  if (NOTIF_OUTBOX_INTERVAL_S <= 0) {
    console.warn('[outboxJob] disabled (NOTIF_OUTBOX_INTERVAL_S<=0) — notifications will not be delivered');
    return;
  }
  // Drain once at boot: anything captured while the process was down is still
  // waiting, and a restart is exactly when a backlog exists.
  void tick();
  timer = setInterval(tick, NOTIF_OUTBOX_INTERVAL_S * 1000);
  timer.unref?.();
  console.log(`[outboxJob] started (every ${NOTIF_OUTBOX_INTERVAL_S}s, batch ${NOTIF_OUTBOX_BATCH})`);
}

/** Visible for tests. */
export function stopNotificationOutboxJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
