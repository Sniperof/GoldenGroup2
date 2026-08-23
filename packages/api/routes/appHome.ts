import { Router } from 'express';
import { optionalAppAuth } from '../middleware/appAuth.js';
import { listPublicHomeBanners } from '../services/appHomeBanners.js';
import { readPublicAppContactLinks } from '../services/appContactLinks.js';
import { sendAppError } from '../utils/appErrors.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Home
 *     description: Customer mobile-app home screen surfaces.
 */

/**
 * @swagger
 * /api/app/home/banners:
 *   get:
 *     tags: [App - Home]
 *     summary: Rotating banner slides for the app home screen
 *     description: >
 *       Publishable slides only, in display order. A slide is publishable when
 *       it is active, inside its publish window, matches the caller's audience,
 *       and its tap target still resolves — a banner pointing at a deactivated
 *       catalog device or a request type the app can no longer open is dropped
 *       server-side rather than returned as a dead tap.
 *
 *       Auth is optional: unauthenticated visitors get the `all` + `guests`
 *       slides, authenticated customers get `all` + `customers`.
 *
 *       `target.kind = device` carries `deviceId`, which is a public catalog id
 *       for GET /api/app/catalog/devices/{deviceId} — never an installed device.
 *     security: [{ bearerAuth: [] }, {}]
 *     responses:
 *       200:
 *         description: Ordered slide list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [items]
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     required: [id, imageUrl, displaySeconds, target]
 *                     properties:
 *                       id: { type: integer }
 *                       titleAr: { type: string, nullable: true }
 *                       imageUrl: { type: string, example: /uploads/banner.webp }
 *                       displaySeconds: { type: integer, minimum: 2, maximum: 60 }
 *                       target:
 *                         type: object
 *                         required: [kind]
 *                         properties:
 *                           kind: { type: string, enum: [none, device, service_request, external_url] }
 *                           deviceId: { type: integer }
 *                           requestType: { type: string }
 *                           labelAr: { type: string }
 *                           url: { type: string }
 *       401: { description: Bearer token present but invalid }
 *       429: { description: "Per-IP read window (details.code = rate_limited)" }
 */
router.get('/home/banners', optionalAppAuth, async (req, res) => {
  try {
    const items = await listPublicHomeBanners(Boolean(req.appAccount));
    return res.json({ items });
  } catch (err) {
    return sendAppError(res, err, 'home.banners');
  }
});

/**
 * @swagger
 * /api/app/home/contact-links:
 *   get:
 *     tags: [App - Home]
 *     summary: Admin-managed contact and social links for the mobile app
 *     description: >
 *       The five platform keys are stable. A null value means the mobile app
 *       must hide that platform. Phone values are returned as canonical E.164
 *       numbers; the client chooses the platform-specific action/deep link.
 *     security: [{ bearerAuth: [] }, {}]
 *     responses:
 *       200:
 *         description: Current contact links
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [links, updatedAt]
 *               properties:
 *                 links:
 *                   type: object
 *                   required: [facebook, website, instagram, whatsapp, telegram]
 *                   properties:
 *                     facebook: { nullable: true, type: object }
 *                     website: { nullable: true, type: object }
 *                     instagram: { nullable: true, type: object }
 *                     whatsapp: { nullable: true, type: object }
 *                     telegram: { nullable: true, type: object }
 *                 updatedAt: { type: string, format: date-time }
 *       401: { description: Bearer token present but invalid }
 *       429: { description: "Per-IP read window (details.code = rate_limited)" }
 */
router.get('/home/contact-links', optionalAppAuth, async (_req, res) => {
  try {
    return res.json(await readPublicAppContactLinks());
  } catch (err) {
    return sendAppError(res, err, 'home.contactLinks');
  }
});

export default router;
