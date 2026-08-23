// ============================================================
// services/appNotifications/fcmPushSender.ts
// ============================================================
// PushSender adapter for Firebase Cloud Messaging, HTTP v1. Selected via
// PUSH_PROVIDER=fcm.
//
// Written against the REST API directly rather than pulling in firebase-admin:
// the whole surface we need is one OAuth2 token exchange plus one POST per
// token, and `jsonwebtoken` is already a dependency. Same call as the Rasel
// adapter, which is also hand-written fetch.
//
// Never logs: the private key, the OAuth access token, or a full FCM
// registration token (a token is a credential for reaching someone's handset).
// ============================================================

import jwt from 'jsonwebtoken';
import {
  FCM_CLIENT_EMAIL,
  FCM_KILL_SWITCH,
  FCM_PRIVATE_KEY,
  FCM_PROJECT_ID,
  FCM_TIMEOUT_MS,
} from '../../config/env.js';
import { maskToken, type PushMessage, type PushSendResult, type PushSender } from './pushSender.js';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Renew a little early so a request never races the expiry it just checked. */
const TOKEN_SKEW_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * FCM error codes that mean "this token is dead, stop using it" as opposed to
 * "try again later" (DEC-019 D-N14).
 *
 * UNREGISTERED  — the app was uninstalled, or the token was replaced.
 * INVALID_ARGUMENT — malformed token; it will never become valid.
 */
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);

export class FcmPushSender implements PushSender {
  readonly name = 'fcm';

  private token: CachedToken | null = null;

  /**
   * Service-account JWT → short-lived OAuth2 access token. Cached until just
   * before expiry; one exchange serves every push in the following hour, which
   * matters for a CRON sweep sending hundreds in a burst.
   */
  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + TOKEN_SKEW_MS) {
      return this.token.accessToken;
    }
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: FCM_CLIENT_EMAIL,
        scope: FCM_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      FCM_PRIVATE_KEY,
      { algorithm: 'RS256' },
    );

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body can echo request details; keep it out of the thrown message.
      throw new Error(`FCM OAuth exchange failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM OAuth exchange returned no access_token');

    this.token = {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.accessToken;
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    const result: PushSendResult = { provider: this.name, sent: 0, failed: 0, invalidTokens: [] };
    if (message.tokens.length === 0) return result;

    if (FCM_KILL_SWITCH) {
      console.warn(`[push:fcm] kill_switch_active devices=${message.tokens.length}`);
      return { ...result, failed: message.tokens.length };
    }

    let accessToken: string;
    try {
      accessToken = await this.getAccessToken();
    } catch (err) {
      // Auth failure is per-send, never per-token: nothing was delivered, but
      // nothing is proven dead either.
      console.error('[push:fcm] auth_failed', err);
      return { ...result, failed: message.tokens.length };
    }

    const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
    for (const token of message.tokens) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              // The `notification` block is required, not optional (§I.1.1): a
              // data-only message shows nothing at all in background/terminated
              // state, where most notifications are actually received.
              notification: { title: message.title, body: message.body },
              data: message.data,
              // Without high priority Android may defer the message in Doze,
              // which turns a "your technician arrives today" alert into
              // tomorrow's news.
              android: { priority: 'HIGH' },
              apns: { headers: { 'apns-priority': '10' } },
            },
          }),
          signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
        });

        if (res.ok) {
          result.sent += 1;
          continue;
        }

        result.failed += 1;
        const body = (await res.json().catch(() => null)) as
          | { error?: { status?: string; details?: { errorCode?: string }[] } }
          | null;
        const code = body?.error?.details?.find((d) => d?.errorCode)?.errorCode
          ?? body?.error?.status
          ?? '';
        if (DEAD_TOKEN_CODES.has(code)) {
          result.invalidTokens.push(token);
        }
        console.warn(`[push:fcm] send_failed status=${res.status} code=${code || '-'} token=${maskToken(token)}`);
      } catch (err) {
        // Network/timeout: transient by assumption, so the token survives.
        result.failed += 1;
        console.error(`[push:fcm] send_error token=${maskToken(token)}`, err);
      }
    }
    return result;
  }
}
