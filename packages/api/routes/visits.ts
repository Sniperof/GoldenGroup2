import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Visit:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         date:
 *           type: string
 *         customerId:
 *           type: integer
 *         employeeId:
 *           type: integer
 *         employeeName:
 *           type: string
 *         outcome:
 *           type: string
 *         notes:
 *           type: string
 */

/**
 * @swagger
 * /api/visits:
 *   get:
 *     tags: [Visits]
 *     summary: Retrieve a list of visits
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         description: Optional branch ID filter
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Optional search query
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Optional page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Optional page size limit
 *     responses:
 *       200:
 *         description: List of visits
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Visit'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, date, customer_id AS "customerId", employee_id AS "employeeId",
      employee_name AS "employeeName", outcome, notes
    FROM visits ORDER BY date DESC
  `);
  res.json(rows);
});

/**
 * @swagger
 * /api/visits:
 *   post:
 *     tags: [Visits]
 *     summary: Create a new visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Visit'
 *     responses:
 *       201:
 *         description: Created visit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Visit'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const v = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO visits (id, date, customer_id, employee_id, employee_name, outcome, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, date, customer_id AS "customerId", employee_id AS "employeeId",
        employee_name AS "employeeName", outcome, notes`,
      [v.id, v.date, v.customerId, v.employeeId, v.employeeName, v.outcome || 'Pending', v.notes || null]
    );

    // FOP is no longer promoted by merely creating a visit.
    // It is derived from a closed device_demo task whose result is offer_presented.

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/visits/{id}:
 *   put:
 *     tags: [Visits]
 *     summary: Update an existing visit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The branch ID context header
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The visit ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Visit'
 *     responses:
 *       200:
 *         description: Updated visit
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Visit'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Visit not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const v = req.body;
  const { rows } = await pool.query(
    `UPDATE visits SET date=$1, customer_id=$2, employee_id=$3, employee_name=$4,
      outcome=$5, notes=$6 WHERE id=$7
    RETURNING id, date, customer_id AS "customerId", employee_id AS "employeeId",
      employee_name AS "employeeName", outcome, notes`,
    [v.date, v.customerId, v.employeeId, v.employeeName, v.outcome, v.notes || null, req.params.id]
  );
  res.json(rows[0]);
});

export default router;
