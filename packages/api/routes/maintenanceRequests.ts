import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     MaintenanceRequest:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         requestDate:
 *           type: string
 *           format: date
 *         customerId:
 *           type: integer
 *         customerName:
 *           type: string
 *         contractId:
 *           type: integer
 *         deviceModelName:
 *           type: string
 *         priority:
 *           type: string
 *         problemDescription:
 *           type: string
 *         technicianId:
 *           type: integer
 *         telemarketerId:
 *           type: integer
 *         lastFollowUpDate:
 *           type: string
 *           format: date
 *         resolutionStatus:
 *           type: string
 *         visitType:
 *           type: string
 *         location:
 *           type: string
 *         notes:
 *           type: string
 *         technicalReport:
 *           type: object
 */

const selectFields = `
  id, request_date AS "requestDate", customer_id AS "customerId",
  customer_name AS "customerName", contract_id AS "contractId",
  device_model_name AS "deviceModelName", priority, problem_description AS "problemDescription",
  technician_id AS "technicianId", telemarketer_id AS "telemarketerId",
  last_follow_up_date AS "lastFollowUpDate", resolution_status AS "resolutionStatus",
  visit_type AS "visitType", location, notes, technical_report AS "technicalReport"
`;

/**
 * @swagger
 * /api/maintenance-requests:
 *   get:
 *     tags: [Maintenance]
 *     summary: List maintenance requests
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
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
 *         description: A list of maintenance requests
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MaintenanceRequest'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${selectFields} FROM maintenance_requests ORDER BY id`);
  res.json(rows);
});

/**
 * @swagger
 * /api/maintenance-requests:
 *   post:
 *     tags: [Maintenance]
 *     summary: Create a maintenance request
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MaintenanceRequest'
 *     responses:
 *       200:
 *         description: Created maintenance request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MaintenanceRequest'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const m = req.body;
  const { rows } = await pool.query(
    `INSERT INTO maintenance_requests (request_date, customer_id, customer_name, contract_id,
      device_model_name, priority, problem_description, technician_id, telemarketer_id,
      last_follow_up_date, resolution_status, visit_type, location, notes, technical_report)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${selectFields}`,
    [m.requestDate, m.customerId, m.customerName, m.contractId, m.deviceModelName,
     m.priority || 'Normal', m.problemDescription, m.technicianId || null,
     m.telemarketerId || null, m.lastFollowUpDate || null, m.resolutionStatus || 'Pending',
     m.visitType, m.location, m.notes || null,
     m.technicalReport ? JSON.stringify(m.technicalReport) : null]
  );
  res.json(rows[0]);
});

/**
 * @swagger
 * /api/maintenance-requests/{id}:
 *   put:
 *     tags: [Maintenance]
 *     summary: Update a maintenance request
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Maintenance request ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MaintenanceRequest'
 *     responses:
 *       200:
 *         description: Updated maintenance request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MaintenanceRequest'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const m = req.body;
  const { rows } = await pool.query(
    `UPDATE maintenance_requests SET request_date=$1, customer_id=$2, customer_name=$3,
      contract_id=$4, device_model_name=$5, priority=$6, problem_description=$7,
      technician_id=$8, telemarketer_id=$9, last_follow_up_date=$10,
      resolution_status=$11, visit_type=$12, location=$13, notes=$14, technical_report=$15
    WHERE id=$16 RETURNING ${selectFields}`,
    [m.requestDate, m.customerId, m.customerName, m.contractId, m.deviceModelName,
     m.priority || 'Normal', m.problemDescription, m.technicianId || null,
     m.telemarketerId || null, m.lastFollowUpDate || null, m.resolutionStatus || 'Pending',
     m.visitType, m.location, m.notes || null,
     m.technicalReport ? JSON.stringify(m.technicalReport) : null, req.params.id]
  );
  res.json(rows[0]);
});

export default router;
