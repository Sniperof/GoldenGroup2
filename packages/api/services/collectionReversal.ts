// ============================================================
// collectionReversal.ts — «عكس التحصيل» (owner decision D3, migr 496)
// ============================================================
// A recorded installment collection is corrected by REVERSAL, never by editing
// or deleting ledger rows. For the latest paid result of a collection task:
//   * each payment entry of that result gets a mirror refund entry
//     (reverses_entry_id) → the balance recompute restores the installment;
//     USD-linked rows carry usd_settled, so the remaining USD is restored too;
//   * each entry's ledger payment gets an opposite refund movement
//     (reverses_id) described «عكس دفعة … — السبب: …» → the statement nets to
//     the pre-collection balance;
//   * each FX-ledger row gets an opposite row (reverses_id) → nets to zero;
//   * the collection task becomes collectable again (same visit when it is
//     still open, else back to the waiting queue); an unstarted follow-up task
//     created by the result is cancelled; the result is stamped reversed.
// Contract and maintenance installments only (golden warranty out of scope).
// A result can be reversed once; after a new result is recorded on the task,
// that new result can be reversed on its own.
// ============================================================

import type { PoolClient } from 'pg';

export class CollectionReversalError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CollectionReversalError';
    this.status = status;
  }
}

export interface CollectionReversalResult {
  visitTaskResultId: number;
  kind: 'contract' | 'maintenance';
  installmentId: number;
  reversedEntryIds: number[];
  refundEntryIds: number[];
  fxReversalIds: number[];
  cancelledFollowupTaskId: number | null;
  openTaskStatus: string;
}

/** Loads the target (task → latest paid, not-yet-reversed result) and its branch for authorization. */
export async function loadReversalTarget(db: PoolClient | { query: PoolClient['query'] }, openTaskId: number) {
  const { rows } = await db.query(
    `SELECT ot.id AS open_task_id, ot.branch_id, ot.client_id, ot.task_type, ot.status AS open_task_status,
            ot.installment_id, ot.maintenance_installment_id, ot.warranty_installment_id,
            vt.id AS visit_task_id, vt.field_visit_id, fv.status AS visit_status,
            vtr.id AS visit_task_result_id, vtr.final_decision,
            s.id AS side_id, s.paid_amount_syp, s.payment_entry_id, s.reversed_at,
            s.created_followup_task_id
       FROM open_tasks ot
       JOIN visit_tasks vt ON vt.source_open_task_id = ot.id
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       JOIN visit_task_installment_collection_results s ON s.visit_task_result_id = vtr.id
      WHERE ot.id = $1 AND ot.task_type = 'installment_collection'
      ORDER BY vtr.closed_at DESC NULLS LAST, vtr.id DESC
      LIMIT 1`,
    [openTaskId],
  );
  return rows[0] ?? null;
}

export async function reverseInstallmentCollection(
  db: PoolClient,
  openTaskId: number,
  reason: string,
  userId: number,
): Promise<CollectionReversalResult> {
  const why = (reason ?? '').trim();
  if (!why) throw new CollectionReversalError('سبب عكس التحصيل مطلوب');

  const t = await loadReversalTarget(db, openTaskId);
  if (!t) throw new CollectionReversalError('لا توجد نتيجة تحصيل مسجَّلة على هذه المهمة', 404);
  if (t.warranty_installment_id) {
    throw new CollectionReversalError('عكس التحصيل غير متاح لأقساط الكفالة الذهبية');
  }
  if (t.paid_amount_syp == null) {
    throw new CollectionReversalError('النتيجة المسجَّلة لا تتضمن دفعة لعكسها');
  }
  if (t.reversed_at) {
    throw new CollectionReversalError('تم عكس هذا التحصيل سابقاً — لا يمكن عكسه مرتين', 409);
  }
  // Lock the result row: two reversals cannot race.
  await db.query('SELECT id FROM visit_task_installment_collection_results WHERE id = $1 FOR UPDATE', [t.side_id]);
  const { rows: again } = await db.query(
    'SELECT reversed_at FROM visit_task_installment_collection_results WHERE id = $1', [t.side_id],
  );
  if (again[0]?.reversed_at) {
    throw new CollectionReversalError('تم عكس هذا التحصيل سابقاً — لا يمكن عكسه مرتين', 409);
  }

  const kind: 'contract' | 'maintenance' = t.installment_id ? 'contract' : 'maintenance';
  const installmentId = Number(kind === 'contract' ? t.installment_id : t.maintenance_installment_id);
  const vtrId = Number(t.visit_task_result_id);
  const table = kind === 'contract' ? 'contract_payment_entries' : 'emergency_payment_entries';
  const tsCol = kind === 'contract' ? 'received_at' : 'created_at';
  const movementSource = kind === 'contract' ? 'contract_payment' : 'maintenance_installment_payment';

  // Lock the installment row (balance is recomputed below).
  await db.query(
    `SELECT id FROM ${kind === 'contract' ? 'contract_installments' : 'emergency_installments'} WHERE id = $1 FOR UPDATE`,
    [installmentId],
  );

  // Owner decision (2026-11-14): no reversal on a cancelled contract — the
  // cancellation already wrote off the remainder, so a reversal would leave a
  // debt nobody collects on a closed contract. A completed contract is allowed
  // (a wrong «paid in full» on the last installment) and goes back to active.
  let reopenContractId: number | null = null;
  if (kind === 'contract') {
    const { rows: cRows } = await db.query(
      `SELECT c.id, c.status FROM contracts c
         JOIN contract_installments i ON i.contract_id = c.id
        WHERE i.id = $1 FOR UPDATE OF c`,
      [installmentId],
    );
    const contractStatus = String(cRows[0]?.status ?? '');
    if (contractStatus === 'cancelled') {
      throw new CollectionReversalError('لا يمكن عكس تحصيل على عقد ملغى. راجع الإدارة لمعالجة التصحيح.', 409);
    }
    if (contractStatus === 'completed') reopenContractId = Number(cRows[0].id);
  }

  // Entries of the result: linked by visit_task_result_id (migr 496); older
  // results fall back to the recorded first entry + its transaction siblings.
  let { rows: entries } = await db.query(
    `SELECT * FROM ${table}
      WHERE visit_task_result_id = $1 AND entry_type = 'collection' AND installment_id = $2
        AND NOT EXISTS (SELECT 1 FROM ${table} r WHERE r.reverses_entry_id = ${table}.id)
      ORDER BY id`,
    [vtrId, installmentId],
  );
  if (entries.length === 0 && t.payment_entry_id) {
    ({ rows: entries } = await db.query(
      `SELECT e.* FROM ${table} e
        JOIN ${table} first ON first.id = $1
       WHERE e.installment_id = $2 AND e.entry_type = 'collection'
         AND e.${tsCol} = first.${tsCol}
         AND NOT EXISTS (SELECT 1 FROM ${table} r WHERE r.reverses_entry_id = e.id)
       ORDER BY e.id`,
      [Number(t.payment_entry_id), installmentId],
    ));
  }
  if (entries.length === 0) throw new CollectionReversalError('لم يُعثر على دفعات غير معكوسة لهذه النتيجة', 409);

  const note = `عكس التحصيل — السبب: ${why}`;
  const refundIds: number[] = [];
  const fxIds: number[] = [];
  for (const e of entries) {
    // 1) mirror refund entry
    let refundId: number;
    if (kind === 'contract') {
      const { rows } = await db.query(
        `INSERT INTO contract_payment_entries
           (contract_id, method, currency, amount_value, exchange_rate, amount_syp,
            reference_number, barter_name, barter_value_syp, received_by_employee_id, notes,
            entry_type, installment_id, collected_syp, usd_settled, day_rate, ref_rate, ref_usd,
            visit_task_result_id, reverses_entry_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'refund',$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id`,
        [e.contract_id, e.method, e.currency, e.amount_value, e.exchange_rate, e.amount_syp,
         e.reference_number, e.barter_name, e.barter_value_syp, userId, note,
         e.installment_id, e.collected_syp, e.usd_settled, e.day_rate, e.ref_rate, e.ref_usd,
         vtrId, e.id],
      );
      refundId = Number(rows[0].id);
    } else {
      const { rows } = await db.query(
        `INSERT INTO emergency_payment_entries
           (costs_id, method, amount_value, currency, exchange_rate, amount_syp, transfer_company_id,
            barter_description, sort_order, installment_id, collected_syp, usd_settled, day_rate,
            ref_rate, ref_usd, entry_type, visit_task_result_id, reverses_entry_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'refund',$16,$17,$18)
         RETURNING id`,
        [e.costs_id, e.method, e.amount_value, e.currency, e.exchange_rate, e.amount_syp,
         e.transfer_company_id, e.barter_description, e.sort_order, e.installment_id,
         e.collected_syp, e.usd_settled, e.day_rate, e.ref_rate, e.ref_usd, vtrId, e.id, note],
      );
      refundId = Number(rows[0].id);
    }
    refundIds.push(refundId);

    // 2) opposite ledger movement (only when the payment reached the ledger)
    const { rows: mv } = await db.query(
      `SELECT * FROM financial_movements
        WHERE source_type = $1 AND source_ref_id = $2 AND kind = 'payment'
        ORDER BY id LIMIT 1`,
      [movementSource, Number(e.id)],
    );
    const original = mv[0];
    if (original) {
      await db.query(
        `INSERT INTO financial_movements (
           client_id, occurred_at, kind, amount_syp, currency, amount_original, exchange_rate,
           source_type, source_id, source_ref_id, contract_id, description, reference_no,
           occurred_branch_id, recorded_by, reverses_id, notes
         ) VALUES ($1, NOW(), 'refund', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [original.client_id, original.amount_syp, original.currency, original.amount_original,
         original.exchange_rate, movementSource, original.source_id, refundId, original.contract_id,
         `عكس دفعة: ${original.description} — السبب: ${why}`, original.reference_no,
         original.occurred_branch_id, userId, original.id, why],
      );
    }

    // 3) opposite FX-ledger row(s)
    const fxCol = kind === 'contract' ? 'payment_entry_id' : 'maintenance_payment_entry_id';
    const { rows: fxRows } = await db.query(
      `SELECT * FROM branch_fx_differences WHERE ${fxCol} = $1 AND reverses_id IS NULL ORDER BY id`,
      [Number(e.id)],
    );
    for (const f of fxRows) {
      const { rows: ins } = await db.query(
        `INSERT INTO branch_fx_differences
           (branch_id, source_kind, contract_id, installment_id, payment_entry_id, visit_task_result_id,
            contract_rate, day_rate, usd_settled, collected_syp, settled_syp, difference_syp, recorded_by,
            maintenance_installment_id, maintenance_payment_entry_id, open_task_id, reverses_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [f.branch_id, f.source_kind, f.contract_id, f.installment_id,
         kind === 'contract' ? refundId : null, f.visit_task_result_id,
         f.contract_rate, f.day_rate, -Number(f.usd_settled), -Number(f.collected_syp),
         -Number(f.settled_syp), -Number(f.difference_syp), userId,
         f.maintenance_installment_id, kind === 'maintenance' ? refundId : null, f.open_task_id, f.id],
      );
      fxIds.push(Number(ins[0].id));
    }
  }

  // 4) balances (contract entries recompute through their trigger as well)
  if (kind === 'contract') {
    await db.query('SELECT recompute_installment_balance($1)', [installmentId]);
    // A completed contract owes money again → back to active (completion only
    // ever advances active → completed, it never reopens on its own).
    if (reopenContractId != null) {
      await db.query(
        // Re-fires the activation triggers; both are idempotent (device already
        // materialized; balances recomputed).
        `UPDATE contracts SET status = 'active' WHERE id = $1 AND status = 'completed'`,
        [reopenContractId],
      );
    }
  } else {
    await db.query('SELECT recompute_maintenance_installment_balance($1)', [installmentId]);
  }

  // 5) follow-up task created by the reversed result: cancel it if not started
  let cancelledFollowup: number | null = null;
  if (t.created_followup_task_id) {
    const { rows: fu } = await db.query(
      `UPDATE open_tasks
          SET status = 'cancelled',
              cancellation_reason = 'collection_reversed',
              updated_at = NOW()
        WHERE id = $1 AND status IN ('open', 'needs_follow_up')
        RETURNING id`,
      [Number(t.created_followup_task_id)],
    );
    if (fu[0]) {
      cancelledFollowup = Number(fu[0].id);
      await db.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, old_value, new_value, reason, created_at)
         VALUES ($1, 'status_change', $2, NULL, 'cancelled', 'collection_reversed', NOW())`,
        [cancelledFollowup, userId],
      );
    }
  }

  // 6) the collection task is collectable again
  const sameVisit = ['in_progress', 'ended', 'completed'].includes(String(t.visit_status));
  const newOpenStatus = sameVisit ? 'in_execution' : 'open';
  await db.query(
    `UPDATE open_tasks SET status = $2, updated_at = NOW() WHERE id = $1`,
    [openTaskId, newOpenStatus],
  );
  await db.query(
    `UPDATE visit_tasks SET status = $2, updated_at = NOW() WHERE id = $1`,
    [Number(t.visit_task_id), sameVisit ? 'in_progress' : 'cancelled'],
  );
  await db.query(
    `UPDATE visit_task_installment_collection_results
        SET reversed_at = NOW(), reversed_by = $2, reversal_reason = $3, updated_at = NOW()
      WHERE id = $1`,
    [t.side_id, userId, why],
  );
  await db.query(
    `INSERT INTO task_activity_log (task_id, event_type, performed_by, old_value, new_value, reason, reference_id, created_at)
     VALUES ($1, 'status_change', $2, $3, $4, $5, $6, NOW())`,
    [openTaskId, userId, String(t.open_task_status ?? ''), newOpenStatus, `collection_reversed: ${why}`, vtrId],
  );

  return {
    visitTaskResultId: vtrId,
    kind,
    installmentId,
    reversedEntryIds: entries.map((e: any) => Number(e.id)),
    refundEntryIds: refundIds,
    fxReversalIds: fxIds,
    cancelledFollowupTaskId: cancelledFollowup,
    openTaskStatus: newOpenStatus,
  };
}
