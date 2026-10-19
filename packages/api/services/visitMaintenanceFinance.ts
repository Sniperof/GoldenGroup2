import type { Pool, PoolClient } from 'pg';

/**
 * Parts and money of each maintenance task (periodic / emergency) inside a visit, for
 * the visit detail page. The visit shows what happened IN THIS VISIT; a re-attempted
 * task adds one cumulative line (user decision 2026-10-19).
 *
 * Two storage paths, read side by side:
 *   live     — emergency_result_parts (visit_task_id, migr 483) + emergency_result_costs,
 *              per-attempt ledger rows (source_ref_id = visit_task id), installment plan.
 *   migrated — visit_task_emergency_parts_used + visit_task_emergency_financials, both
 *              keyed by the visit task's result (one result per visit).
 */

type Db = Pick<Pool | PoolClient, 'query'>;

const MAINTENANCE_TYPES = new Set(['periodic_maintenance', 'emergency_maintenance']);
const ATTEMPT_SOURCE_TYPES = ['periodic_maintenance', 'emergency_maintenance'];
const TASK_MONEY_SOURCE_TYPES = [
  'periodic_maintenance', 'emergency_maintenance', 'maintenance_installment', 'maintenance_installment_payment',
];

export interface MaintenancePart {
  name: string;
  code: string | null;
  maintenanceType: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  executionStatus: string | null;
  customerDecision: string | null;
  visitId?: number | null;
  visitDate?: string | null;
}

export interface MaintenanceFinance {
  source: 'live' | 'migrated';
  parts: MaintenancePart[];
  /** Parts recorded in earlier visits of the same task (read-only context). */
  previousParts: MaintenancePart[];
  /** Money booked in THIS visit. */
  attempt: { charge: number; paid: number; paymentMethod: string | null };
  /** The task as a whole — only when it spans more than one visit (live path). */
  cumulative: { totalCost: number; totalPaid: number; remaining: number; attempts: number } | null;
  paymentType: string | null;
  installments: Array<{
    installmentNumber: number; dueDate: string; amount: number; paid: number; remaining: number; status: string;
  }>;
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

function mapPart(p: any): MaintenancePart {
  const quantity = num(p.quantity) || 1;
  const unitPrice = num(p.unit_price);
  return {
    name: p.part_name_snapshot,
    code: p.part_code_snapshot ?? null,
    maintenanceType: p.maintenance_type ?? null,
    quantity,
    unitPrice,
    lineTotal: p.line_total != null ? num(p.line_total) : quantity * unitPrice,
    executionStatus: p.execution_status ?? null,
    customerDecision: p.customer_decision ?? null,
    visitId: p.field_visit_id ?? null,
    visitDate: p.scheduled_date ?? null,
  };
}

export async function loadVisitMaintenanceFinance(
  db: Db,
  tasks: Array<{ id: number | string; task_type: string; source_open_task_id?: number | string | null; result_id?: number | string | null }>,
): Promise<Map<number, MaintenanceFinance>> {
  const out = new Map<number, MaintenanceFinance>();
  const maint = tasks.filter((t) => MAINTENANCE_TYPES.has(t.task_type));
  if (maint.length === 0) return out;

  const vtIds = maint.map((t) => Number(t.id));
  const openTaskIds = [...new Set(maint.map((t) => Number(t.source_open_task_id)).filter((n) => n > 0))];

  const [migParts, migMoney, liveParts, costs, attempts, movements, entries, installments] = await Promise.all([
    db.query(
      `SELECT r.visit_task_id, p.part_name_snapshot, NULL::text AS part_code_snapshot,
              NULL::text AS maintenance_type, p.quantity, p.unit_price, NULL::numeric AS line_total,
              CASE WHEN p.old_part_removed IS FALSE THEN NULL ELSE 'replaced' END AS execution_status,
              NULL::text AS customer_decision
         FROM visit_task_emergency_parts_used p
         JOIN visit_task_results r ON r.id = p.visit_task_result_id
        WHERE r.visit_task_id = ANY($1::bigint[])
        ORDER BY p.id`,
      [vtIds],
    ),
    db.query(
      `SELECT r.visit_task_id, f.total_cost, f.collected_amount, f.payment_method
         FROM visit_task_emergency_financials f
         JOIN visit_task_results r ON r.id = f.visit_task_result_id
        WHERE r.visit_task_id = ANY($1::bigint[])`,
      [vtIds],
    ),
    openTaskIds.length === 0 ? { rows: [] } : db.query(
      `SELECT erp.open_task_id, erp.visit_task_id, erp.part_name_snapshot, erp.part_code_snapshot,
              erp.maintenance_type, erp.quantity, erp.unit_price, erp.line_total,
              erp.execution_status, erp.customer_decision,
              vt.field_visit_id, fv.scheduled_date::text AS scheduled_date
         FROM emergency_result_parts erp
         LEFT JOIN visit_tasks vt ON vt.id = erp.visit_task_id
         LEFT JOIN field_visits fv ON fv.id = vt.field_visit_id
        WHERE erp.open_task_id = ANY($1::int[])
        ORDER BY erp.id`,
      [openTaskIds],
    ),
    openTaskIds.length === 0 ? { rows: [] } : db.query(
      `SELECT ot.id AS open_task_id, c.id AS costs_id, c.total_cost, c.payment_type, c.collected_amount
         FROM open_tasks ot JOIN emergency_result_costs c ON c.id = ot.em_costs_id
        WHERE ot.id = ANY($1::int[])`,
      [openTaskIds],
    ),
    openTaskIds.length === 0 ? { rows: [] } : db.query(
      `SELECT id, source_open_task_id, created_at FROM visit_tasks
        WHERE source_open_task_id = ANY($1::int[]) ORDER BY created_at, id`,
      [openTaskIds],
    ),
    openTaskIds.length === 0 ? { rows: [] } : db.query(
      `SELECT source_id, source_type, source_ref_id, kind, amount_syp, occurred_at
         FROM financial_movements
        WHERE source_id = ANY($1::int[]) AND source_type = ANY($2::text[])`,
      [openTaskIds, TASK_MONEY_SOURCE_TYPES],
    ),
    openTaskIds.length === 0 ? { rows: [] } : db.query(
      `SELECT e.costs_id, e.method FROM emergency_payment_entries e
         JOIN open_tasks ot ON ot.em_costs_id = e.costs_id
        WHERE ot.id = ANY($1::int[]) AND e.installment_id IS NULL ORDER BY e.sort_order, e.id`,
      [openTaskIds],
    ),
    openTaskIds.length === 0 ? { rows: [] } : db.query(
      `SELECT i.costs_id, i.installment_number, i.due_date::text AS due_date, i.amount_syp,
              i.paid_amount, i.remaining_balance, i.status, i.created_at
         FROM emergency_installments i
         JOIN open_tasks ot ON ot.em_costs_id = i.costs_id
        WHERE ot.id = ANY($1::int[]) AND i.confirmed = TRUE
        ORDER BY i.installment_number`,
      [openTaskIds],
    ),
  ]);

  for (const t of maint) {
    const vtId = Number(t.id);
    const openTaskId = Number(t.source_open_task_id) || null;

    // ── Migrated: one result per visit, nothing cumulative ──────────────────
    const mParts = migParts.rows.filter((r: any) => Number(r.visit_task_id) === vtId);
    const mMoney = migMoney.rows.find((r: any) => Number(r.visit_task_id) === vtId);
    if (mParts.length > 0 || mMoney) {
      out.set(vtId, {
        source: 'migrated',
        parts: mParts.map(mapPart),
        previousParts: [],
        attempt: { charge: num(mMoney?.total_cost), paid: num(mMoney?.collected_amount), paymentMethod: mMoney?.payment_method ?? null },
        cumulative: null,
        paymentType: null,
        installments: [],
      });
      continue;
    }
    if (!openTaskId) continue;

    // ── Live: this visit's attempt within the task ─────────────────────────
    const taskAttempts = attempts.rows.filter((r: any) => Number(r.source_open_task_id) === openTaskId);
    const attemptIdx = taskAttempts.findIndex((r: any) => Number(r.id) === vtId);
    const attemptIds = new Set(taskAttempts.map((r: any) => Number(r.id)));
    const windowStart = attemptIdx >= 0 ? new Date(taskAttempts[attemptIdx].created_at).getTime() : -Infinity;
    const windowEnd = attemptIdx >= 0 && attemptIdx + 1 < taskAttempts.length
      ? new Date(taskAttempts[attemptIdx + 1].created_at).getTime() : Infinity;
    const isFirstAttempt = attemptIdx <= 0;

    const tParts = liveParts.rows.filter((r: any) => Number(r.open_task_id) === openTaskId);
    const earlierIds = new Set(taskAttempts.slice(0, Math.max(attemptIdx, 0)).map((r: any) => Number(r.id)));
    const parts = tParts.filter((r: any) => r.visit_task_id == null ? isFirstAttempt : Number(r.visit_task_id) === vtId);
    const previousParts = tParts.filter((r: any) => r.visit_task_id != null && earlierIds.has(Number(r.visit_task_id)));

    const cost = costs.rows.find((r: any) => Number(r.open_task_id) === openTaskId);
    const tMoves = movements.rows.filter((r: any) => Number(r.source_id) === openTaskId);
    // Rows booked before per-attempt keying (ref = costs id) belong to the first attempt.
    const inThisAttempt = (m: any) => ATTEMPT_SOURCE_TYPES.includes(m.source_type) && (
      Number(m.source_ref_id) === vtId || (isFirstAttempt && !attemptIds.has(Number(m.source_ref_id))));
    const tInst = cost ? installments.rows.filter((r: any) => Number(r.costs_id) === Number(cost.costs_id)) : [];
    // Installment charges belong to the attempt in which the plan was saved.
    const planAt = tInst[0] ? new Date(tInst[0].created_at).getTime() : null;
    const instChargesHere = planAt != null && planAt >= windowStart && planAt < windowEnd
      ? tMoves.filter((m: any) => m.source_type === 'maintenance_installment' && m.kind === 'charge')
          .reduce((s: number, m: any) => s + num(m.amount_syp), 0)
      : 0;
    const charge = tMoves.filter((m: any) => m.kind === 'charge' && inThisAttempt(m)).reduce((s: number, m: any) => s + num(m.amount_syp), 0)
      + instChargesHere;
    const ledgerPaid = tMoves.filter((m: any) => m.kind === 'payment' && inThisAttempt(m)).reduce((s: number, m: any) => s + num(m.amount_syp), 0);
    let totalPaid = tMoves.filter((m: any) => m.kind === 'payment').reduce((s: number, m: any) => s + num(m.amount_syp), 0)
      - tMoves.filter((m: any) => m.kind === 'refund').reduce((s: number, m: any) => s + num(m.amount_syp), 0);
    // Upfront payments saved before they were booked to the ledger exist only as the
    // cost record's collected_amount — show them rather than a misleading zero.
    const hasAttemptPaymentRows = tMoves.some((m: any) => m.kind === 'payment' && ATTEMPT_SOURCE_TYPES.includes(m.source_type));
    const legacyCollected = !hasAttemptPaymentRows ? num(cost?.collected_amount) : 0;
    const paid = ledgerPaid || (isFirstAttempt ? legacyCollected : 0);
    totalPaid += legacyCollected;
    const methods = cost ? [...new Set(entries.rows.filter((e: any) => Number(e.costs_id) === Number(cost.costs_id)).map((e: any) => e.method))] : [];

    if (!cost && parts.length === 0 && previousParts.length === 0) continue;
    out.set(vtId, {
      source: 'live',
      parts: parts.map(mapPart),
      previousParts: previousParts.map(mapPart),
      attempt: { charge, paid, paymentMethod: methods.length ? methods.join('، ') : null },
      cumulative: taskAttempts.length > 1 && cost
        ? { totalCost: num(cost.total_cost), totalPaid, remaining: Math.max(num(cost.total_cost) - totalPaid, 0), attempts: taskAttempts.length }
        : null,
      paymentType: cost?.payment_type ?? null,
      installments: tInst.map((i: any) => ({
        installmentNumber: Number(i.installment_number), dueDate: i.due_date, amount: num(i.amount_syp),
        paid: num(i.paid_amount), remaining: num(i.remaining_balance), status: i.status,
      })),
    });
  }
  return out;
}
