// ============================================================
// services/appNotifications/pushSender.ts
// ============================================================
// Port/Adapter for push delivery (DEC-019 D-N14) — the same shape as
// services/otp/otpSender.ts.
//
// Everything else about a notification (creation, storage, dedup, read state,
// the inbox API) is identical regardless of provider; only this step swaps:
//   - NoopPushSender (PUSH_PROVIDER=noop): logs, contacts nothing
//   - FcmPushSender  (PUSH_PROVIDER=fcm):  Firebase Cloud Messaging HTTP v1
// ============================================================

import { PUSH_PROVIDER } from '../../config/env.js';
import { FcmPushSender } from './fcmPushSender.js';

/**
 * One message aimed at one account's devices.
 *
 * `data` values are all strings because FCM rejects anything else in a data
 * payload — and because the mobile reads `destination_id` with `.toString()`
 * either way (§E).
 */
export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSendResult {
  provider: string;
  sent: number;
  failed: number;
  /**
   * Tokens the provider says will never work again (FCM UNREGISTERED /
   * INVALID_ARGUMENT). The caller deletes these rows — a dead token is not a
   * transient failure and retrying it forever is pure waste.
   */
  invalidTokens: string[];
}

export interface PushSender {
  readonly name: string;
  send(message: PushMessage): Promise<PushSendResult>;
}

/** Masks a token in logs — it is a credential for reaching someone's handset. */
export function maskToken(token: string): string {
  return token.length <= 10 ? '***' : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/** Dev/staging provider: does not contact any external service. */
export class NoopPushSender implements PushSender {
  readonly name = 'noop';

  async send(message: PushMessage): Promise<PushSendResult> {
    // Intentional log so the whole pipeline is verifiable end-to-end without a
    // Firebase key: what would have been sent, and to how many devices.
    console.log(
      `[push:noop] devices=${message.tokens.length} title=${JSON.stringify(message.title)} ` +
      `type=${message.data.type ?? '-'} notification_id=${message.data.notification_id ?? '-'}`,
    );
    return { provider: this.name, sent: message.tokens.length, failed: 0, invalidTokens: [] };
  }
}

let cached: PushSender | null = null;

/**
 * Returns the configured push sender.
 *
 * FAIL-CLOSED: no `default` branch, for the same reason getOtpSender has none.
 * A typo in the deployment env must not silently resolve to the no-op provider,
 * which boots cleanly, accepts every send, and delivers nothing — indistinguish-
 * able from a healthy server until a customer complains they get no alerts.
 */
export function getPushSender(): PushSender {
  if (cached) return cached;
  switch (PUSH_PROVIDER) {
    case 'fcm':
      cached = new FcmPushSender();
      break;
    case 'noop':
      cached = new NoopPushSender();
      break;
    default:
      throw new Error(`No push sender adapter is installed for PUSH_PROVIDER="${PUSH_PROVIDER}".`);
  }
  return cached;
}

/** Visible for tests: drop the memoised adapter. */
export function resetPushSender(): void {
  cached = null;
}
