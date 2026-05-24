import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const LEVEL_TYPE: Record<number, string> = {
  1: 'governorate',
  2: 'city',
  3: 'sub_area',
  4: 'neighborhood',
};

/**
 * @swagger
 * /api/public/areas:
 *   get:
 *     tags: [Public → Areas]
 *     summary: Retrieve geography areas publicly
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context ID
 *       - in: query
 *         name: parent_id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Parent Area ID (omitting returns level 1 governorates)
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', async (req, res) => {
  try {
    const { parent_id } = req.query;

    let rows: any[];
    if (parent_id) {
      const result = await pool.query(
        `SELECT id, name, level, parent_id AS "parentId"
         FROM geo_units
         WHERE parent_id = $1
         ORDER BY name`,
        [parent_id]
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT id, name, level, parent_id AS "parentId"
         FROM geo_units
         WHERE level = 1
         ORDER BY name`
      );
      rows = result.rows;
    }

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: LEVEL_TYPE[r.level] ?? 'area',
        parentId: r.parentId,
      }))
    );
  } catch (err: any) {
    console.error('Error fetching public areas:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
