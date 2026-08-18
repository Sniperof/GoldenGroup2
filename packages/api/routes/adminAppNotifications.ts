// ============================================================
// routes/adminAppNotifications.ts
// ============================================================
// DEC-019 Phase 7 — admin free-form notification send (D-N6 / D-N7).
//
// Three endpoints, and the order matters: preview, send, history. The preview is
// not a convenience — it is one of the three mandatory guards, because the send
// is irreversible and leaves the system.
//
// Scope: a BRANCH-scoped operator can only ever address their own branch. The
// route pins `branchId` for them rather than trusting the body, so an operator
// cannot widen their own audience by editing a request.
// ============================================================

import { Router, type Response } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { resolveListAccessScope } from '../services/authorizationService.js';
import { toPublicAppError, appError } from '../utils/appErrors.js';
import {
  previewAudience,
  sendBroadcast,
  type BroadcastAudience,
} from '../services/appNotifications/broadcastService.js';
import { isNotificationLocale } from '../services/appNotifications/notificationCatalog.js';

const router = Router();
router.use(requireAuth);

const VIEW = 'admin.app_notifications.view';
const SEND = 'admin.app_notifications.send';

const DESTINATIONS = new Set(['service_request', 'device', 'warranty', 'complaint', 'visit']);
const MAX_TITLE = 150;
const MAX_MESSAGE = 2000;

function fail(res: Response, err: unknown, label: string) {
  const { status, body, isInternal } = toPublicAppError(err);
  if (isInternal) console.error(`[admin:${label}]`, err);
  return res.status(status).json(body);
}

function readIntOrNull(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resolves the audience, pinning the branch for anyone who is not GLOBAL.
 *
 * A BRANCH operator's own branch replaces whatever the body asked for; that is
 * the whole of D-N7's "the filter is bounded by branch coverage" — enforced
 * server-side, because a client-side bound is a suggestion.
 */
function resolveAudience(req: any, permission: string): BroadcastAudience {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = (body.audience ?? body) as Record<string, unknown>;
  const plan = resolveListAccessScope(req.authContext!, permission);

  if (plan.scope === 'NONE') {
    throw appError(403, 'غير مسموح', { code: 'forbidden' });
  }

  const requestedBranch = readIntOrNull(raw.branchId);
  let allowedBranchIds: number[] | null = null;
  if (plan.scope !== 'GLOBAL') {
    // The union of the operator's effective branch assignments — a branch user
    // may cover several, so the ceiling is that list, not their home branch.
    allowedBranchIds = plan.allowedBranchIds ?? [];
    if (allowedBranchIds.length === 0) {
      throw appError(403, 'لا يمكن تحديد فرعك — تواصل مع مدير النظام', { code: 'no_branch_context' });
    }
    if (requestedBranch != null && !allowedBranchIds.includes(requestedBranch)) {
      throw appError(403, 'لا يمكنك مخاطبة عملاء فرع آخر', { code: 'branch_out_of_scope' });
    }
  }

  const geoIds = Array.isArray(raw.geoIds)
    ? raw.geoIds.map((v) => String(v)).filter((v) => /^\d+$/.test(v))
    : typeof raw.geoIds === 'string'
      ? raw.geoIds.split(',').map((v) => v.trim()).filter((v) => /^\d+$/.test(v))
      : [];

  return {
    branchId: requestedBranch,
    allowedBranchIds,
    geoIds,
    clientId: readIntOrNull(raw.clientId),
  };
}

/**
 * @swagger
 * /api/admin/app-notifications/audience-preview:
 *   post:
 *     tags: [Admin - App Notifications]
 *     summary: Count the recipients an audience filter resolves to
 *     description: >
 *       Mandatory before sending (DEC-019 D-N6). Returns inbox count, distinct
 *       customers, and how many of those have a registered device — the rest see
 *       the notification only when they next open the app.
 *     responses:
 *       200: { description: Recipient counts }
 *       403: { description: Audience outside the operator's branch scope }
 */
router.post('/audience-preview', requirePermission(SEND), async (req, res) => {
  try {
    const audience = resolveAudience(req, SEND);
    const preview = await previewAudience(audience);
    return res.json({ audience, ...preview });
  } catch (err) {
    return fail(res, err, 'appNotifications.preview');
  }
});

/**
 * @swagger
 * /api/admin/app-notifications/broadcasts:
 *   post:
 *     tags: [Admin - App Notifications]
 *     summary: Send a free-form notification to a filtered audience
 *     description: >
 *       Irreversible. Writes the audit row and every inbox row in one
 *       transaction, then delivers push in batches (DEC-019 D-N6).
 *     responses:
 *       201: { description: Sent }
 *       400: { description: Missing or invalid text / destination }
 *       403: { description: Audience outside the operator's branch scope }
 *       409: { description: Free-form notifications are switched off in settings }
 */
router.post('/broadcasts', requirePermission(SEND), async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!title || title.length > MAX_TITLE) {
      throw appError(400, 'العنوان مطلوب', { code: 'invalid_title' });
    }
    if (!message || message.length > MAX_MESSAGE) {
      throw appError(400, 'نص الإشعار مطلوب', { code: 'invalid_message' });
    }

    const localeRaw = typeof body.locale === 'string' ? body.locale.trim().toLowerCase() : 'ar';
    const locale = isNotificationLocale(localeRaw) ? localeRaw : 'ar';

    const destination = typeof body.destination === 'string' && body.destination
      ? body.destination
      : null;
    if (destination && !DESTINATIONS.has(destination)) {
      throw appError(400, 'وجهة غير معروفة', { code: 'invalid_destination' });
    }
    const destinationId = body.destinationId == null || body.destinationId === ''
      ? null
      : String(body.destinationId);
    // A destination with no id navigates nowhere useful for the entity screens,
    // so reject the half-configured case instead of shipping a dead tap.
    if (destination && destination !== 'warranty' && !destinationId) {
      throw appError(400, 'معرّف الوجهة مطلوب', { code: 'destination_id_required' });
    }

    const audience = resolveAudience(req, SEND);
    const result = await sendBroadcast({
      title,
      message,
      locale,
      destination: destination as any,
      destinationId,
      audience,
      sentByUserId: (req as any).user?.id,
      previewedCount: readIntOrNull(body.previewedCount),
    });
    return res.status(201).json(result);
  } catch (err) {
    return fail(res, err, 'appNotifications.send');
  }
});

/**
 * @swagger
 * /api/admin/app-notifications/broadcasts:
 *   get:
 *     tags: [Admin - App Notifications]
 *     summary: History of free-form sends
 *     description: >
 *       The audit trail from D-N6. A BRANCH operator sees only sends made in
 *       their own branch context; GLOBAL sees everything, including sends with no
 *       branch filter.
 *     responses:
 *       200: { description: Recent broadcasts, newest first }
 */
router.get('/broadcasts', requirePermission(VIEW), async (req, res) => {
  try {
    const plan = resolveListAccessScope(req.authContext!, VIEW);
    const params: unknown[] = [];
    let where = 'TRUE';
    if (plan.scope !== 'GLOBAL') {
      const allowed = plan.allowedBranchIds ?? [];
      if (allowed.length === 0) return res.json({ items: [] });
      params.push(allowed);
      // A send made with no branch filter (org-wide reach) is deliberately
      // invisible here: it was not made within this operator's scope.
      where = `b.branch_id = ANY($${params.length}::int[])`;
    }
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.message, b.locale, b.destination, b.destination_id AS "destinationId",
              b.audience, b.previewed_count AS "previewedCount",
              b.notification_count AS "notificationCount",
              b.branch_id AS "branchId", br.name AS "branchName",
              u.name AS "sentBy", b.created_at AS "createdAt",
              b.completed_at AS "completedAt", b.last_error AS "lastError"
         FROM app_notification_broadcasts b
         LEFT JOIN branches br ON br.id = b.branch_id
         LEFT JOIN hr_users u  ON u.id = b.sent_by_user_id
        WHERE ${where}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT 200`,
      params,
    );
    return res.json({ items: rows });
  } catch (err) {
    return fail(res, err, 'appNotifications.history');
  }
});

export default router;
