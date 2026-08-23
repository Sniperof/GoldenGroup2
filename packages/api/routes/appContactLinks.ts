import { Router, type Response } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  APP_CONTACT_LINKS_SELECT,
  clearAppContactLinksCache,
  normalizeAppContactLinksInput,
  readAppContactLinks,
} from '../services/appContactLinks.js';
import { insertAuditLog } from '../utils/auditLog.js';
import { toPublicAppError } from '../utils/appErrors.js';

const router = Router();
router.use(requireAuth);

const VIEW = 'admin.app_contact_links.view';
const MANAGE = 'admin.app_contact_links.manage';

function fail(res: Response, err: unknown, label: string) {
  const { status, body, isInternal } = toPublicAppError(err);
  if (isInternal) console.error(`[admin:${label}]`, err);
  return res.status(status).json(body);
}

/**
 * @swagger
 * components:
 *   schemas:
 *     AppContactLinks:
 *       type: object
 *       required: [facebookUrl, websiteUrl, instagramUrl, whatsappNumber, telegramNumber]
 *       properties:
 *         facebookUrl: { type: string, format: uri, nullable: true }
 *         websiteUrl: { type: string, format: uri, nullable: true }
 *         instagramUrl: { type: string, format: uri, nullable: true }
 *         whatsappNumber: { type: string, nullable: true, example: "+963912345687" }
 *         telegramNumber: { type: string, nullable: true, example: "+963912345687" }
 *         updatedAt: { type: string, format: date-time, readOnly: true }
 */

/**
 * @swagger
 * /api/admin/app-contact-links:
 *   get:
 *     tags: [App Contact Links]
 *     summary: Read the complete mobile contact-links configuration
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current configuration }
 *       403: { description: Missing admin.app_contact_links.view }
 */
router.get('/', requirePermission(VIEW), async (_req, res) => {
  try {
    return res.json(await readAppContactLinks());
  } catch (err) {
    return fail(res, err, 'appContactLinks.get');
  }
});

/**
 * @swagger
 * /api/admin/app-contact-links:
 *   put:
 *     tags: [App Contact Links]
 *     summary: Atomically replace all five mobile contact links
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AppContactLinks' }
 *     responses:
 *       200: { description: Saved configuration }
 *       400: { description: Invalid URL or E.164 phone number }
 *       403: { description: Missing admin.app_contact_links.manage }
 */
router.put('/', requirePermission(MANAGE), async (req, res) => {
  let input;
  try {
    input = normalizeAppContactLinksInput(req.body);
  } catch (err) {
    return fail(res, err, 'appContactLinks.validate');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await readAppContactLinks(client, true);
    const { rows } = await client.query(
      `UPDATE public.app_contact_links
          SET facebook_url = $1,
              website_url = $2,
              instagram_url = $3,
              whatsapp_number = $4,
              telegram_number = $5,
              updated_by = $6,
              updated_at = NOW()
        WHERE id = 1
      RETURNING ${APP_CONTACT_LINKS_SELECT}`,
      [
        input.facebookUrl,
        input.websiteUrl,
        input.instagramUrl,
        input.whatsappNumber,
        input.telegramNumber,
        req.authContext?.userId ?? null,
      ],
    );
    if (!rows[0]) throw new Error('app_contact_links singleton is missing');

    await insertAuditLog(client, {
      entityType: 'app_contact_links',
      entityId: 1,
      actionType: 'app_contact_links_updated',
      performedByRole: req.user?.role,
      performedByUserId: req.authContext?.userId ?? null,
      oldValue: JSON.stringify(previous),
      newValue: JSON.stringify(rows[0]),
    });
    await client.query('COMMIT');
    clearAppContactLinksCache();
    return res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(res, err, 'appContactLinks.update');
  } finally {
    client.release();
  }
});

export default router;
