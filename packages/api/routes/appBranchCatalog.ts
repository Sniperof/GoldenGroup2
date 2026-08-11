import { Router } from 'express';
import {
  getPublicBranchDetails,
  listPublicBranches,
} from '../services/appBranchCatalogService.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: App - Branch Catalog
 *     description: Public mobile branch catalog.
 * /api/app/catalog/branches:
 *   get:
 *     tags: [App - Branch Catalog]
 *     summary: List active branches published for mobile
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: geoUnitId
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Published mobile branches }
 *       400: { description: Invalid filter }
 *       500: { description: Branch catalog unavailable }
 */
router.get('/', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 100) return res.status(400).json({ error: 'عبارة البحث طويلة جداً' });

  let geoUnitId: number | undefined;
  if (req.query.geoUnitId !== undefined) {
    geoUnitId = Number(req.query.geoUnitId);
    if (!Number.isInteger(geoUnitId) || geoUnitId <= 0) {
      return res.status(400).json({ error: 'معرف المنطقة غير صالح' });
    }
  }

  try {
    return res.json(await listPublicBranches({ search: search || undefined, geoUnitId }));
  } catch (error) {
    console.error('Public branch catalog list error:', error);
    return res.status(500).json({ error: 'تعذر تحميل قائمة الفروع' });
  }
});

/**
 * @swagger
 * /api/app/catalog/branches/{branchId}:
 *   get:
 *     tags: [App - Branch Catalog]
 *     summary: Get a published mobile branch with contacts and sold devices
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Published branch details }
 *       400: { description: Invalid branch identifier }
 *       404: { description: Branch missing, inactive, or hidden from mobile }
 *       500: { description: Branch catalog unavailable }
 */
router.get('/:branchId', async (req, res) => {
  const branchId = Number(req.params.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    return res.status(400).json({ error: 'معرف الفرع غير صالح' });
  }
  try {
    const branch = await getPublicBranchDetails(branchId);
    if (!branch) return res.status(404).json({ error: 'الفرع غير موجود' });
    return res.json(branch);
  } catch (error) {
    console.error('Public branch catalog details error:', error);
    return res.status(500).json({ error: 'تعذر تحميل تفاصيل الفرع' });
  }
});

export default router;
