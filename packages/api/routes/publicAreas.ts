import { Router } from 'express';
import {
  listPublicAreas,
  searchPublicAreas,
} from '../services/geo/publicAreaCatalog.js';

const router = Router();

function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

export function parsePublicAreaParentId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw badRequest('parent_id يجب أن يكون معرّفاً رقمياً صحيحاً');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw badRequest('parent_id يجب أن يكون معرّفاً رقمياً صحيحاً');
  }
  return parsed;
}

export function parsePublicAreaSearchQuery(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('q مطلوب للبحث');
  const query = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const length = Array.from(query).length;
  if (length < 2 || length > 80) {
    throw badRequest('q يجب أن يكون بين حرفين و80 حرفاً');
  }
  return query;
}

export function parsePublicAreaSearchLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 15;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw badRequest('limit يجب أن يكون عدداً صحيحاً بين 1 و20');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw badRequest('limit يجب أن يكون عدداً صحيحاً بين 1 و20');
  }
  return parsed;
}

/**
 * @swagger
 * /api/public/areas/search:
 *   get:
 *     tags: [Public → Areas]
 *     summary: Search active geography areas with their complete paths
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 80
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *           default: 15
 *     responses:
 *       200:
 *         description: Active matching areas with root-to-result paths
 *       400:
 *         description: Invalid search parameters
 */
router.get('/search', async (req, res, next) => {
  try {
    const query = parsePublicAreaSearchQuery(req.query.q);
    const limit = parsePublicAreaSearchLimit(req.query.limit);
    const items = await searchPublicAreas(query, limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/public/areas:
 *   get:
 *     tags: [Public → Areas]
 *     summary: Retrieve geography areas publicly
 *     parameters:
 *       - in: query
 *         name: parent_id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Parent Area ID (omitting returns level 1 governorates)
 *       - in: query
 *         name: activeOnly
 *         schema:
 *           type: boolean
 *         required: false
 *         deprecated: true
 *         description: Kept for compatibility; public results are always active-only.
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', async (req, res, next) => {
  try {
    const parentId = parsePublicAreaParentId(req.query.parent_id);
    const rows = await listPublicAreas(parentId);
    // Preserve the established mobile response shape; `level` is exposed only
    // by the smart-search contract where it is needed to rebuild a selection.
    res.json(rows.map(({ level: _level, ...area }) => area));
  } catch (err) {
    next(err);
  }
});

export default router;
