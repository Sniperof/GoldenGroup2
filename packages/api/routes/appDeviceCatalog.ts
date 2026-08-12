import { Router } from 'express';
import {
  getPublicDeviceCatalogDetails,
  listPublicDeviceCatalogPage,
} from '../services/appDeviceCatalogService.js';

const router = Router();

export function parsePublicCatalogPagination(pageRaw: unknown, limitRaw: unknown) {
  const page = pageRaw === undefined ? 1 : Number(pageRaw);
  if (typeof pageRaw !== 'undefined'
    && (typeof pageRaw !== 'string' || !Number.isInteger(page) || page <= 0)) {
    return { value: null, error: 'page يجب أن يكون عدداً صحيحاً موجباً' };
  }

  const limit = limitRaw === undefined ? 12 : Number(limitRaw);
  if (typeof limitRaw !== 'undefined'
    && (typeof limitRaw !== 'string' || !Number.isInteger(limit) || limit <= 0 || limit > 50)) {
    return { value: null, error: 'limit يجب أن يكون عدداً صحيحاً بين 1 و50' };
  }

  return { value: { page, limit }, error: null };
}

export function parsePublicCatalogFields(fieldsRaw: unknown) {
  if (fieldsRaw === undefined || fieldsRaw === 'full') {
    return { value: 'full' as const, error: null };
  }
  if (fieldsRaw === 'names') {
    return { value: 'names' as const, error: null };
  }
  return { value: null, error: 'fields يجب أن تكون full أو names' };
}

/**
 * @swagger
 * tags:
 *   - name: App - Device Catalog
 *     description: Public company-device catalog for mobile visitors.
 */

/**
 * @swagger
 * /api/app/catalog/devices:
 *   get:
 *     tags: [App - Device Catalog]
 *     summary: List active company devices for visitors
 *     parameters:
 *       - in: query
 *         name: featured
 *         schema: { type: boolean }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 12 }
 *       - in: query
 *         name: fields
 *         description: Use names to return only id, nameAr, and nameEn for lightweight selectors.
 *         schema: { type: string, enum: [full, names], default: full }
 *     responses:
 *       200:
 *         description: Paginated active public device catalog
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [items, total, page, limit]
 *               properties:
 *                 items:
 *                   type: array
 *                   items: { type: object }
 *                 total: { type: integer, minimum: 0 }
 *                 page: { type: integer, minimum: 1 }
 *                 limit: { type: integer, minimum: 1, maximum: 50 }
 *       400: { description: Invalid query }
 *       500: { description: Catalog unavailable }
 */
router.get('/', async (req, res) => {
  try {
    const featuredRaw = req.query.featured;
    if (featuredRaw !== undefined && featuredRaw !== 'true' && featuredRaw !== 'false') {
      return res.status(400).json({ error: 'featured يجب أن تكون true أو false' });
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search.length > 100) {
      return res.status(400).json({ error: 'عبارة البحث طويلة جداً' });
    }

    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    if (category.length > 100) {
      return res.status(400).json({ error: 'تصنيف الجهاز غير صالح' });
    }

    const pagination = parsePublicCatalogPagination(req.query.page, req.query.limit);
    if (pagination.error || !pagination.value) {
      return res.status(400).json({ error: pagination.error });
    }

    const fields = parsePublicCatalogFields(req.query.fields);
    if (fields.error || !fields.value) {
      return res.status(400).json({ error: fields.error });
    }

    return res.json(await listPublicDeviceCatalogPage(
      {
        featured: featuredRaw === 'true',
        category: category || undefined,
        search: search || undefined,
      },
      { ...pagination.value, fields: fields.value },
    ));
  } catch (err) {
    console.error('Public device catalog list error:', err);
    return res.status(500).json({ error: 'تعذر تحميل كتالوج الأجهزة' });
  }
});

/**
 * @swagger
 * /api/app/catalog/devices/{deviceId}:
 *   get:
 *     tags: [App - Device Catalog]
 *     summary: Get public details for an active company device
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Public device details }
 *       400: { description: Invalid device identifier }
 *       404: { description: Device missing, inactive, or deleted }
 *       500: { description: Catalog unavailable }
 */
router.get('/:deviceId', async (req, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ error: 'معرف الجهاز غير صالح' });
  }

  try {
    const device = await getPublicDeviceCatalogDetails(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'الجهاز غير موجود' });
    }
    return res.json(device);
  } catch (err) {
    console.error('Public device catalog details error:', err);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الجهاز' });
  }
});

export default router;
