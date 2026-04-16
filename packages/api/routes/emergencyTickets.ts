import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const SELECT_FIELDS = `
  id,
  client_id AS "clientId",
  client_name AS "clientName",
  client_address AS "clientAddress",
  client_rating AS "clientRating",
  contract_id AS "contractId",
  device_model_name AS "deviceModelName",
  problem_description AS "problemDescription",
  call_notes AS "callNotes",
  attachments,
  call_receiver AS "callReceiver",
  priority,
  status,
  assigned_technician_id AS "assignedTechnicianId",
  created_at AS "createdAt"
`;

router.get('/', async (req, res) => {
  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT ${SELECT_FIELDS} FROM emergency_tickets ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM emergency_tickets`),
    ]);
    res.json(paginatedResponse(rows, parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(`SELECT ${SELECT_FIELDS} FROM emergency_tickets ORDER BY id DESC`);
    res.json(rows);
  }
});

router.post('/', async (req, res) => {
  const ticket = req.body;
  const { rows } = await pool.query(
    `INSERT INTO emergency_tickets (
      client_id, client_name, client_address, client_rating, contract_id,
      device_model_name, problem_description, call_notes, attachments,
      call_receiver, priority, status, assigned_technician_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
    RETURNING ${SELECT_FIELDS}`,
    [
      ticket.clientId,
      ticket.clientName,
      ticket.clientAddress || null,
      ticket.clientRating || 'Undefined',
      ticket.contractId || null,
      ticket.deviceModelName || null,
      ticket.problemDescription,
      ticket.callNotes || null,
      JSON.stringify(ticket.attachments || []),
      ticket.callReceiver,
      ticket.priority || 'Normal',
      ticket.status || 'New',
      ticket.assignedTechnicianId || null,
    ],
  );

  res.json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const ticket = req.body;
  const { rows } = await pool.query(
    `UPDATE emergency_tickets SET
      client_id=$1,
      client_name=$2,
      client_address=$3,
      client_rating=$4,
      contract_id=$5,
      device_model_name=$6,
      problem_description=$7,
      call_notes=$8,
      attachments=$9::jsonb,
      call_receiver=$10,
      priority=$11,
      status=$12,
      assigned_technician_id=$13
    WHERE id=$14
    RETURNING ${SELECT_FIELDS}`,
    [
      ticket.clientId,
      ticket.clientName,
      ticket.clientAddress || null,
      ticket.clientRating || 'Undefined',
      ticket.contractId || null,
      ticket.deviceModelName || null,
      ticket.problemDescription,
      ticket.callNotes || null,
      JSON.stringify(ticket.attachments || []),
      ticket.callReceiver,
      ticket.priority || 'Normal',
      ticket.status || 'New',
      ticket.assignedTechnicianId || null,
      req.params.id,
    ],
  );

  if (!rows[0]) {
    res.status(404).json({ message: 'طلب الطوارئ غير موجود' });
    return;
  }

  res.json(rows[0]);
});

export default router;
