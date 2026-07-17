// ============================================================
// services/appAccounts/adminAccountRequestService.ts
// ============================================================
// Phase 4 (DEC-013) — admin review + decisions for account_creation requests.
//
//   listAccountRequests / getAccountRequestDetails / getSuggestions
//   linkAccountRequest   → THE side-effect: activate app_account + link +
//                          status 'completed' (DEC-013 §7)
//   rejectAccountRequest / escalateAccountRequest
//
// Uses the existing fuzzyMatching.suggestRecords (sources:'clients' — link
// target is clients only, DEC-013 §9.1). Decisions update service_requests
// directly (account_creation is not on the generic emergency state machine).
// ============================================================

import pool from '../../db.js';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  type ActorRole,
} from '../serviceRequests/_shared.js';
import { suggestRecords } from '../serviceRequests/fuzzyMatching.js';

const ACTIVE_STATUSES = ['received', 'in_review', 'awaiting_customer_info'];

function httpError(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...(details ? { details } : {}) });
}

/** Best-effort segment for the completion outcome (clients has no `classification`). */
function deriveSegment(candidateStatus: string | null): 'op' | 'fop' | 'lead' | 'client' {
  const s = (candidateStatus ?? '').trim().toUpperCase();
  if (s === 'OP') return 'op';
  if (s === 'FOP') return 'fop';
  if (s === 'LEAD') return 'lead';
  return 'client';
}

export interface ListFilters {
  status?: string | null;
  duplicate?: boolean | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function listAccountRequests(filters: ListFilters) {
  const where: string[] = [`request_type = 'account_creation'`, `archived_at IS NULL`];
  const params: unknown[] = [];
  let i = 1;

  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.duplicate === true) where.push(`duplicate_flag = TRUE`);
  if (filters.search) {
    where.push(
      `(requester_external->>'primary_phone' ILIKE $${i} OR requester_external->>'name' ILIKE $${i} OR public_ref_number ILIKE $${i})`,
    );
    params.push(`%${filters.search}%`);
    i += 1;
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const { rows } = await pool.query(
    `SELECT id, public_ref_number, status,
            requester_external->>'name'          AS full_name,
            requester_external->>'primary_phone' AS primary_phone,
            service_address->>'governorate'      AS governorate,
            duplicate_flag, review_required_flag, escalated_at,
            beneficiary_client_id, created_at
       FROM service_requests
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows, limit, offset };
}

export async function getAccountRequestDetails(id: number) {
  const { rows } = await pool.query(
    `SELECT id, public_ref_number, status, request_type, channel, submitter_tier,
            submitted_payload, requester_external, service_address,
            duplicate_flag, review_required_flag,
            escalated_at, escalated_by_user_id, escalation_reason,
            beneficiary_client_id, rejected_by_user_id, rejection_reason,
            created_at, closed_at
       FROM service_requests
      WHERE id = $1 AND request_type = 'account_creation'`,
    [id],
  );
  if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');

  const { rows: audit } = await pool.query(
    `SELECT event_type, event_payload, actor_user_id, actor_role, note, created_at
       FROM service_request_audit_log
      WHERE service_request_id = $1
      ORDER BY id ASC`,
    [id],
  );
  return { request: rows[0], audit };
}

export async function getSuggestions(id: number) {
  const { rows } = await pool.query<{ name: string | null; phone: string | null }>(
    `SELECT requester_external->>'name' AS name, requester_external->>'primary_phone' AS phone
       FROM service_requests
      WHERE id = $1 AND request_type = 'account_creation'`,
    [id],
  );
  if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');
  const out = await suggestRecords({ name: rows[0].name, phone: rows[0].phone, sources: 'clients' });
  return { suggestions: out.clients };
}

export interface LinkInput {
  requestId: number;
  clientId: number;
  actorUserId: number;
  actorRole: ActorRole;
}

export async function linkAccountRequest(input: LinkInput) {
  const tx = await acquireTx();
  try {
    const { rows: reqRows } = await tx.client.query<{
      id: number;
      status: string;
      primary_phone: string | null;
    }>(
      `SELECT id, status, requester_external->>'primary_phone' AS primary_phone
         FROM service_requests
        WHERE id = $1 AND request_type = 'account_creation'
        FOR UPDATE`,
      [input.requestId],
    );
    if (reqRows.length === 0) throw httpError(404, 'الطلب غير موجود');
    const request = reqRows[0];
    if (!ACTIVE_STATUSES.includes(request.status)) {
      throw httpError(409, 'تمّت معالجة الطلب مسبقاً', { status: request.status });
    }
    const phone = request.primary_phone;
    if (!phone) throw httpError(400, 'الطلب لا يحمل رقماً صالحاً');

    const { rows: clientRows } = await tx.client.query<{ id: number; candidate_status: string | null }>(
      `SELECT id, candidate_status FROM clients
        WHERE id = $1 AND deleted_at IS NULL`,
      [input.clientId],
    );
    if (clientRows.length === 0) throw httpError(404, 'سجل الزبون غير موجود');
    const segment = deriveSegment(clientRows[0].candidate_status);

    // Uniqueness: no active account for this number (DEC-013 §9.2).
    const { rows: active } = await tx.client.query(
      `SELECT 1 FROM app_accounts
        WHERE primary_mobile = $1 AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [phone],
    );
    if (active.length > 0) {
      throw httpError(409, 'الرقم مرتبط بحساب مفعّل آخر', { code: 'mobile_in_use' });
    }

    // Side-effect: create + activate the app account.
    const { rows: acc } = await tx.client.query<{ id: number }>(
      `INSERT INTO app_accounts
         (primary_mobile, status, linked_client_record_id, created_source, created_by_role, created_by_user_id)
       VALUES ($1, 'active', $2, 'account_creation', 'system', $3)
       RETURNING id`,
      [phone, input.clientId, input.actorUserId],
    );
    const appAccountId = acc[0].id;

    await tx.client.query(
      `UPDATE service_requests
          SET status = 'completed', beneficiary_client_id = $2, closed_at = NOW()
        WHERE id = $1`,
      [input.requestId, input.clientId],
    );

    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'party_linked',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: {
        app_account_id: appAccountId,
        client_id: input.clientId,
        outcome: `linked_to_${segment}`,
        created_source: 'account_creation',
      },
    });
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'status_changed',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: { from: request.status, to: 'completed' },
    });

    await commitTx(tx);
    return { appAccountId, status: 'completed' as const, outcome: `linked_to_${segment}` };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export interface RejectInput {
  requestId: number;
  reasonCode: string;
  actorUserId: number;
  actorRole: ActorRole;
}

export async function rejectAccountRequest(input: RejectInput) {
  const reason = String(input.reasonCode ?? '').trim();
  if (!reason) throw httpError(400, 'سبب الرفض مطلوب');

  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{ status: string }>(
      `SELECT status FROM service_requests
        WHERE id = $1 AND request_type = 'account_creation' FOR UPDATE`,
      [input.requestId],
    );
    if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');
    if (!ACTIVE_STATUSES.includes(rows[0].status)) {
      throw httpError(409, 'تمّت معالجة الطلب مسبقاً', { status: rows[0].status });
    }

    await tx.client.query(
      `UPDATE service_requests
          SET status = 'rejected', rejected_by_user_id = $2, rejection_reason = $3,
              closed_at = NOW(), escalated_at = NULL
        WHERE id = $1`,
      [input.requestId, input.actorUserId, reason],
    );
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'rejected_decision',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: { reason },
    });
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'status_changed',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: { from: rows[0].status, to: 'rejected' },
    });

    await commitTx(tx);
    return { status: 'rejected' as const };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export interface EscalateInput {
  requestId: number;
  reason: string;
  actorUserId: number;
  actorRole: ActorRole;
}

export async function escalateAccountRequest(input: EscalateInput) {
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw httpError(400, 'سبب التصعيد مطلوب');

  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{ status: string; escalated_at: string | null }>(
      `SELECT status, escalated_at FROM service_requests
        WHERE id = $1 AND request_type = 'account_creation' FOR UPDATE`,
      [input.requestId],
    );
    if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');
    if (!ACTIVE_STATUSES.includes(rows[0].status)) {
      throw httpError(409, 'تمّت معالجة الطلب مسبقاً', { status: rows[0].status });
    }
    if (rows[0].escalated_at != null) throw httpError(409, 'الطلب مصعّد مسبقاً');

    await tx.client.query(
      `UPDATE service_requests
          SET escalated_at = NOW(), escalated_by_user_id = $2, escalation_reason = $3,
              review_required_flag = TRUE
        WHERE id = $1`,
      [input.requestId, input.actorUserId, reason],
    );
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'escalated_to_audit_admin',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: { reason },
    });
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'review_required_flag_set',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: { reason: 'manual_escalation' },
    });

    await commitTx(tx);
    return { escalated: true as const };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
