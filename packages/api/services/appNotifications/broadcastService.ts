// ============================================================
// services/appNotifications/broadcastService.ts
// ============================================================
// DEC-019 Phase 7 — the admin free-form send (D-N6 / D-N7).
//
// Unlike every other notification in this layer, a broadcast has no triggering
// event and no per-recipient text: one operator writes one sentence and it goes
// to everyone the filter matches. Two consequences shape this file.
//
// 1. The rows are written SET-BASED (INSERT ... SELECT) instead of one call to
//    createNotifications per account. There is nothing to compute per recipient
//    — the language is the operator's choice, not the handset's (D-N13 picks a
//    locale per device only because system text exists in both) — so looping
//    would buy nothing and cost a round trip per customer.
//
// 2. Delivery is batched. The push fan-out is bounded per pass so one send
//    cannot hold a connection, or the event loop, for thousands of HTTP calls.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../../db.js';
import { dispatchPreparedPushes } from './pushDispatcher.js';
import {
  isNotificationTypeEnabled,
  type PreparedPush,
  type Queryable,
} from './notificationService.js';
import type { NotificationDestination, NotificationLocale } from './notificationCatalog.js';

/** How many recipients are pushed per pass. */
export const PUSH_BATCH_SIZE = 200;

export interface BroadcastAudience {
  /** Restrict to one branch. Required for non-GLOBAL operators (enforced by the route). */
  branchId?: number | null;
  /**
   * Geo subtree of the deepest selected level, exactly as the existing
   * GeoCascadeFilter already sends it for clients (محافظة→منطقة→ناحية→حي).
   * A client matches when ANY of its geo columns falls inside the subtree.
   */
  geoIds?: string[];
  /** A single customer, for one-off support messages. */
  clientId?: number | null;
  /**
   * Hard ceiling on reachable branches, set by the route from the operator's
   * grant — never from the request body. Null means GLOBAL (no ceiling).
   *
   * Separate from `branchId` on purpose: that one is the operator NARROWING
   * their audience, this one is the system BOUNDING it. A branch operator can
   * cover more than one branch, so the ceiling is a list rather than a value.
   */
  allowedBranchIds?: number[] | null;
}

export interface BroadcastInput {
  title: string;
  message: string;
  locale: NotificationLocale;
  destination?: NotificationDestination | null;
  destinationId?: string | null;
  audience: BroadcastAudience;
  sentByUserId: number;
  previewedCount?: number | null;
}

interface AudienceSql {
  where: string;
  params: unknown[];
}

/**
 * Builds the recipient predicate shared by the preview and the send.
 *
 * They MUST come from one place: a preview that counts differently from what
 * the send writes is worse than no preview at all, because the operator
 * confirms against a number that was never true.
 */
function buildAudienceSql(audience: BroadcastAudience, startIndex = 1): AudienceSql {
  const params: unknown[] = [];
  const conditions: string[] = [
    "a.status = 'active'",
    'a.deleted_at IS NULL',
    'c.deleted_at IS NULL',
  ];
  let i = startIndex;

  if (audience.branchId != null) {
    params.push(audience.branchId);
    conditions.push(`c.branch_id = $${i++}`);
  }
  const geoIds = (audience.geoIds ?? []).filter((id) => /^\d+$/.test(id));
  if (geoIds.length > 0) {
    params.push(geoIds);
    const ref = `$${i++}::text[]`;
    conditions.push(
      `(c.governorate::text = ANY(${ref}) OR c.district::text = ANY(${ref}) OR c.neighborhood::text = ANY(${ref}))`,
    );
  }
  if (audience.clientId != null) {
    params.push(audience.clientId);
    conditions.push(`c.id = $${i++}`);
  }
  // Applied in ADDITION to any chosen branch, so a narrowing can never widen.
  if (audience.allowedBranchIds != null) {
    params.push(audience.allowedBranchIds);
    conditions.push(`c.branch_id = ANY($${i++}::int[])`);
  }

  return { where: conditions.join(' AND '), params };
}

export interface AudiencePreview {
  /** App accounts that would receive a row in their inbox. */
  accounts: number;
  /** Distinct customers behind those accounts. */
  clients: number;
  /** Accounts with at least one registered device — the rest see it only in-app. */
  reachableByPush: number;
}

export async function previewAudience(
  audience: BroadcastAudience,
  db: Queryable = pool as unknown as Queryable,
): Promise<AudiencePreview> {
  const { where, params } = buildAudienceSql(audience);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int                              AS accounts,
            COUNT(DISTINCT c.id)::int                  AS clients,
            COUNT(*) FILTER (WHERE r.app_account_id IS NOT NULL)::int AS reachable
       FROM app_accounts a
       JOIN clients c ON c.id = a.linked_client_record_id
       LEFT JOIN LATERAL (
         SELECT 1 AS app_account_id
           FROM app_notification_registrations reg
          WHERE reg.app_account_id = a.id
          LIMIT 1
       ) r ON TRUE
      WHERE ${where}`,
    params,
  );
  const row = rows[0] ?? {};
  return {
    accounts: Number(row.accounts ?? 0),
    clients: Number(row.clients ?? 0),
    reachableByPush: Number(row.reachable ?? 0),
  };
}

export interface BroadcastResult {
  broadcastId: string;
  notificationCount: number;
  pushed: number;
}

/**
 * Writes the broadcast, its notification rows, and then delivers in batches.
 *
 * The rows and the audit record commit together — a send that is half-recorded
 * is exactly the situation the audit trail exists to prevent. Pushes go out
 * after that commit, in batches, and their failure never rolls anything back.
 */
export async function sendBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
  const client: PoolClient = await pool.connect();
  let broadcastId = '';
  let notificationCount = 0;
  try {
    if (!(await isNotificationTypeEnabled(client as unknown as Queryable, 'general'))) {
      throw Object.assign(new Error('الإشعارات الحرة موقوفة من الإعدادات'), { status: 409 });
    }

    await client.query('BEGIN');

    const { rows: created } = await client.query(
      `INSERT INTO app_notification_broadcasts
         (title, message, locale, destination, destination_id, audience,
          previewed_count, sent_by_user_id, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING id`,
      [
        input.title, input.message, input.locale,
        input.destination ?? null, input.destinationId ?? null,
        JSON.stringify(input.audience),
        input.previewedCount ?? null,
        input.sentByUserId,
        input.audience.branchId ?? null,
      ],
    );
    broadcastId = String(created[0].id);

    // `data` is composed exactly as createNotifications would, so a broadcast is
    // indistinguishable from a system notification on the wire — including the
    // type/data.type mirror the DB check constraint enforces.
    const data: Record<string, string> = {
      type: 'general',
      ...(input.destination ? { destination: input.destination } : {}),
      ...(input.destination && input.destinationId ? { destination_id: input.destinationId } : {}),
    };

    const { where, params } = buildAudienceSql(input.audience, 7);
    const { rows: inserted } = await client.query(
      `INSERT INTO app_notifications
         (app_account_id, type, title, message, locale, data, broadcast_id, created_by)
       SELECT a.id, 'general', $1, $2, $3, $4::jsonb, $5, $6
         FROM app_accounts a
         JOIN clients c ON c.id = a.linked_client_record_id
        WHERE ${where}
       RETURNING id, app_account_id`,
      [
        input.title, input.message, input.locale, JSON.stringify(data),
        broadcastId, input.sentByUserId,
        ...params,
      ],
    );
    notificationCount = inserted.length;

    await client.query(
      `UPDATE app_notification_broadcasts
          SET notification_count = $2, completed_at = NOW()
        WHERE id = $1`,
      [broadcastId, notificationCount],
    );
    await client.query('COMMIT');

    const pushed = await dispatchBroadcast(broadcastId, inserted, {
      title: input.title, body: input.message, data,
    });
    return { broadcastId, notificationCount, pushed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (broadcastId) {
      await pool.query(
        'UPDATE app_notification_broadcasts SET last_error = $2 WHERE id = $1',
        [broadcastId, String((err as Error)?.message ?? err).slice(0, 500)],
      ).catch(() => undefined);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Loads tokens and pushes in fixed-size batches.
 *
 * Tokens are fetched here rather than in the INSERT ... RETURNING above because
 * a recipient may own several devices: joining them into the insert would
 * multiply the returned rows and miscount the broadcast.
 */
async function dispatchBroadcast(
  broadcastId: string,
  recipients: { id: string; app_account_id: string }[],
  content: { title: string; body: string; data: Record<string, string> },
): Promise<number> {
  let pushed = 0;
  for (let offset = 0; offset < recipients.length; offset += PUSH_BATCH_SIZE) {
    const slice = recipients.slice(offset, offset + PUSH_BATCH_SIZE);
    const { rows: tokenRows } = await pool.query(
      `SELECT app_account_id, array_agg(fcm_token) AS tokens
         FROM app_notification_registrations
        WHERE app_account_id = ANY($1::bigint[])
        GROUP BY app_account_id`,
      [slice.map((r) => r.app_account_id)],
    );
    const tokensByAccount = new Map<string, string[]>(
      tokenRows.map((r: { app_account_id: string; tokens: string[] }) => [String(r.app_account_id), r.tokens]),
    );

    const prepared: PreparedPush[] = slice
      .map((r) => ({
        notificationId: String(r.id),
        appAccountId: Number(r.app_account_id),
        locale: 'ar' as NotificationLocale,
        tokens: tokensByAccount.get(String(r.app_account_id)) ?? [],
        title: content.title,
        body: content.body,
        data: { ...content.data, notification_id: String(r.id) },
      }))
      .filter((p) => p.tokens.length > 0);

    const summary = await dispatchPreparedPushes(prepared);
    pushed += summary.sent;
  }
  console.log(`[broadcast ${broadcastId}] delivered ${pushed} push(es) to ${recipients.length} inbox(es)`);
  return pushed;
}
