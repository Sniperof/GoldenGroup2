import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const selectFields = `
  id, request_date AS "requestDate", customer_id AS "customerId",
  customer_name AS "customerName", contract_id AS "contractId",
  device_model_name AS "deviceModelName", priority, problem_description AS "problemDescription",
  technician_id AS "technicianId", telemarketer_id AS "telemarketerId",
  last_follow_up_date AS "lastFollowUpDate", resolution_status AS "resolutionStatus",
  visit_type AS "visitType", location, notes, technical_report AS "technicalReport"
`;

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${selectFields} FROM maintenance_requests ORDER BY id`);
  res.json(rows);
});

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
