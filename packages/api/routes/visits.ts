import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const VISITS_SELECT = `
  SELECT id, date, customer_id AS "customerId", employee_id AS "employeeId",
    employee_name AS "employeeName", outcome, notes
  FROM visits
`;

router.get('/', async (req, res) => {
  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(`${VISITS_SELECT} ORDER BY date DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query(`SELECT COUNT(*) FROM visits`),
    ]);
    res.json(paginatedResponse(rows, parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(`${VISITS_SELECT} ORDER BY date DESC`);
    res.json(rows);
  }
});

router.post('/', async (req, res) => {
  const v = req.body;
  const { rows } = await pool.query(
    `INSERT INTO visits (id, date, customer_id, employee_id, employee_name, outcome, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, date, customer_id AS "customerId", employee_id AS "employeeId",
      employee_name AS "employeeName", outcome, notes`,
    [v.id, v.date, v.customerId, v.employeeId, v.employeeName, v.outcome || 'Pending', v.notes || null]
  );
  res.json(rows[0]);
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
