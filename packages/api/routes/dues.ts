// DEPRECATED route — kept temporarily as a read adapter (DEC-CT-06).
//
// `dues` as a standalone entity is dismissed. The remaining balance lives on
// `contract_installments`. This file rewrites GET /api/dues to project
// installment rows into the legacy Due shape so existing UI keeps working
// while we migrate the front-end (CT-IMPL-004 follow-up).
//
// The PUT endpoint is intentionally narrowed:
//   - editable: collection ownership (collection_owner_id).
//   - everything else (status / balances / type) is now derived and rejects edits.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';

const router = Router();
router.use(requireAuth);

// Map installment row → legacy Due shape.
// `id` is the installment id (front-end will see a single namespace).
function mapInstallmentAsDue(row: any) {
  // Legacy Due.status used Capitalized values; map from installment lowercase.
  const statusMap: Record<string, string> = {
    pending: 'Pending',
    partial: 'Partial',
    paid:    'Paid',
    overdue: 'Overdue',
  };
  return {
    id:                     row.id,
    contractId:             row.contract_id,
    type:                   'Installment',                // legacy DueType
    scheduledDate:          row.due_date,
    adjustedDate:           row.due_date,                 // no separate adjusted date anymore
    originalAmount:         Number(row.amount_syp),
    remainingBalance:       Number(row.remaining_balance),
    assignedTelemarketerId: row.collection_owner_id,      // DEC-CT-12: owner on installment
    status:                 statusMap[row.status] ?? row.status,
    escalated:              false,                        // legacy flag — no replacement
  };
}

// GET /api/dues — projection of unsettled installments.
router.get('/', requirePermission('contracts.view_list'), async (req, res) => {
  const authContext = req.authContext!;
  const conditions: string[] = ['i.remaining_balance > 0'];
  const params: any[] = [];

  if (!authContext.isSuperAdmin) {
    conditions.push(`c.branch_id = $${params.push(authContext.actingBranchId)}`);
  } else {
    const hb = Number(req.headers['x-branch-id'] ?? req.query.branchId);
    if (Number.isFinite(hb) && hb > 0) conditions.push(`c.branch_id = $${params.push(hb)}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows } = await pool.query(
    `SELECT i.id, i.contract_id, i.due_date, i.amount_syp, i.remaining_balance,
            i.collection_owner_id, i.status
       FROM contract_installments i
       JOIN contracts c ON c.id = i.contract_id
       ${where}
       ORDER BY i.contract_id, i.installment_number`,
    params,
  );
  res.json(rows.map(mapInstallmentAsDue));
});

// PUT /api/dues/:id — now only edits collection ownership.
// `id` here is the installment id (DEC-CT-06 unified them).
router.put('/:id', requirePermission('contracts.edit'), async (req, res) => {
  const authContext = req.authContext!;
  const id = req.params.id;
  const b  = req.body ?? {};

  const { rows: existing } = await pool.query(
    `SELECT i.id, i.contract_id, c.branch_id
       FROM contract_installments i
       JOIN contracts c ON c.id = i.contract_id
      WHERE i.id = $1`,
    [id],
  );
  if (!existing[0]) return res.status(404).json({ error: 'القسط غير موجود' });

  const access = authorize(authContext, { permission: 'contracts.edit', branchId: existing[0].branch_id });
  if (!access.allowed) return res.status(403).json({ error: 'غير مسموح' });

  // Only collection ownership is editable. Reject attempts to set derived fields.
  if (b.status !== undefined || b.remainingBalance !== undefined || b.originalAmount !== undefined) {
    return res.status(400).json({
      error: 'الحالة والرصيد محسوبان من الدفعات. عدّل الدفعات لا الذمة. (DEC-CT-06)',
    });
  }

  const nextOwner = b.assignedTelemarketerId === undefined
    ? null
    : (b.assignedTelemarketerId || null);

  const { rows } = await pool.query(
    `UPDATE contract_installments
        SET collection_owner_id = $1
      WHERE id = $2
      RETURNING id, contract_id, due_date, amount_syp, remaining_balance,
                collection_owner_id, status`,
    [nextOwner, id],
  );
  res.json(rows[0] ? mapInstallmentAsDue(rows[0]) : null);
});

export default router;
