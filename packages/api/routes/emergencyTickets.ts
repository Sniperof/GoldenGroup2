import { Router } from 'express';
import pool from '../db.js';
import { persistOpenTaskSnapshots } from './openTasks.js';

const router = Router();

const SELECT_FIELDS = `
  et.id,
  et.client_id AS "clientId",
  et.client_name AS "clientName",
  et.client_address AS "clientAddress",
  et.client_rating AS "clientRating",
  et.contract_id AS "contractId",
  et.device_model_name AS "deviceModelName",
  et.problem_description AS "problemDescription",
  et.call_notes AS "callNotes",
  et.attachments,
  et.call_receiver AS "callReceiver",
  et.priority,
  et.status AS "ticketStatus",
  et.assigned_technician_id AS "assignedTechnicianId",
  et.open_task_id AS "openTaskId",
  et.created_at AS "createdAt",
  ot.status AS "openTaskStatus"
`;

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

async function loadTicketById(db: Queryable, ticketId: number) {
  const { rows } = await db.query(
    `SELECT ${SELECT_FIELDS}
     FROM emergency_tickets et
     LEFT JOIN open_tasks ot ON ot.id = et.open_task_id
     WHERE et.id = $1`,
    [ticketId],
  );
  return rows[0] ? mapTicketRow(rows[0]) : null;
}

function mapTicketRow(row: any) {
  return {
    ...row,
    status: row.openTaskStatus || row.ticketStatus || 'New',
  };
}

router.get('/', async (req, res) => {
  const openTaskId = req.query.openTaskId;
  let whereClause = '';
  const params: any[] = [];

  if (openTaskId) {
    whereClause = 'WHERE et.open_task_id = $1';
    params.push(Number(openTaskId));
  }

  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
     FROM emergency_tickets et
     LEFT JOIN open_tasks ot ON ot.id = et.open_task_id
     ${whereClause}
     ORDER BY et.id DESC`,
    params,
  );
  res.json(rows.map(mapTicketRow));
});

router.post('/', async (req, res) => {
  const ticket = req.body;
  const db = await pool.connect();

  try {
    await db.query('BEGIN');

    const { rows } = await db.query(
      `INSERT INTO emergency_tickets (
        client_id, client_name, client_address, client_rating, contract_id,
        device_model_name, problem_description, call_notes, attachments,
        call_receiver, priority, status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
      RETURNING id`,
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
        req.user?.name || req.user?.username || '—',
        ticket.priority || 'Normal',
        'New',
      ],
    );

    const createdTicketId = rows[0].id;
    const { rows: clientRows } = await db.query(
      'SELECT branch_id FROM clients WHERE id = $1',
      [ticket.clientId],
    );

    if (clientRows.length === 0) {
      await db.query('ROLLBACK');
      res.status(400).json({ message: 'الزبون غير موجود' });
      return;
    }

    const branchId = clientRows[0].branch_id ?? req.authContext?.actingBranchId ?? req.user?.branchId ?? null;
    if (!branchId) {
      await db.query('ROLLBACK');
      res.status(400).json({ message: 'يجب تحديد الفرع لإنشاء مهمة الصيانة الطارئة' });
      return;
    }

    const { rows: taskRows } = await db.query(
      `INSERT INTO open_tasks (
        client_id, branch_id, contract_id, task_type, task_family, reason, status, source, notes, created_by
      )
      VALUES ($1, $2, $3, 'emergency_maintenance', 'emergency', 'service_request', 'open', 'emergency_ticket', $4, $5)
      RETURNING id`,
      [
        ticket.clientId,
        branchId,
        ticket.contractId || null,
        ticket.problemDescription,
        req.user?.id ?? null,
      ],
    );

    await persistOpenTaskSnapshots(db, taskRows[0].id, ticket.clientId, ticket.contractId || null);

    const { rows: updatedRows } = await db.query(
      `UPDATE emergency_tickets
       SET open_task_id = $1
       WHERE id = $2
       RETURNING id`,
      [taskRows[0].id, createdTicketId],
    );

    const hydratedTicket = await loadTicketById(db, updatedRows[0].id);
    await db.query('COMMIT');
    res.json(hydratedTicket);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
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
      status=$12
    WHERE id=$13
    RETURNING id`,
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
      req.params.id,
    ],
  );

  if (!rows[0]) {
    res.status(404).json({ message: 'طلب الطوارئ غير موجود' });
    return;
  }

  const updatedTicket = await loadTicketById(pool, rows[0].id);
  res.json(updatedTicket);
});

export default router;
