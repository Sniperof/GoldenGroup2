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
// target is clients only, DEC-013 §9.1). Lifecycle decisions route through the
// SHARED state machine (transitionStatus): link → completed (with the app_account
// side-effect atomic in the same tx), reject → rejected. This gives account
// requests parity with water_check (claim-gate, managed outcomes, reopen, audit)
// while keeping the independent account_requests.* permission boundary.
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
import { transitionStatus } from '../serviceRequests/stateMachine.js';
import { claimOrTakeOver } from '../serviceRequests/claimService.js';
import type { ServiceRequestStatus } from '../serviceRequests/_shared.js';
import { getSystemSettingNumber } from '../systemSettings.js';

// awaiting_customer_info kept only for legacy rows (contract §3 dropped it).
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
  reviewRequired?: boolean | null;
  escalatedOnly?: boolean | null;
  /** Contract §3 — advisory stale flag filter («راكد فقط»). */
  staleOnly?: boolean | null;
  /** Filter to requests claimed by this user (contract §6 «طلباتي»). */
  mineUserId?: number | null;
  /** 'true' → archived only, 'all' → both, anything else → non-archived. */
  archived?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function listAccountRequests(filters: ListFilters) {
  const where: string[] = [`sr.request_type = 'account_creation'`];
  const params: unknown[] = [];
  let i = 1;

  // Contract §3 stale safety net (advisory only). 0 disables.
  const staleDays = Math.max(0, Math.floor(
    await getSystemSettingNumber('service_request_stale_after_days', 14),
  ));
  const staleCondition = staleDays > 0
    ? `(sr.status = 'in_review' AND COALESCE(
         (SELECT MAX(a.created_at) FROM service_request_audit_log a
           WHERE a.service_request_id = sr.id),
         sr.created_at
       ) < NOW() - (${staleDays} * INTERVAL '1 day'))`
    : 'FALSE';
  if (filters.staleOnly === true) where.push(staleCondition);

  if (filters.archived === 'true') where.push(`sr.archived_at IS NOT NULL`);
  else if (filters.archived !== 'all') where.push(`sr.archived_at IS NULL`);

  if (filters.status) {
    where.push(`sr.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.duplicate === true) where.push(`sr.duplicate_flag = TRUE`);
  if (filters.reviewRequired === true) where.push(`sr.review_required_flag = TRUE`);
  if (filters.escalatedOnly === true) where.push(`sr.escalated_at IS NOT NULL`);
  if (filters.mineUserId != null) {
    where.push(`sr.reviewed_by_user_id = $${i++}`);
    params.push(filters.mineUserId);
  }
  if (filters.search) {
    where.push(
      `(sr.requester_external->>'primary_phone' ILIKE $${i} OR sr.requester_external->>'name' ILIKE $${i} OR sr.public_ref_number ILIKE $${i})`,
    );
    params.push(`%${filters.search}%`);
    i += 1;
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const { rows } = await pool.query(
    `SELECT sr.id, sr.public_ref_number, sr.status,
            sr.requester_external->>'name'          AS full_name,
            sr.requester_external->>'primary_phone' AS primary_phone,
            COALESCE(sr.service_address->'labels'->>'governorate',
                     sr.service_address->>'governorate')  AS governorate,
            sr.branch_id, sr.branch_resolution_status,
            sr.branch_resolution_reason, sr.branch_resolution_geo_unit_id,
            sr.duplicate_flag, sr.review_required_flag, sr.escalated_at, sr.archived_at,
            sr.beneficiary_client_id, sr.created_at,
            sr.reviewed_by_user_id,
            reviewer.name AS reviewed_by_name,
            ${staleCondition} AS stale_flag
       FROM service_requests sr
       LEFT JOIN hr_users reviewer ON reviewer.id = sr.reviewed_by_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY sr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows, limit, offset };
}

export async function getAccountRequestDetails(id: number) {
  const { rows } = await pool.query(
    `SELECT sr.id, sr.public_ref_number, sr.status, sr.request_type, sr.channel, sr.submitter_tier,
            sr.submitted_payload, sr.requester_external, sr.service_address,
            sr.branch_id, sr.branch_resolution_status,
            sr.branch_resolution_reason, sr.branch_resolution_geo_unit_id,
            sr.duplicate_flag, sr.review_required_flag, sr.duplicate_of_request_id,
            sr.escalated_at, sr.escalated_by_user_id, sr.escalation_reason,
            sr.beneficiary_client_id, sr.rejected_by_user_id, sr.rejection_reason,
            sr.reviewed_by_user_id, sr.claimed_at, sr.triage_outcome, sr.reopen_count,
            sr.created_at, sr.closed_at, sr.archived_at,
            reviewer.name AS reviewed_by_name
       FROM service_requests sr
       LEFT JOIN hr_users reviewer ON reviewer.id = sr.reviewed_by_user_id
      WHERE sr.id = $1 AND sr.request_type = 'account_creation'`,
    [id],
  );
  if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');

  const { rows: audit } = await pool.query(
    `SELECT a.id, a.event_type, a.event_payload, a.actor_user_id, a.actor_role, a.note, a.created_at,
            actor.name AS actor_name
       FROM service_request_audit_log a
       LEFT JOIN hr_users actor ON actor.id = a.actor_user_id
      WHERE a.service_request_id = $1
      ORDER BY a.id ASC`,
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
    // Parity with water_check: a terminal decision requires the request to be
    // claimed first (in_review with a reviewer). The state machine re-enforces
    // this, but we fail fast with a clear message here.
    if (request.status !== 'in_review') {
      throw httpError(409, 'استلم الطلب أولاً (claim) قبل الربط', { status: request.status });
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
    const { rows: active } = await tx.client.query<{ status: string }>(
      `SELECT status FROM app_accounts
        WHERE primary_mobile = $1 AND status IN ('active', 'suspended') AND deleted_at IS NULL
        ORDER BY (status = 'active') DESC
        LIMIT 1`,
      [phone],
    );
    if (active.length > 0) {
      throw httpError(409, 'الرقم مرتبط بحساب قائم', {
        code: active[0].status === 'suspended' ? 'suspended_account_exists' : 'mobile_in_use',
        status: active[0].status,
      });
    }

    // Side-effect: create + activate the app account (atomic with the transition).
    const { rows: acc } = await tx.client.query<{ id: number }>(
      `INSERT INTO app_accounts
         (primary_mobile, status, linked_client_record_id, created_source, created_by_role, created_by_user_id)
       VALUES ($1, 'active', $2, 'account_creation', 'system', $3)
       RETURNING id`,
      [phone, input.clientId, input.actorUserId],
    );
    const appAccountId = acc[0].id;

    await tx.client.query(
      `UPDATE service_requests SET beneficiary_client_id = $2 WHERE id = $1`,
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

    // Terminal transition through the SHARED state machine (joins this tx).
    const outcome = `linked_to_${segment}`;
    const t = await transitionStatus(
      {
        serviceRequestId: input.requestId,
        toStatus: 'completed',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        triageOutcome: outcome,
        payloadExtra: { app_account_id: appAccountId, client_id: input.clientId },
      },
      tx.client,
    );
    throwOnFail(t);

    await commitTx(tx);
    return { appAccountId, status: 'completed' as const, outcome };
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
    // Guard the type (transitionStatus is type-agnostic) and lock the row.
    const { rows } = await tx.client.query<{ status: string }>(
      `SELECT status FROM service_requests
        WHERE id = $1 AND request_type = 'account_creation' FOR UPDATE`,
      [input.requestId],
    );
    if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');

    // Reject through the shared machine: validates the transition, requires the
    // reason to be an allowed outcome, and enforces SR-AUTH-01 (escalated or
    // review_required before reject). Writes rejected_decision + status_changed.
    const t = await transitionStatus(
      {
        serviceRequestId: input.requestId,
        toStatus: 'rejected',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        triageOutcome: reason,
      },
      tx.client,
    );
    throwOnFail(t);

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

// ------------------------------------------------------------
// Shared-lifecycle wrappers (parity with water_check). Each guards the type
// (transitionStatus/claim are type-agnostic) and delegates to the shared
// service inside one transaction, keeping the account_requests.* boundary.
// ------------------------------------------------------------

/** Verify the id is an account_creation request and lock it. Throws 404 otherwise. */
async function lockAccountRequest(client: any, id: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM service_requests WHERE id = $1 AND request_type = 'account_creation' FOR UPDATE`,
    [id],
  );
  if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');
}

function throwOnFail(t: { ok: boolean; code?: string; message?: string; details?: unknown }): void {
  if (t.ok) return;
  const status = t.code === 'not_found' ? 404 : t.code === 'request_is_escalated_actions_blocked' ? 423 : 409;
  throw httpError(status, t.message ?? 'تعذّر تنفيذ الإجراء', {
    code: t.code,
    ...(t.details ? { details: t.details } : {}),
  });
}

export async function resolveAccountRequestEscalation(input: {
  requestId: number;
  actorUserId: number;
  actorRole: ActorRole;
  note?: string | null;
}) {
  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{ escalated_at: string | null }>(
      `SELECT escalated_at FROM service_requests
        WHERE id = $1 AND request_type = 'account_creation' FOR UPDATE`,
      [input.requestId],
    );
    if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');
    if (rows[0].escalated_at == null) throw httpError(409, 'الطلب غير مصعّد');
    await tx.client.query(
      `UPDATE service_requests
          SET escalated_at = NULL, escalated_by_user_id = NULL, escalation_reason = NULL
        WHERE id = $1`,
      [input.requestId],
    );
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'escalation_resolved',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      note: input.note ?? null,
    });
    await commitTx(tx);
    return { escalated: false as const };
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}

export async function setAccountRequestArchived(input: {
  requestId: number;
  archived: boolean;
  actorUserId: number;
  actorRole: ActorRole;
}) {
  const tx = await acquireTx();
  try {
    const { rows } = await tx.client.query<{ status: string; archived_at: string | null }>(
      `SELECT status, archived_at FROM service_requests
        WHERE id = $1 AND request_type = 'account_creation' FOR UPDATE`,
      [input.requestId],
    );
    if (rows.length === 0) throw httpError(404, 'الطلب غير موجود');
    const row = rows[0];
    if (input.archived) {
      if (!['completed', 'rejected', 'cancelled', 'resolved_at_intake', 'promoted'].includes(row.status)) {
        throw httpError(409, 'لا يمكن أرشفة طلب غير نهائي');
      }
      if (row.archived_at != null) throw httpError(409, 'الطلب مؤرشف مسبقاً');
      await tx.client.query(
        `UPDATE service_requests SET archived_at = NOW(), archived_by_user_id = $2 WHERE id = $1`,
        [input.requestId, input.actorUserId],
      );
    } else {
      if (row.archived_at == null) throw httpError(409, 'الطلب غير مؤرشف');
      await tx.client.query(
        `UPDATE service_requests SET archived_at = NULL, archived_by_user_id = NULL WHERE id = $1`,
        [input.requestId],
      );
    }
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: input.archived ? 'archived' : 'unarchived',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    });
    await commitTx(tx);
    return { archived: input.archived };
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}

export interface ClaimAccountInput {
  requestId: number;
  operatorUserId: number;
  actorRole: ActorRole;
  transferReason?: string | null;
}

/** SR-CLAIM: claim or take over ownership (received → in_review on first claim). */
export async function claimAccountRequest(input: ClaimAccountInput) {
  const tx = await acquireTx();
  try {
    await lockAccountRequest(tx.client, input.requestId);
    const r = await claimOrTakeOver(
      {
        serviceRequestId: input.requestId,
        operatorUserId: input.operatorUserId,
        actorRole: input.actorRole,
        transferReason: input.transferReason ?? null,
      },
      tx.client,
    );
    throwOnFail(r);
    await commitTx(tx);
    return r.ok ? r.data : null;
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export interface TransitionAccountInput {
  requestId: number;
  toStatus: ServiceRequestStatus;
  actorUserId: number;
  actorRole: ActorRole;
  triageOutcome?: string | null;
  triageNotes?: string | null;
  reopenReason?: string | null;
  note?: string | null;
}

/** Non-terminal / reopen transitions (request-info, resume-review, reopen, cancel). */
export async function transitionAccountRequest(input: TransitionAccountInput) {
  const tx = await acquireTx();
  try {
    await lockAccountRequest(tx.client, input.requestId);
    const t = await transitionStatus(
      {
        serviceRequestId: input.requestId,
        toStatus: input.toStatus,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        triageOutcome: input.triageOutcome ?? null,
        triageNotes: input.triageNotes ?? null,
        reopenReason: input.reopenReason ?? null,
        note: input.note ?? null,
      },
      tx.client,
    );
    throwOnFail(t);
    await commitTx(tx);
    return t.ok ? t.data : null;
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export interface AddNoteInput {
  requestId: number;
  note: string;
  actorUserId: number;
  actorRole: ActorRole;
}

/** Internal note → audit only (SR §11 internal_note_added). */
export async function addAccountRequestNote(input: AddNoteInput) {
  const note = String(input.note ?? '').trim();
  if (!note) throw httpError(400, 'الملاحظة مطلوبة');
  const tx = await acquireTx();
  try {
    await lockAccountRequest(tx.client, input.requestId);
    await appendAudit(tx.client, {
      serviceRequestId: input.requestId,
      eventType: 'internal_note_added',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      note,
    });
    await commitTx(tx);
    return { ok: true as const };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
