// ============================================================
// services/appNotifications/notificationService.ts
// ============================================================
// DEC-019 Phase 3 — the one place a notification is born.
//
// Builds the persisted row AND the push message from a SINGLE data map, which
// is the contract's central rule: a tap must navigate identically whether it
// came from the inbox or from the push (§E.2 / §K step 3).
//
// It does NOT send. The caller runs this inside its own transaction and
// dispatches the returned payloads AFTER commit — a push for a row that then
// rolled back is unrecallable, while a row whose push failed is merely unseen
// until the customer opens the app. Dispatch itself lands in Phase 4.
// ============================================================

import pool from '../../db.js';
import {
  NOTIFICATION_CATALOG,
  buildNotificationText,
  isNotificationLocale,
  type NotificationDestination,
  type NotificationLocale,
  type NotificationType,
  type NotificationVars,
} from './notificationCatalog.js';

/** Minimal shape shared by Pool and PoolClient, so callers can pass either. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface CreateNotificationInput<T extends NotificationType> {
  type: T;
  /**
   * Household recipient: resolved to EVERY active account linked to the client
   * (D-N12), because devices, visits and warranties belong to the household.
   * Exactly one of clientId / appAccountId must be given.
   */
  clientId?: number;
  /**
   * Personal recipient: exactly this account and no other (D-N16).
   *
   * Used for things that are one person's business rather than the household's —
   * a complaint someone filed is the standing example. Fanning that out to every
   * account on the client would show it to a relative who shares the customer
   * record, which is a disclosure, not a courtesy.
   */
  appAccountId?: number;
  vars: NotificationVars[T];
  /** Entity id the app should open. Always serialized as a string (§E). */
  destinationId?: string | number | null;
  /** Free-form sends choose their own target; other types inherit the catalog's. */
  destination?: NotificationDestination | null;
  /** Dedup coordinates — required for the scheduled family (D-N4). */
  entityId?: number | null;
  windowKey?: string | null;
  /** Merged into `data` verbatim; the app preserves unknown keys (§E). */
  extraData?: Record<string, string>;
  /** Admin free-form sends only. */
  createdByUserId?: number | null;
  /** Join the caller's transaction; defaults to the pool. */
  db?: Queryable;
}

/** A row that was actually inserted, plus the push built from the same data. */
export interface PreparedPush {
  notificationId: string;
  appAccountId: number;
  locale: NotificationLocale;
  tokens: string[];
  title: string;
  body: string;
  /** FCM data values must all be strings — see buildPushData below. */
  data: Record<string, string>;
}

interface RecipientRow {
  app_account_id: string;
  locale: string | null;
  tokens: string[] | null;
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

/**
 * Per-type kill switch (D-N5). Read through the caller's handle rather than the
 * cached systemSettings module so the read joins the caller's transaction and
 * stays mockable — the same convention accountDuplicatePolicy follows.
 *
 * A sweep creating hundreds of rows should hoist this check out of its loop
 * (once per type per run) instead of paying it per recipient.
 */
export async function isNotificationTypeEnabled(db: Queryable, type: NotificationType): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [`notif_${type}_enabled`],
  );
  // Unset means enabled: a type that has never been touched in the admin UI is
  // on, otherwise every new type would ship silently dead.
  if (rows.length === 0 || rows[0].value == null) return true;
  return TRUE_VALUES.has(String(rows[0].value).trim().toLowerCase());
}

/**
 * Reads a system setting through the caller's handle.
 *
 * The cached getters in services/systemSettings.ts go straight to the module
 * pool, which makes any code path that uses them untestable without a live
 * database — and silently ignores an injected transaction. Sweeps and consumers
 * read one setting per pass, so the 60-second cache buys nothing here anyway.
 */
export async function readSettingString(
  db: Queryable,
  key: string,
  fallback: string,
): Promise<string> {
  const { rows } = await db.query('SELECT value FROM system_settings WHERE key = $1 LIMIT 1', [key]);
  const raw = rows[0]?.value;
  return raw == null || String(raw).trim() === '' ? fallback : String(raw);
}

export async function readSettingNumber(
  db: Queryable,
  key: string,
  fallback: number,
): Promise<number> {
  const raw = await readSettingString(db, key, String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Every active account linked to the client, each with the language of its
 * newest registration and all of its live push tokens.
 *
 * Suspended and soft-deleted accounts are excluded at the source (D-N12): a
 * suspended account cannot log in, so a row in its inbox is unreachable noise.
 */
async function loadRecipients(
  db: Queryable,
  target: { clientId?: number; appAccountId?: number },
): Promise<RecipientRow[]> {
  // One query, two selectors: keying on the account id narrows the same lookup
  // to a single inbox instead of the household, so locale and token resolution
  // stay identical either way.
  const byAccount = target.appAccountId != null;
  const { rows } = await db.query(
    `SELECT a.id AS app_account_id,
            newest.locale,
            COALESCE(toks.tokens, ARRAY[]::text[]) AS tokens
       FROM app_accounts a
       LEFT JOIN LATERAL (
         SELECT r.locale
           FROM app_notification_registrations r
          WHERE r.app_account_id = a.id AND r.locale IS NOT NULL
          ORDER BY r.updated_at DESC, r.id DESC
          LIMIT 1
       ) newest ON TRUE
       LEFT JOIN LATERAL (
         SELECT array_agg(r.fcm_token) AS tokens
           FROM app_notification_registrations r
          WHERE r.app_account_id = a.id
       ) toks ON TRUE
      WHERE ${byAccount ? 'a.id = $1' : 'a.linked_client_record_id = $1'}
        AND a.status = 'active'
        AND a.deleted_at IS NULL`,
    [byAccount ? target.appAccountId : target.clientId],
  );
  return rows as RecipientRow[];
}

/**
 * The stored payload. `type` is duplicated here on purpose: the app reads the
 * type from `data`, never from a top-level field (§C.5), and the DB check
 * constraint keeps this copy and the column in agreement.
 */
function buildData(
  type: NotificationType,
  destination: NotificationDestination | null,
  destinationId: string | null,
  extraData: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...(extraData ?? {}),
    type,
    ...(destination ? { destination } : {}),
    ...(destination && destinationId ? { destination_id: destinationId } : {}),
  };
}

export async function createNotifications<T extends NotificationType>(
  input: CreateNotificationInput<T>,
): Promise<PreparedPush[]> {
  const db = input.db ?? (pool as unknown as Queryable);
  const entry = NOTIFICATION_CATALOG[input.type];

  // The first thing asked for when a notification annoys customers is silencing
  // that one type without shipping a release.
  if (!(await isNotificationTypeEnabled(db, input.type))) return [];

  // A deduped type without its coordinates would insert on every sweep run,
  // because the unique index is partial on window_key. Fail loudly here rather
  // than notify a customer daily forever.
  if (entry.deduped && (input.windowKey == null || input.entityId == null)) {
    throw new Error(`notification type ${input.type} requires entityId + windowKey`);
  }

  if ((input.clientId == null) === (input.appAccountId == null)) {
    throw new Error('createNotifications requires exactly one of clientId or appAccountId');
  }

  const destination = input.destination !== undefined ? input.destination : entry.destination;
  const destinationId = input.destinationId == null ? null : String(input.destinationId);
  const recipients = await loadRecipients(db, {
    clientId: input.clientId,
    appAccountId: input.appAccountId,
  });

  // Most customers have no app account at all (D-N8): nothing to do, and not an
  // error — the event itself was perfectly valid.
  if (recipients.length === 0) return [];

  const prepared: PreparedPush[] = [];
  for (const recipient of recipients) {
    const locale: NotificationLocale = isNotificationLocale(recipient.locale) ? recipient.locale : 'ar';
    const { title, message } = buildNotificationText(input.type, locale, input.vars);
    const data = buildData(input.type, destination, destinationId, input.extraData);

    const { rows } = await db.query(
      `INSERT INTO app_notifications
         (app_account_id, type, title, message, locale, data, entity_id, window_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (app_account_id, type, entity_id, window_key)
         WHERE window_key IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        recipient.app_account_id,
        input.type,
        title,
        message,
        locale,
        JSON.stringify(data),
        input.entityId ?? null,
        input.windowKey ?? null,
        input.createdByUserId ?? null,
      ],
    );

    // No row means the dedup index caught a repeat of an already-sent window.
    // Skipping the push too is the whole point: the row existing IS the record
    // that this customer was already told.
    if (rows.length === 0) continue;

    prepared.push({
      notificationId: String(rows[0].id),
      appAccountId: Number(recipient.app_account_id),
      locale,
      tokens: recipient.tokens ?? [],
      title,
      body: message,
      // notification_id is what lets a tap mark the right row as read (§I.1.2);
      // it exists only after the insert, so it joins here rather than in `data`.
      data: { ...data, notification_id: String(rows[0].id) },
    });
  }
  return prepared;
}
