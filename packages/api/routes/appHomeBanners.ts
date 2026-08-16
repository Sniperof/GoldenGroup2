import { Router, type Response } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  ADMIN_SELECT,
  assertTargetResolvable,
  clearAppHomeBannersCache,
  normalizeBannerInput,
} from '../services/appHomeBanners.js';
import { listExecutableMobileRequestTypes } from '../services/serviceRequests/mobileExecutableTypes.js';
import { syncMediaOwnership } from '../services/media/mediaOwnership.js';
import { toPublicAppError } from '../utils/appErrors.js';

const router = Router();
router.use(requireAuth);

const VIEW = 'admin.app_home_banners.view';
const MANAGE = 'admin.app_home_banners.manage';

/** Deliberate 400s from the service keep their Arabic text; the rest is a 500. */
function fail(res: Response, err: unknown, label: string) {
  const { status, body, isInternal } = toPublicAppError(err);
  if (isInternal) console.error(`[admin:${label}]`, err);
  return res.status(status).json(body);
}

/**
 * @swagger
 * components:
 *   schemas:
 *     AppHomeBanner:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         titleAr: { type: string, nullable: true }
 *         imageUrl: { type: string, description: "Must be /uploads/<file> from POST /api/upload" }
 *         sortOrder: { type: integer }
 *         displaySeconds: { type: integer, minimum: 2, maximum: 60 }
 *         startsAt: { type: string, format: date-time, nullable: true }
 *         endsAt: { type: string, format: date-time, nullable: true }
 *         targetKind: { type: string, enum: [none, device, service_request, external_url] }
 *         targetDeviceModelId: { type: integer, nullable: true, description: "device_models.id (public catalog)" }
 *         targetRequestType: { type: string, nullable: true }
 *         targetUrl: { type: string, nullable: true }
 *         audience: { type: string, enum: [all, customers, guests] }
 *         isActive: { type: boolean }
 */

/**
 * @swagger
 * /api/admin/app-home-banners:
 *   get:
 *     tags: [App Home Banners]
 *     summary: List every home-screen banner, including disabled and expired
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Banners in display order
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/AppHomeBanner' } }
 */
router.get('/', requirePermission(VIEW), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ADMIN_SELECT} FROM public.app_home_banners ORDER BY sort_order, id`,
    );
    return res.json(rows);
  } catch (err) {
    return fail(res, err, 'appHomeBanners.list');
  }
});

/**
 * @swagger
 * /api/admin/app-home-banners/target-options:
 *   get:
 *     tags: [App Home Banners]
 *     summary: Selectable tap targets for the banner form
 *     description: >
 *       Both pickers in one call. `devices` are active public-catalog device
 *       models; `requestTypes` are the request types the mobile app can
 *       currently open a form for (registry ∩ handler), so the admin cannot
 *       pick a target that would be dropped at read time.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ devices: [...], requestTypes: [...] }" }
 */
router.get('/target-options', requirePermission(VIEW), async (_req, res) => {
  try {
    const [devices, executable] = await Promise.all([
      pool.query(
        `SELECT id, COALESCE(NULLIF(name_ar, ''), NULLIF(name_en, ''), name) AS "nameAr", category
           FROM public.device_models
          WHERE is_active = TRUE AND deleted_at IS NULL
          ORDER BY COALESCE(NULLIF(name_ar, ''), NULLIF(name_en, ''), name)`,
      ),
      listExecutableMobileRequestTypes(),
    ]);
    return res.json({
      devices: devices.rows,
      requestTypes: executable.map(({ definition }) => ({
        requestType: definition.requestType,
        labelAr: definition.labelAr,
      })),
    });
  } catch (err) {
    return fail(res, err, 'appHomeBanners.targetOptions');
  }
});

/**
 * @swagger
 * /api/admin/app-home-banners:
 *   post:
 *     tags: [App Home Banners]
 *     summary: Create a banner
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AppHomeBanner' }
 *     responses:
 *       201: { description: Created banner }
 *       400: { description: Invalid payload or unresolvable target }
 */
router.post('/', requirePermission(MANAGE), async (req, res) => {
  const client = await pool.connect();
  try {
    const input = normalizeBannerInput(req.body);
    await assertTargetResolvable(input, client);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO public.app_home_banners
         (title_ar, image_url, sort_order, display_seconds, starts_at, ends_at,
          target_kind, target_device_model_id, target_request_type, target_url,
          audience, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING ${ADMIN_SELECT}`,
      [
        input.titleAr, input.imageUrl, input.sortOrder, input.displaySeconds,
        input.startsAt, input.endsAt, input.targetKind, input.targetDeviceModelId,
        input.targetRequestType, input.targetUrl, input.audience, input.isActive,
        req.user?.id ?? null,
      ],
    );
    await syncMediaOwnership(client, 'app_home_banner', rows[0].id, input.imageUrl);
    await client.query('COMMIT');
    clearAppHomeBannersCache();
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'appHomeBanners.create');
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/admin/app-home-banners/{id}:
 *   put:
 *     tags: [App Home Banners]
 *     summary: Replace a banner
 *     description: >
 *       Full replace, not a patch. A banner's target is a single coherent shape
 *       (kind plus exactly one value column), so a partial update could not be
 *       validated without re-reading and merging the row anyway.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AppHomeBanner' }
 *     responses:
 *       200: { description: Updated banner }
 *       400: { description: Invalid payload or unresolvable target }
 *       404: { description: Banner not found }
 */
router.put('/:id', requirePermission(MANAGE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'معرف البانر غير صالح' });
  try {
    const input = normalizeBannerInput(req.body);
    await assertTargetResolvable(input);
    const { rows } = await pool.query(
      `UPDATE public.app_home_banners
          SET title_ar = $1, image_url = $2, sort_order = $3, display_seconds = $4,
              starts_at = $5, ends_at = $6, target_kind = $7,
              target_device_model_id = $8, target_request_type = $9, target_url = $10,
              audience = $11, is_active = $12, updated_by = $13, updated_at = NOW()
        WHERE id = $14
        RETURNING ${ADMIN_SELECT}`,
      [
        input.titleAr, input.imageUrl, input.sortOrder, input.displaySeconds,
        input.startsAt, input.endsAt, input.targetKind, input.targetDeviceModelId,
        input.targetRequestType, input.targetUrl, input.audience, input.isActive,
        req.user?.id ?? null,
        id,
      ],
    );
    if (!rows[0]) return res.status(404).json({ error: 'البانر غير موجود' });
    clearAppHomeBannersCache();
    return res.json(rows[0]);
  } catch (err) {
    return fail(res, err, 'appHomeBanners.update');
  }
});

/**
 * @swagger
 * /api/admin/app-home-banners/reorder:
 *   patch:
 *     tags: [App Home Banners]
 *     summary: Rewrite display order for the whole strip
 *     description: >
 *       Takes the full ordered id list and writes it in one transaction. Doing
 *       this row-by-row would leave a visibly scrambled strip if any single
 *       write failed.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids: { type: array, items: { type: integer } }
 *     responses:
 *       200: { description: Reordered banners }
 *       400: { description: Invalid or unknown ids }
 */
router.patch('/reorder', requirePermission(MANAGE), async (req, res) => {
  const ids = (req.body ?? {}).ids;
  if (!Array.isArray(ids) || ids.length === 0
    || !ids.every((id: unknown) => Number.isInteger(id) && (id as number) > 0)) {
    return res.status(400).json({ error: 'قائمة المعرفات غير صالحة' });
  }
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'قائمة المعرفات تحتوي تكراراً' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE public.app_home_banners b
          SET sort_order = ordering.position, updated_at = NOW()
         FROM (SELECT id, ordinality AS position
                 FROM unnest($1::bigint[]) WITH ORDINALITY AS t(id, ordinality)) ordering
        WHERE b.id = ordering.id`,
      [ids],
    );
    if (rowCount !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'بعض البانرات غير موجودة' });
    }
    await client.query('COMMIT');
    clearAppHomeBannersCache();
    const { rows } = await pool.query(
      `SELECT ${ADMIN_SELECT} FROM public.app_home_banners ORDER BY sort_order, id`,
    );
    return res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'appHomeBanners.reorder');
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/admin/app-home-banners/{id}:
 *   delete:
 *     tags: [App Home Banners]
 *     summary: Delete a banner
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Banner not found }
 */
router.delete('/:id', requirePermission(MANAGE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'معرف البانر غير صالح' });
  try {
    const { rowCount } = await pool.query('DELETE FROM public.app_home_banners WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'البانر غير موجود' });
    clearAppHomeBannersCache();
    return res.json({ success: true });
  } catch (err) {
    return fail(res, err, 'appHomeBanners.delete');
  }
});

export default router;
