// ============================================================
// services/appAccounts/adminAppAccountService.ts
// ============================================================
// Phase 5 (DEC-013 §2.5.10 + §9.7) — admin proactive onboarding.
//
//   directCreateAppAccount   → single, from a clients record (created_source='admin')
//   bulkActivateAppAccounts  → many at once, filter|ids, partial-success + report
//                              (created_source='admin_bulk')
//
// Both reuse tryActivate(): normalize the client's mobile, enforce the
// active-account uniqueness rule, INSERT app_account, and audit to the GENERAL
// audit_logs table (no service_request exists for admin-initiated accounts).
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../../db.js';
import { normalizePhone, isValidSyrianMobile } from '../../utils/contactValidation.js';
import { acquireTx, commitTx, rollbackTx } from '../serviceRequests/_shared.js';

const BULK_CAP = 500;

function httpError(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

interface ClientRow {
  id: number;
  mobile: string | null;
}

type ActivateOutcome =
  | { outcome: 'created'; clientId: number; appAccountId: number; mobile: string }
  | { outcome: 'skipped_conflict'; clientId: number; mobile: string }
  | { outcome: 'skipped_invalid_mobile'; clientId: number };

async function auditAppAccount(
  db: PoolClient,
  input: {
    appAccountId: number;
    action: string;
    performedByUserId: number;
    newValue?: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs
       (entity_type, entity_id, action_type, performed_by_role, performed_by_user_id, new_value, internal_reason)
     VALUES ('app_account', $1, $2, 'admin', $3, $4, $5)`,
    [
      input.appAccountId,
      input.action,
      input.performedByUserId,
      input.newValue ? JSON.stringify(input.newValue) : null,
      input.reason ?? null,
    ],
  );
}

async function tryActivate(
  client: ClientRow,
  createdSource: 'admin' | 'admin_bulk',
  actorUserId: number,
): Promise<ActivateOutcome> {
  const mobile = normalizePhone(client.mobile);
  if (!isValidSyrianMobile(mobile)) {
    return { outcome: 'skipped_invalid_mobile', clientId: client.id };
  }

  const tx = await acquireTx();
  try {
    const active = await tx.client.query(
      `SELECT 1 FROM app_accounts
        WHERE primary_mobile = $1 AND status IN ('active', 'suspended') AND deleted_at IS NULL
        LIMIT 1`,
      [mobile],
    );
    if (active.rows.length > 0) {
      await rollbackTx(tx);
      return { outcome: 'skipped_conflict', clientId: client.id, mobile };
    }

    const ins = await tx.client.query<{ id: number }>(
      `INSERT INTO app_accounts
         (primary_mobile, status, linked_client_record_id, created_source, created_by_role, created_by_user_id)
       VALUES ($1, 'active', $2, $3, 'admin', $4)
       RETURNING id`,
      [mobile, client.id, createdSource, actorUserId],
    );
    const appAccountId = ins.rows[0].id;

    await auditAppAccount(tx.client, {
      appAccountId,
      action: 'account_created',
      performedByUserId: actorUserId,
      newValue: { primary_mobile: mobile, linked_client_record_id: client.id, created_source: createdSource },
    });
    await auditAppAccount(tx.client, {
      appAccountId,
      action: 'account_linked',
      performedByUserId: actorUserId,
      newValue: { linked_client_record_id: client.id },
    });

    await commitTx(tx);
    return { outcome: 'created', clientId: client.id, appAccountId, mobile };
  } catch (err: any) {
    await rollbackTx(tx);
    // Race on the partial-unique index → treat as conflict, not a crash.
    if (err?.code === '23505') return { outcome: 'skipped_conflict', clientId: client.id, mobile };
    throw err;
  } finally {
    tx.release();
  }
}

export async function getAppAccountForClient(clientId: number) {
  const { rows } = await pool.query(
    `SELECT id, primary_mobile, status, created_source, created_by_role, created_at,
            suspended_reason, suspended_at
       FROM app_accounts
      WHERE linked_client_record_id = $1 AND deleted_at IS NULL
      ORDER BY (status = 'active') DESC, created_at DESC
      LIMIT 1`,
    [clientId],
  );
  return { account: rows[0] ?? null };
}

export async function directCreateAppAccount(input: { clientId: number; actorUserId: number }) {
  const { rows } = await pool.query<ClientRow>(
    `SELECT id, mobile FROM clients WHERE id = $1 AND deleted_at IS NULL`,
    [input.clientId],
  );
  if (rows.length === 0) throw httpError(404, 'سجل الزبون غير موجود أو محذوف');

  const result = await tryActivate(rows[0], 'admin', input.actorUserId);
  if (result.outcome === 'skipped_conflict') {
    throw httpError(409, 'الرقم مرتبط بحساب مفعّل آخر', { code: 'mobile_in_use' });
  }
  if (result.outcome === 'skipped_invalid_mobile') {
    throw httpError(400, 'رقم موبايل الزبون غير صالح للتفعيل');
  }
  return { appAccountId: result.appAccountId, status: 'active' as const, primaryMobile: result.mobile };
}

export interface BulkActivateInput {
  mode: 'filter' | 'ids';
  filter?: { branchId?: number | null; classification?: string | null; governorate?: number | null } | null;
  clientIds?: number[] | null;
  actorUserId: number;
}

export function normalizeBulkClientIds(clientIds: unknown[] | null | undefined) {
  const ids = Array.from(new Set(
    (clientIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0),
  ));
  return {
    ids,
    cappedIds: ids.slice(0, BULK_CAP),
    truncated: ids.length > BULK_CAP,
  };
}

export async function bulkActivateAppAccounts(input: BulkActivateInput) {
  let clients: ClientRow[] = [];
  let missing: number[] = [];
  let truncated = false;
  let requestedCount = 0;

  if (input.mode === 'ids') {
    const { ids, cappedIds, truncated: idsTruncated } = normalizeBulkClientIds(input.clientIds);
    if (ids.length === 0) throw httpError(400, 'قائمة معرّفات الزبائن مطلوبة');
    requestedCount = ids.length;
    truncated = idsTruncated;
    const { rows } = await pool.query<ClientRow>(
      `SELECT id, mobile FROM clients WHERE id = ANY($1) AND deleted_at IS NULL`,
      [cappedIds],
    );
    clients = rows;
    const found = new Set(rows.map((r) => r.id));
    missing = cappedIds.filter((id) => !found.has(id));
  } else if (input.mode === 'filter') {
    const where: string[] = [`deleted_at IS NULL`, `mobile IS NOT NULL AND mobile <> ''`];
    const params: unknown[] = [];
    let i = 1;
    if (input.filter?.branchId != null) {
      where.push(`branch_id = $${i++}`);
      params.push(input.filter.branchId);
    }
    if (input.filter?.classification) {
      where.push(`candidate_status = $${i++}`);
      params.push(input.filter.classification);
    }
    if (input.filter?.governorate != null) {
      where.push(`governorate = $${i++}`);
      params.push(input.filter.governorate);
    }
    const { rows } = await pool.query<ClientRow>(
      `SELECT id, mobile FROM clients WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${BULK_CAP + 1}`,
      params,
    );
    truncated = rows.length > BULK_CAP;
    clients = rows.slice(0, BULK_CAP);
    requestedCount = clients.length;
  } else {
    throw httpError(400, "mode يجب أن يكون 'filter' أو 'ids'");
  }

  const created: Array<{ clientId: number; appAccountId: number; mobile: string }> = [];
  const skippedConflict: Array<{ clientId: number; mobile: string }> = [];
  const skippedInvalid: Array<{ clientId: number }> = [];
  const failed: Array<{ clientId: number }> = [];

  for (const c of clients) {
    try {
      const r = await tryActivate(c, 'admin_bulk', input.actorUserId);
      if (r.outcome === 'created') created.push({ clientId: r.clientId, appAccountId: r.appAccountId, mobile: r.mobile });
      else if (r.outcome === 'skipped_conflict') skippedConflict.push({ clientId: r.clientId, mobile: r.mobile });
      else skippedInvalid.push({ clientId: r.clientId });
    } catch (err) {
      console.error(`[app-accounts] bulk activation failed for client ${c.id}:`, err);
      failed.push({ clientId: c.id });
    }
  }

  return {
    requestedCount,
    considered: clients.length,
    createdCount: created.length,
    skippedConflictCount: skippedConflict.length,
    skippedInvalidCount: skippedInvalid.length,
    skippedMissingCount: missing.length,
    failedCount: failed.length,
    truncated,
    created,
    skippedConflict,
    skippedInvalid,
    skippedMissing: missing,
    failed,
  };
}

export async function suspendAppAccount(input: { accountId: number; reason: string; actorUserId: number }) {
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw httpError(400, 'سبب الإيقاف مطلوب');

  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{ status: string }>(
      `SELECT status FROM app_accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [input.accountId],
    );
    if (rows.length === 0) throw httpError(404, 'الحساب غير موجود');
    if (rows[0].status !== 'active') throw httpError(409, 'الحساب ليس مفعّلاً', { status: rows[0].status });

    await tx.client.query(
      `UPDATE app_accounts
          SET status = 'suspended', suspended_by_user_id = $2, suspended_reason = $3, suspended_at = NOW()
        WHERE id = $1`,
      [input.accountId, input.actorUserId, reason],
    );
    // Revoke all sessions immediately (DEC-013 §7 "لحظة الإيقاف").
    await tx.client.query(
      `UPDATE app_refresh_tokens SET revoked_at = NOW()
        WHERE app_account_id = $1 AND revoked_at IS NULL`,
      [input.accountId],
    );
    await auditAppAccount(tx.client, {
      appAccountId: input.accountId,
      action: 'account_suspended',
      performedByUserId: input.actorUserId,
      reason,
    });

    await commitTx(tx);
    return { status: 'suspended' as const };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export async function reactivateAppAccount(input: { accountId: number; actorUserId: number }) {
  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{ status: string; primary_mobile: string }>(
      `SELECT status, primary_mobile FROM app_accounts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [input.accountId],
    );
    if (rows.length === 0) throw httpError(404, 'الحساب غير موجود');
    if (rows[0].status !== 'suspended') throw httpError(409, 'الحساب ليس موقوفاً', { status: rows[0].status });

    // Uniqueness: another ACTIVE account may have claimed the number meanwhile.
    const { rows: clash } = await tx.client.query(
      `SELECT 1 FROM app_accounts
        WHERE primary_mobile = $1 AND status = 'active' AND deleted_at IS NULL AND id <> $2
        LIMIT 1`,
      [rows[0].primary_mobile, input.accountId],
    );
    if (clash.length > 0) throw httpError(409, 'الرقم مرتبط بحساب مفعّل آخر', { code: 'mobile_in_use' });

    await tx.client.query(
      `UPDATE app_accounts
          SET status = 'active', suspended_by_user_id = NULL, suspended_reason = NULL, suspended_at = NULL
        WHERE id = $1`,
      [input.accountId],
    );
    // Note: old sessions were revoked at suspend — the customer logs in fresh.
    await auditAppAccount(tx.client, {
      appAccountId: input.accountId,
      action: 'account_reactivated',
      performedByUserId: input.actorUserId,
    });

    await commitTx(tx);
    return { status: 'active' as const };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
