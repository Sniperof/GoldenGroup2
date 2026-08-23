// ============================================================
// services/appNotifications/pushDispatcher.ts
// ============================================================
// DEC-019 Phase 4 — takes what createNotifications() prepared and delivers it.
//
// Runs AFTER the caller's transaction has committed, so it deliberately does
// NOT accept the caller's client: that handle may already be released, and a
// push must never be sent for a row that could still roll back.
//
// It never throws. The contract is explicit (§12): "FCM dispatch failure — do
// not fail the request". The row is the source of truth; a push that did not
// land only means the customer sees it when they next open the app.
// ============================================================

import pool from '../../db.js';
import type { PreparedPush, Queryable } from './notificationService.js';
import { getPushSender, maskToken, type PushSender } from './pushSender.js';

export interface DispatchSummary {
  /** Notifications that had at least one device to send to. */
  attempted: number;
  sent: number;
  failed: number;
  /** Dead registrations removed as a result of this run. */
  purgedTokens: number;
}

export interface DispatchOptions {
  db?: Queryable;
  sender?: PushSender;
}

export async function dispatchPreparedPushes(
  prepared: PreparedPush[],
  options: DispatchOptions = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { attempted: 0, sent: 0, failed: 0, purgedTokens: 0 };
  if (prepared.length === 0) return summary;

  const db = options.db ?? (pool as unknown as Queryable);
  let sender: PushSender;
  try {
    sender = options.sender ?? getPushSender();
  } catch (err) {
    // A misconfigured provider is a deployment fault, not a request fault.
    console.error('[push:dispatch] no_sender', err);
    return summary;
  }

  for (const push of prepared) {
    // No registered device is not a failure: the notification is waiting in the
    // inbox, which is where it is authoritative anyway. Leaving sent_at NULL
    // keeps "was a push actually sent" answerable later.
    if (push.tokens.length === 0) continue;
    summary.attempted += 1;

    try {
      const result = await sender.send({
        tokens: push.tokens,
        title: push.title,
        body: push.body,
        data: push.data,
      });
      summary.sent += result.sent;
      summary.failed += result.failed;

      if (result.sent > 0) {
        await db.query(
          'UPDATE app_notifications SET sent_at = NOW() WHERE id = $1 AND sent_at IS NULL',
          [push.notificationId],
        );
      }

      if (result.invalidTokens.length > 0) {
        // Delete by token, not by (account, device): the same dead token can
        // sit under more than one row after a handset changed hands.
        const { rowCount } = await db.query(
          'DELETE FROM app_notification_registrations WHERE fcm_token = ANY($1::text[])',
          [result.invalidTokens],
        );
        summary.purgedTokens += rowCount ?? 0;
        console.warn(
          `[push:dispatch] purged ${rowCount ?? 0} dead registration(s): ` +
          result.invalidTokens.map(maskToken).join(', '),
        );
      }
    } catch (err) {
      // Swallow per notification so one bad recipient cannot stop the rest of a
      // sweep from being delivered.
      summary.failed += push.tokens.length;
      console.error(`[push:dispatch] failed notification_id=${push.notificationId}`, err);
    }
  }
  return summary;
}
