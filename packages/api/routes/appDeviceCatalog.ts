import { Router } from 'express';
import {
  getPublicDeviceCatalogDetails,
  listPublicDeviceCatalog,
} from '../services/appDeviceCatalogService.js';

const router = Router();

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
 *     responses:
 *       200: { description: Active public device catalog }
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

    return res.json(await listPublicDeviceCatalog({
      featured: featuredRaw === 'true',
      category: category || undefined,
      search: search || undefined,
    }));
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
