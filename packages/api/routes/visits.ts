import { Router } from 'express';
import pool from '../db.js';
import { promoteClientToLifecycleStatus } from '../services/clientLifecycleService.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, date, customer_id AS "customerId", employee_id AS "employeeId",
      employee_name AS "employeeName", outcome, notes
    FROM visits ORDER BY date DESC
  `);
  res.json(rows);
});

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

    // FOP promotion: client has been visited → company ownership, no personal assignments
    // Guard inside helper prevents demoting an OP client
    if (v.customerId) {
      await promoteClientToLifecycleStatus(client, Number(v.customerId), 'FOP');
    }

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

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
