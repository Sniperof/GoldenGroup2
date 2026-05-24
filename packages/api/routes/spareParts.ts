import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     SparePart:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         code:
 *           type: string
 *         basePrice:
 *           type: number
 *         maintenanceType:
 *           type: string
 *         compatibleDeviceIds:
 *           type: array
 *           items:
 *             type: integer
 */

/**
 * @swagger
 * /api/spare-parts:
 *   get:
 *     tags: [Spare Parts]
 *     summary: Retrieve list of spare parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
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
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SparePart'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType",
      compatible_device_ids AS "compatibleDeviceIds"
    FROM spare_parts ORDER BY id
  `);
  res.json(rows.map(r => ({ ...r, basePrice: Number(r.basePrice) })));
});

/**
 * @swagger
 * /api/spare-parts:
 *   post:
 *     tags: [Spare Parts]
 *     summary: Create new spare part
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, basePrice]
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               basePrice:
 *                 type: number
 *               maintenanceType:
 *                 type: string
 *               compatibleDeviceIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SparePart'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const s = req.body;
  const { rows } = await pool.query(
    `INSERT INTO spare_parts (name, code, base_price, maintenance_type, compatible_device_ids)
    VALUES ($1,$2,$3,$4,$5) RETURNING id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType", compatible_device_ids AS "compatibleDeviceIds"`,
    [s.name, s.code, s.basePrice, s.maintenanceType, JSON.stringify(s.compatibleDeviceIds || [])]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

/**
 * @swagger
 * /api/spare-parts/{id}:
 *   put:
 *     tags: [Spare Parts]
 *     summary: Update spare part details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Spare Part ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               basePrice:
 *                 type: number
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SparePart'
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const s = req.body;
  const { rows } = await pool.query(
    `UPDATE spare_parts SET name=$1, code=$2, base_price=$3, maintenance_type=$4,
      compatible_device_ids=$5 WHERE id=$6
    RETURNING id, name, code, base_price AS "basePrice",
      maintenance_type AS "maintenanceType", compatible_device_ids AS "compatibleDeviceIds"`,
    [s.name, s.code, s.basePrice, s.maintenanceType, JSON.stringify(s.compatibleDeviceIds || []), req.params.id]
  );
  res.json({ ...rows[0], basePrice: Number(rows[0].basePrice) });
});

/**
 * @swagger
 * /api/spare-parts/{id}:
 *   delete:
 *     tags: [Spare Parts]
 *     summary: Delete spare part by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Spare Part ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM spare_parts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
