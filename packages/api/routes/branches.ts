import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();

/**
 * @swagger
 * /api/branches:
 *   get:
 *     tags: [Branches]
 *     summary: List all branches
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of branches
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   locationGeoId:
 *                     type: integer
 *                   detailedAddress:
 *                     type: string
 *                   coveredGeoIds:
 *                     type: array
 *                     items:
 *                       type: integer
 *                   contactInfo:
 *                     type: array
 *                   status:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   locationGeoName:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, b.name,
             b.location_geo_id AS "locationGeoId",
             b.detailed_address AS "detailedAddress",
             b.covered_geo_ids AS "coveredGeoIds",
             COALESCE(b.contact_info, '[]'::jsonb) AS "contactInfo",
             b.status,
             b.created_at      AS "createdAt",
             g.name            AS "locationGeoName"
      FROM branches b
      LEFT JOIN geo_units g ON g.id = b.location_geo_id
      ORDER BY b.created_at DESC
    `);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching branches:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/branches/{id}:
 *   get:
 *     tags: [Branches]
 *     summary: Get a branch by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Branch details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 locationGeoId:
 *                   type: integer
 *                 status:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Branch not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.name,
              b.location_geo_id AS "locationGeoId",
              b.detailed_address AS "detailedAddress",
              b.covered_geo_ids AS "coveredGeoIds",
              COALESCE(b.contact_info, '[]'::jsonb) AS "contactInfo",
              b.status,
              b.created_at      AS "createdAt",
              g.name            AS "locationGeoName"
       FROM branches b
       LEFT JOIN geo_units g ON g.id = b.location_geo_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'الفرع غير موجود' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error fetching branch:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/branches:
 *   post:
 *     tags: [Branches]
 *     summary: Create a new branch
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               locationGeoId:
 *                 type: integer
 *               detailedAddress:
 *                 type: string
 *               coveredGeoIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               contactInfo:
 *                 type: array
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Created branch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('branches.manage'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, locationGeoId, detailedAddress, coveredGeoIds, contactInfo, status } = req.body;
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO branches (name, location_geo_id, detailed_address, covered_geo_ids, contact_info, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name,
                 location_geo_id AS "locationGeoId",
                 detailed_address AS "detailedAddress",
                 covered_geo_ids AS "coveredGeoIds",
                 COALESCE(contact_info, '[]'::jsonb) AS "contactInfo",
                 status,
                 created_at AS "createdAt"`,
      [
        name,
        locationGeoId || null,
        detailedAddress || null,
        JSON.stringify(coveredGeoIds || []),
        JSON.stringify(contactInfo || []),
        status || 'active',
      ]
    );
    const newBranch = rows[0];
    await client.query('COMMIT');
    res.json(newBranch);
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating branch:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/branches/{id}:
 *   put:
 *     tags: [Branches]
 *     summary: Update a branch
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               locationGeoId:
 *                 type: integer
 *               detailedAddress:
 *                 type: string
 *               coveredGeoIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               contactInfo:
 *                 type: array
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Updated branch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Branch not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('branches.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, locationGeoId, detailedAddress, coveredGeoIds, contactInfo, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE branches SET
         name            = $1,
         location_geo_id = $2,
         detailed_address = $3,
         covered_geo_ids = $4,
         contact_info    = $5,
         status          = $6
       WHERE id = $7
       RETURNING id, name,
                 location_geo_id AS "locationGeoId",
                 detailed_address AS "detailedAddress",
                 covered_geo_ids AS "coveredGeoIds",
                 COALESCE(contact_info, '[]'::jsonb) AS "contactInfo",
                 status,
                 created_at AS "createdAt"`,
      [
        name,
        locationGeoId || null,
        detailedAddress || null,
        JSON.stringify(coveredGeoIds || []),
        JSON.stringify(contactInfo || []),
        status || 'active',
        id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Branch not found' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error updating branch:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/branches/{id}:
 *   delete:
 *     tags: [Branches]
 *     summary: Delete a branch
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *     responses:
 *       200:
 *         description: Deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Branch not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('branches.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM branches WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Branch not found' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting branch:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
