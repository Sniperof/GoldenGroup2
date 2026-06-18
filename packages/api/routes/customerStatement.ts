// DEC-CT-10: customer_statement — derived view over installments + payment_entries.
//
// This is intentionally not a ledger (no double-entry). It's a chronological
// merge of two source-of-truth tables, surfaced for the customer's view:
//
//   - contract_installments         → scheduled receivables (due dates)
//   - contract_payment_entries      → actual cash in/out (entry_type: collection|refund)
//
// Output rows are tagged by `kind` so the front-end can render them inline.
// A running balance is computed in SQL — the client doesn't need to know
// the arithmetic.
//
// Mounted at /api/customers/:id/statement by api/index.ts.

import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/:id/statement',
  requirePermission('clients.account_statement.view', 'contracts.view_list'),
  async (req, res) => {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'customerId غير صالح' });
    }

    // Single chronological stream: installments as "charges", payments as "credits".
    // amount sign convention (for running balance):
    //   installment       → +amount      (the customer owes)
    //   collection entry  → -amount      (paid down)
    //   refund   entry    → +amount      (added back to liability after cancellation)
    const sql = `
      WITH stream AS (
        SELECT
          'installment'                                         AS kind,
          i.id                                                  AS source_id,
          c.id                                                  AS contract_id,
          c.contract_number                                     AS contract_number,
          i.due_date                                            AS event_date,
          i.amount_syp                                          AS amount,
          i.amount_syp                                          AS signed_amount,
          i.status                                              AS status,
          NULL::varchar                                         AS method,
          NULL::varchar                                         AS entry_type,
          'استحقاق قسط رقم ' || i.installment_number            AS description
        FROM contract_installments i
        JOIN contracts c ON c.id = i.contract_id
        WHERE c.customer_id = $1
          AND c.status IN ('active', 'completed', 'cancelled')

        UNION ALL

        SELECT
          'payment'                                              AS kind,
          p.id                                                   AS source_id,
          c.id                                                   AS contract_id,
          c.contract_number                                      AS contract_number,
          p.received_at::date                                    AS event_date,
          p.amount_syp                                           AS amount,
          CASE WHEN p.entry_type = 'refund' THEN p.amount_syp
               ELSE -p.amount_syp END                            AS signed_amount,
          p.entry_type                                           AS status,
          p.method                                               AS method,
          p.entry_type                                           AS entry_type,
          CASE WHEN p.entry_type = 'refund' THEN 'مبلغ مرتجع'
               ELSE 'دفعة قبض' END                               AS description
        FROM contract_payment_entries p
        JOIN contracts c ON c.id = p.contract_id
        WHERE c.customer_id = $1
          -- Draft contracts have no financial effect — their payment entries
          -- must not surface in the statement (matches the installments filter).
          AND c.status IN ('active', 'completed', 'cancelled')
      )
      SELECT
        kind, source_id, contract_id, contract_number, event_date,
        amount, status, method, entry_type, description,
        SUM(signed_amount) OVER (
          ORDER BY event_date, kind DESC, source_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_balance
      FROM stream
      ORDER BY event_date, kind DESC, source_id
    `;

    const { rows } = await pool.query(sql, [customerId]);

    res.json({
      customerId,
      entries: rows.map(r => ({
        kind:            r.kind,                            // 'installment' | 'payment'
        sourceId:        r.source_id,
        contractId:      r.contract_id,
        contractNumber:  r.contract_number,
        eventDate:       r.event_date,
        amount:          Number(r.amount),
        status:          r.status,
        method:          r.method,
        entryType:       r.entry_type,                      // null for installments
        description:     r.description,
        runningBalance:  Number(r.running_balance),
      })),
    });
  },
);

export default router;
