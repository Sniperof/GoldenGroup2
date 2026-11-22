// Operational overview of one installed device — the indicator strip at the
// top of the device page (2026-11-20): next and last periodic maintenance,
// the warranty in force, what is still owed on the device, and its open work.
// Each block follows the permission of the section that shows the same data;
// a block the user may not see comes back as null.
import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';
import { authorize } from './authorizationService.js';

const CLOSED_TASK_STATUSES = ['completed', 'cancelled', 'closed'];

export interface DeviceOverview {
  maintenance: {
    next: { taskId: number; dueDate: string | null; status: string } | null;
    lastDoneAt: string | null;
  } | null;
  warranty: {
    type: 'contract' | 'golden';
    status: 'active' | 'pending';
    endDate: string | null;
    daysLeft: number | null;
  } | null;
  balance: {
    payerName: string | null;
    contractRemaining: number;
    contractOverdue: number;
    warrantyRemaining: number;
    warrantyOverdue: number;
  } | null;
  openTasks: { count: number; nearestDueDate: string | null } | null;
}

function can(authContext: AuthContext, branchId: number | null, permissions: string[]) {
  return permissions.some(permission => authorize(authContext, { permission, branchId }).allowed);
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export async function loadDeviceOverview(
  authContext: AuthContext,
  device: { id: number; branchId: number | null },
): Promise<DeviceOverview> {
  const canTasks = can(authContext, device.branchId, ['open_tasks.view', 'field_visits.view', 'clients.visits.view']);
  const canMoney = can(authContext, device.branchId, ['contracts.view_list', 'clients.account_statement.view']);
  const skip = Promise.resolve({ rows: [] as any[] });
  const id = device.id;

  const [nextMaint, lastMaint, warranty, contract, golden, open] = await Promise.all([
    canTasks ? pool.query(
      `SELECT id, due_date, status FROM open_tasks
        WHERE device_id = $1 AND task_type = 'periodic_maintenance' AND status <> ALL($2::text[])
        ORDER BY due_date NULLS LAST, id LIMIT 1`,
      [id, CLOSED_TASK_STATUSES],
    ) : skip,
    canTasks ? pool.query(
      `SELECT MAX(r.closed_at) AS at
         FROM open_tasks ot
         JOIN visit_tasks vt ON vt.source_open_task_id = ot.id
         JOIN visit_task_results r ON r.visit_task_id = vt.id
        WHERE ot.device_id = $1 AND ot.task_type = 'periodic_maintenance'
          AND r.final_decision NOT IN ('cancelled', 'rescheduled', 'reschedule')`,
      [id],
    ) : skip,
    // The warranty in force; else the contract warranty still waiting for activation.
    pool.query(
      `SELECT warranty_type, status, end_date FROM device_warranties
        WHERE device_id = $1 AND status IN ('active', 'pending')
        ORDER BY (status = 'active' AND (end_date IS NULL OR end_date >= CURRENT_DATE)) DESC,
                 end_date DESC NULLS LAST
        LIMIT 1`,
      [id],
    ),
    canMoney ? pool.query(
      `SELECT c.id, c.final_price,
              COALESCE(pc.name, bc.name) AS payer_name,
              COALESCE((SELECT SUM(amount_syp) FROM contract_installments WHERE contract_id = c.id), 0) AS installments_total,
              COALESCE((SELECT SUM(CASE WHEN entry_type = 'refund' THEN -amount_syp ELSE amount_syp END)
                          FROM contract_payment_entries WHERE contract_id = c.id AND installment_id IS NULL), 0) AS signing_paid,
              COALESCE((SELECT SUM(remaining_balance) FROM contract_installments
                         WHERE contract_id = c.id AND remaining_balance > 0), 0) AS remaining,
              COALESCE((SELECT SUM(remaining_balance) FROM contract_installments
                         WHERE contract_id = c.id AND remaining_balance > 0 AND due_date <= CURRENT_DATE), 0) AS overdue
         FROM installed_devices d
         JOIN contracts c ON c.id = d.contract_id
         LEFT JOIN clients pc ON pc.id = c.payer_client_id
         LEFT JOIN clients bc ON bc.id = c.customer_id
        WHERE d.id = $1 AND c.status = 'active' AND c.sale_subtype = 'definitive'`,
      [id],
    ) : skip,
    canMoney ? pool.query(
      `SELECT COALESCE(SUM(i.remaining_balance), 0) AS remaining,
              COALESCE(SUM(i.remaining_balance) FILTER (WHERE i.due_date <= CURRENT_DATE), 0) AS overdue
         FROM device_warranty_installments i
         JOIN device_warranties w ON w.id = i.warranty_id
        WHERE w.device_id = $1 AND w.warranty_type = 'golden' AND w.status IN ('active', 'pending')
          AND i.confirmed = TRUE AND i.remaining_balance > 0`,
      [id],
    ) : skip,
    canTasks ? pool.query(
      `SELECT COUNT(*)::int AS count, MIN(due_date) AS nearest
         FROM open_tasks
        WHERE device_id = $1 AND status <> ALL($2::text[])`,
      [id, CLOSED_TASK_STATUSES],
    ) : skip,
  ]);

  const w = warranty.rows[0];
  let daysLeft: number | null = null;
  const end = dateOnly(w?.end_date);
  if (w?.status === 'active' && end) {
    const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
    daysLeft = Math.round((new Date(end).getTime() - today) / 86_400_000);
  }

  const c = contract.rows[0];
  const signingRemaining = c ? Math.max(0, Number(c.final_price) - Number(c.installments_total) - Number(c.signing_paid)) : 0;
  const g = golden.rows[0];

  return {
    maintenance: canTasks ? {
      next: nextMaint.rows[0]
        ? { taskId: Number(nextMaint.rows[0].id), dueDate: dateOnly(nextMaint.rows[0].due_date), status: nextMaint.rows[0].status }
        : null,
      lastDoneAt: lastMaint.rows[0]?.at ? new Date(lastMaint.rows[0].at).toISOString() : null,
    } : null,
    warranty: w ? { type: w.warranty_type, status: w.status, endDate: end, daysLeft } : null,
    balance: canMoney ? {
      payerName: c?.payer_name ?? null,
      // The unpaid signing amount is due from the contract date, so it counts as overdue too.
      contractRemaining: c ? Number(c.remaining) + signingRemaining : 0,
      contractOverdue: c ? Number(c.overdue) + signingRemaining : 0,
      warrantyRemaining: Number(g?.remaining ?? 0),
      warrantyOverdue: Number(g?.overdue ?? 0),
    } : null,
    openTasks: canTasks ? { count: Number(open.rows[0]?.count ?? 0), nearestDueDate: dateOnly(open.rows[0]?.nearest) } : null,
  };
}
