import { Router } from 'express';
import pool from '../db.js';
import { parsePagination, hasPaginationParams, paginatedResponse } from '../utils/paginate.js';

const router = Router();

const selectFields = `
  id, contract_id AS "contractId", type, scheduled_date AS "scheduledDate",
  adjusted_date AS "adjustedDate", original_amount AS "originalAmount",
  remaining_balance AS "remainingBalance", assigned_telemarketer_id AS "assignedTelemarketerId",
  status, escalated
`;

const mapDue = (d: any) => ({ ...d, originalAmount: Number(d.originalAmount), remainingBalance: Number(d.remainingBalance) });

router.get('/', async (req, res) => {
  if (hasPaginationParams(req.query)) {
    const { page, limit, offset } = parsePagination(req.query);
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(`SELECT ${selectFields} FROM dues ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query(`SELECT COUNT(*) FROM dues`),
    ]);
    res.json(paginatedResponse(rows.map(mapDue), parseInt(countRows[0].count), page, limit));
  } else {
    const { rows } = await pool.query(`SELECT ${selectFields} FROM dues ORDER BY id`);
    res.json(rows.map(mapDue));
  }
});

router.put('/:id', async (req, res) => {
  const d = req.body;
  const id = req.params.id;

  const { rows: existing } = await pool.query(`SELECT ${selectFields} FROM dues WHERE id=$1`, [id]);
  if (!existing[0]) {
    res.status(404).json({ error: 'Due not found' });
    return;
  }

  const current = existing[0];
  const merged = {
    type: d.type ?? current.type,
    scheduledDate: d.scheduledDate ?? current.scheduledDate,
    adjustedDate: d.adjustedDate ?? current.adjustedDate,
    originalAmount: d.originalAmount ?? current.originalAmount,
    remainingBalance: d.remainingBalance ?? current.remainingBalance,
    assignedTelemarketerId: d.assignedTelemarketerId !== undefined ? d.assignedTelemarketerId : current.assignedTelemarketerId,
    status: d.status ?? current.status,
    escalated: d.escalated !== undefined ? d.escalated : current.escalated,
  };

  const { rows } = await pool.query(
    `UPDATE dues SET type=$1, scheduled_date=$2, adjusted_date=$3,
      original_amount=$4, remaining_balance=$5, assigned_telemarketer_id=$6,
      status=$7, escalated=$8 WHERE id=$9 RETURNING ${selectFields}`,
    [merged.type, merged.scheduledDate, merged.adjustedDate, merged.originalAmount, merged.remainingBalance,
     merged.assignedTelemarketerId || null, merged.status, merged.escalated || false, id]
  );
  res.json(rows[0] ? { ...rows[0], originalAmount: Number(rows[0].originalAmount), remainingBalance: Number(rows[0].remainingBalance) } : null);
});

export default router;
