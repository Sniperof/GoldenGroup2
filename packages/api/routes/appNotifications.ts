// ============================================================
// routes/appNotifications.ts
// ============================================================
// DEC-019 Phase 2 — the four endpoints the Flutter app already calls.
//
// This surface is built to a contract the mobile app ALREADY implements
// (mobile-notifications-api-reference.md), so the wire shape is not ours to
// improve: snake_case field names, `id` serialized as a STRING, and the DRF
// page envelope {count, next, previous, results}. Anything that reads oddly
// below is almost certainly the contract, and is commented where so.
//
// Mounted at /api/app/notifications (DEC-019 D-N10) rather than the contract's
// root /notifications/, so the surface inherits the app rate-limit + auth
// layers that hang off the /api/app prefix.
// ============================================================

import { Router } from 'express';
import type { Request } from 'express';
import { requireAppAuth } from '../middleware/appAuth.js';
import pool from '../db.js';
import { appError, sendAppError } from '../utils/appErrors.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Notifications
 *     description: Customer mobile-app notification inbox + FCM token registry. DEC-019.
 */

const DEFAULT_PAGE_SIZE = 20; // AppConstants.defaultPageSize on the app
const MAX_PAGE_SIZE = 100;

/** The app only ever sends 'ios' | 'android' (§F.2); anything else is a bug. */
const PLATFORMS = new Set(['ios', 'android']);
const LOCALES = new Set(['ar', 'en']);

interface NotificationRow {
  id: string;
  message: string;
  is_read: boolean;
  data: Record<string, unknown> | null;
  created_at: Date;
  sent_at: Date | null;
  read_at: Date | null;
}

/**
 * Contract §B.2: `id` is parsed as a Dart String even though the column is a
 * bigint, and `data` must never be null — the app requires at least `{}`.
 * node-pg already hands back bigint as a string, so `id` needs no conversion,
 * only a guarantee it stays one.
 */
function toWire(row: NotificationRow) {
  return {
    id: String(row.id),
    message: row.message,
    is_read: row.is_read,
    data: row.data ?? {},
    created_at: row.created_at,
    sent_at: row.sent_at,
    read_at: row.read_at,
  };
}

/** Absolute page URL — the app derives `hasMore` purely from `next != null`. */
function pageUrl(req: Request, page: number, pageSize: number): string {
  const host = req.get('host') ?? 'localhost';
  return `${req.protocol}://${host}${req.baseUrl}${req.path}?page=${page}&page_size=${pageSize}`;
}

/** Rejects anything the contract calls malformed (§12) instead of coercing it. */
function readPositiveInt(raw: unknown, fallback: number, max: number, field: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw appError(400, `قيمة ${field} غير صالحة`, { code: 'invalid_pagination', field });
  }
  return value;
}

function readRequiredString(body: Record<string, unknown>, field: string, maxLength: number): string {
  const raw = body?.[field];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > maxLength) {
    throw appError(400, `الحقل ${field} مطلوب`, { code: 'invalid_field', field });
  }
  return value;
}

/**
 * @swagger
 * /api/app/notifications/:
 *   get:
 *     tags: [App - Notifications]
 *     summary: Paginated notification inbox for the authenticated customer
 *     description: >
 *       DRF PageNumberPagination envelope, 1-indexed `page`, newest-first.
 *       An empty inbox is `200` with `count: 0` — never a 404 (§F.1).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: page_size, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: One page of notifications }
 *       400: { description: Malformed page / page_size }
 *       401: { description: Missing or invalid app bearer token }
 */
router.get('/', requireAppAuth, async (req, res) => {
  try {
    const page = readPositiveInt(req.query.page, 1, 1_000_000, 'page');
    const pageSize = readPositiveInt(req.query.page_size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 'page_size');
    const appAccountId = req.appAccount!.appAccountId;

    // COUNT(*) OVER () rides along with the page so `count` costs no second
    // round trip. It is the TOTAL, not the page length (§B.3).
    const { rows } = await pool.query<NotificationRow & { total_count: string }>(
      `SELECT id, message, is_read, data, created_at, sent_at, read_at,
              COUNT(*) OVER () AS total_count
         FROM app_notifications
        WHERE app_account_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [appAccountId, pageSize, (page - 1) * pageSize],
    );

    // No rows on page 1 means an empty inbox; no rows on page 9 means the app
    // walked past the end. Both are a legitimate empty page, so count has to
    // come from a second read rather than from rows[0].
    const count = rows.length > 0
      ? Number(rows[0].total_count)
      : Number(
        (await pool.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM app_notifications WHERE app_account_id = $1',
          [appAccountId],
        )).rows[0].count,
      );

    return res.json({
      count,
      next: page * pageSize < count ? pageUrl(req, page + 1, pageSize) : null,
      previous: page > 1 ? pageUrl(req, page - 1, pageSize) : null,
      results: rows.map(toWire),
    });
  } catch (err) {
    return sendAppError(res, err, 'notifications.list');
  }
});

/**
 * @swagger
 * /api/app/notifications/register-token/:
 *   post:
 *     tags: [App - Notifications]
 *     summary: Register (upsert) this device's FCM token for the caller
 *     description: >
 *       The user is identified by the bearer token, never by the body (§F.2).
 *       Idempotent: the app re-POSTs whenever token, user or locale changes.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Registration stored }
 *       400: { description: Missing or invalid field }
 *       401: { description: Missing or invalid app bearer token }
 */
router.post('/register-token', requireAppAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = readRequiredString(body, 'token', 4096);
    const deviceId = readRequiredString(body, 'device_id', 200);
    const platform = readRequiredString(body, 'platform', 10).toLowerCase();
    if (!PLATFORMS.has(platform)) {
      throw appError(400, 'نوع الجهاز غير مدعوم', { code: 'invalid_field', field: 'platform' });
    }
    const rawLocale = typeof body.locale === 'string' ? body.locale.trim().toLowerCase() : '';
    const locale = LOCALES.has(rawLocale) ? rawLocale : 'ar';
    const appAccountId = req.appAccount!.appAccountId;

    await client.query('BEGIN');

    // A handset that changed hands: the previous account's row still points at
    // this exact FCM token, so its pushes would land on a device that person no
    // longer controls. FCM issues one token per app install, so a token seen
    // under another account is always stale, never concurrent.
    await client.query(
      `DELETE FROM app_notification_registrations
        WHERE fcm_token = $1 AND app_account_id <> $2`,
      [token, appAccountId],
    );

    await client.query(
      `INSERT INTO app_notification_registrations
         (app_account_id, device_id, platform, fcm_token, locale)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (app_account_id, device_id) DO UPDATE
         SET fcm_token  = EXCLUDED.fcm_token,
             platform   = EXCLUDED.platform,
             locale     = EXCLUDED.locale,
             updated_at = NOW()`,
      [appAccountId, deviceId, platform, token, locale],
    );

    await client.query('COMMIT');
    return res.json({ message: 'تم تسجيل رمز الجهاز بنجاح' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return sendAppError(res, err, 'notifications.registerToken');
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/app/notifications/register-token/:
 *   delete:
 *     tags: [App - Notifications]
 *     summary: Remove this device's push registration for the caller
 *     description: >
 *       Called on sign-out with a DELETE body (§F.3). Always `200`, even when
 *       nothing matched — the app fires this best-effort and swallows failures,
 *       so a 404 would only produce noise it never reads.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Registration removed (or was already absent) }
 *       400: { description: Missing device_id }
 *       401: { description: Missing or invalid app bearer token }
 */
router.delete('/register-token', requireAppAuth, async (req, res) => {
  try {
    const deviceId = readRequiredString((req.body ?? {}) as Record<string, unknown>, 'device_id', 200);
    await pool.query(
      'DELETE FROM app_notification_registrations WHERE app_account_id = $1 AND device_id = $2',
      [req.appAccount!.appAccountId, deviceId],
    );
    return res.json({ message: 'تم إلغاء تسجيل الجهاز' });
  } catch (err) {
    return sendAppError(res, err, 'notifications.unregisterToken');
  }
});

/**
 * @swagger
 * /api/app/notifications/{id}/mark-read/:
 *   patch:
 *     tags: [App - Notifications]
 *     summary: Mark one notification as read
 *     description: >
 *       Idempotent — re-marking an already-read notification succeeds without
 *       moving read_at. A row that does not exist and a row belonging to another
 *       account both return 404: the two are indistinguishable by design (§12),
 *       so the response cannot be used to probe for other people's ids.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Notification is now read }
 *       401: { description: Missing or invalid app bearer token }
 *       404: { description: No such notification for this account }
 */
router.patch('/:id/mark-read', requireAppAuth, async (req, res) => {
  try {
    const id = String(req.params.id ?? '');
    // A non-numeric id can never match a bigint PK. Answering 404 (not 400)
    // keeps every "not yours / not there" case on one indistinguishable reply.
    if (!/^\d{1,19}$/.test(id)) {
      throw appError(404, 'الإشعار غير موجود', { code: 'notification_not_found' });
    }
    const { rowCount } = await pool.query(
      `UPDATE app_notifications
          SET is_read = TRUE,
              read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND app_account_id = $2`,
      [id, req.appAccount!.appAccountId],
    );
    if (rowCount === 0) {
      throw appError(404, 'الإشعار غير موجود', { code: 'notification_not_found' });
    }
    return res.json({ message: 'تم تعليم الإشعار كمقروء' });
  } catch (err) {
    return sendAppError(res, err, 'notifications.markRead');
  }
});

export default router;
