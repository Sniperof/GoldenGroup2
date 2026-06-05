// ============================================================
// serviceRequests/stateMachine.ts
// ============================================================
// Constitution source: §٠.٣ transitions + §٠.٤ rules SR-R001..R011
//
// Allowed transitions (٠.٣):
//   received                → in_review | cancelled
//   in_review               → awaiting_customer_info | resolved_at_intake
//                           | rejected | promoted | cancelled
//   awaiting_customer_info  → in_review | cancelled
//   {resolved_at_intake, rejected, cancelled} → in_review  (reopen path, §٠.٤.ب)
//   promoted                → (NO reopen — SR-R011)
//
// Status-only transitions: this service updates `status` + closes-out
// fields (closed_at, triage_outcome, rejected_by_user_id) atomically and
// writes the audit log row. It does NOT:
//   - claim/take-over     → claimService.ts
//   - link beneficiary    → linkService (Phase 2b)
//   - actually promote    → promoteService (Phase 2b)
//   - apply auth/role     → endpoint layer (Phase 3)
//
// All terminal transitions require a triage_outcome from the per-terminal
// list (٠.٤ table). SR-R005: resolved_at_intake additionally requires
// a triager-present channel and non-empty triage_notes.
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  isTerminal,
  isTriagerPresent,
  type ActorRole,
  type ServiceRequestChannel,
  type ServiceRequestStatus,
  type ServiceResult,
} from './_shared.js';

// Allowed forward + reopen transitions per ٠.٣ + ٠.٤.ب
const ALLOWED: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  received: ['in_review', 'cancelled'],
  in_review: [
    'awaiting_customer_info',
    'resolved_at_intake',
    'rejected',
    'promoted',
    'cancelled',
  ],
  awaiting_customer_info: ['in_review', 'cancelled'],
  resolved_at_intake: ['in_review'], // SR-REOPEN-01
  rejected: ['in_review'], // SR-REOPEN-01
  cancelled: ['in_review'], // SR-REOPEN-01
  promoted: [], // SR-R011 — no transitions out
};

const TRIAGE_OUTCOMES_BY_TERMINAL: Record<string, string[]> = {
  resolved_at_intake: [
    'resolved_by_advice',
    'customer_self_fixed',
    'false_alarm',
    'info_clarified_no_issue',
  ],
  rejected: [
    'duplicate',
    'invalid_request',
    'spam',
    'out_of_scope',
    'unverified_caller',
    'device_not_company',
  ],
  promoted: ['needs_field_intervention'],
  cancelled: [
    'data_entry_error',
    'customer_withdrew_via_support',
    'redundant_with_existing_task',
    'customer_no_response',
  ],
};

export interface TransitionInput {
  serviceRequestId: number;
  toStatus: ServiceRequestStatus;
  actorUserId: number | null;
  actorRole: ActorRole;

  /** Required for all terminal targets per SR-R006. */
  triageOutcome?: string | null;
  /** Required for resolved_at_intake per SR-R005. */
  triageNotes?: string | null;
  /** Required for reopen paths per SR-REOPEN-03. */
  reopenReason?: string | null;
  /** Free-text note (optional, written to audit). */
  note?: string | null;
  /** Optional payload merged into the audit event. */
  payloadExtra?: Record<string, unknown>;
}

export interface TransitionOutput {
  fromStatus: ServiceRequestStatus;
  toStatus: ServiceRequestStatus;
  closedAt: string | null;
  reopened: boolean;
}

export async function transitionStatus(
  input: TransitionInput,
  db?: PoolClient,
): Promise<ServiceResult<TransitionOutput>> {
  const tx = await acquireTx(db);
  try {
    // 1. Load current row (lock for update to avoid races on transition).
    const { rows } = await tx.client.query<{
      id: number;
      status: ServiceRequestStatus;
      channel: ServiceRequestChannel;
      reopen_count: number;
      review_required_flag: boolean;
      duplicate_flag: boolean;
      archived_at: string | null;
    }>(
      `SELECT id, status, channel, reopen_count, review_required_flag,
              duplicate_flag, archived_at
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const row = rows[0];

    // 2. Validate transition is in the allowed map.
    const allowed = ALLOWED[row.status] ?? [];
    if (!allowed.includes(input.toStatus)) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'invalid_transition',
        message: `${row.status} → ${input.toStatus} not allowed`,
        details: { allowed },
      };
    }

    // 3. SR-REOPEN-05 — cannot reopen while archived.
    const isReopen = isTerminal(row.status) && input.toStatus === 'in_review';
    if (isReopen && row.archived_at != null) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'cannot_reopen_while_archived',
        message: 'SR-REOPEN-05: unarchive first',
      };
    }
    if (isReopen && !input.reopenReason) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'reopen_reason_required',
        message: 'SR-REOPEN-03: reopen requires a structured reason',
      };
    }

    // 4. Per-target validation.
    if (input.toStatus === 'resolved_at_intake') {
      // SR-R005: channel must be triager-present + triage_notes non-empty.
      if (!isTriagerPresent(row.channel)) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'resolved_at_intake_requires_triager_channel',
          details: { channel: row.channel },
        };
      }
      if (!input.triageNotes || input.triageNotes.trim().length === 0) {
        await rollbackTx(tx);
        return { ok: false, code: 'triage_notes_required' };
      }
    }

    if (isTerminal(input.toStatus)) {
      // SR-R006: every terminal needs a triage_outcome from the per-terminal list.
      const allowedOutcomes = TRIAGE_OUTCOMES_BY_TERMINAL[input.toStatus] ?? [];
      if (!input.triageOutcome || !allowedOutcomes.includes(input.triageOutcome)) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'invalid_triage_outcome',
          details: { allowed: allowedOutcomes, got: input.triageOutcome ?? null },
        };
      }

      // SR-AUTH-01: cannot reach rejected without review_required_flag.
      if (input.toStatus === 'rejected' && !row.review_required_flag) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'review_required_flag_must_be_set',
          message: 'SR-AUTH-01: flag review_required first',
        };
      }
    }

    // 5. Build UPDATE statement.
    const setParts: string[] = ['status = $2', 'updated_at = NOW()'];
    const params: unknown[] = [input.serviceRequestId, input.toStatus];
    let idx = 3;

    if (isTerminal(input.toStatus)) {
      setParts.push(`triage_outcome = $${idx++}`);
      params.push(input.triageOutcome ?? null);
      setParts.push('closed_at = NOW()');

      if (input.toStatus === 'resolved_at_intake' && input.triageNotes) {
        setParts.push(`triage_notes = $${idx++}`);
        params.push(input.triageNotes);
      }
      if (input.toStatus === 'rejected') {
        setParts.push(`rejected_by_user_id = $${idx++}`);
        params.push(input.actorUserId);
        setParts.push(`rejection_reason = $${idx++}`);
        params.push(input.triageOutcome);
      }
    }

    if (isReopen) {
      setParts.push('reopen_count = reopen_count + 1');
      setParts.push('last_reopened_at = NOW()');
      // SR-REOPEN-02: do NOT clear triage_outcome/closed_at/rejected_by.
      // closed_at is intentionally preserved as a snapshot of the prior close.

      // SR-REOPEN-04: reopen_count > 2 auto-sets review_required_flag.
      if (row.reopen_count + 1 > 2 && !row.review_required_flag) {
        setParts.push('review_required_flag = TRUE');
      }
    }

    const { rows: updated } = await tx.client.query<{ closed_at: string | null }>(
      `UPDATE service_requests
          SET ${setParts.join(', ')}
        WHERE id = $1
        RETURNING closed_at`,
      params,
    );

    // 6. Audit events.
    const basePayload = {
      from: row.status,
      to: input.toStatus,
      ...(input.payloadExtra ?? {}),
    };

    await appendAudit(tx.client, {
      serviceRequestId: input.serviceRequestId,
      eventType: 'status_changed',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: basePayload,
      note: input.note ?? null,
    });

    // Specialized event in addition to status_changed for queryability.
    const specialized = specializedEventFor(row.status, input.toStatus, isReopen);
    if (specialized) {
      await appendAudit(tx.client, {
        serviceRequestId: input.serviceRequestId,
        eventType: specialized,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        payload: {
          ...basePayload,
          ...(isReopen
            ? { previous_status: row.status, reopen_reason: input.reopenReason }
            : {}),
          ...(input.toStatus === 'rejected' ? { reason: input.triageOutcome } : {}),
        },
      });

      // Bumping review_required_flag from the reopen auto-rule deserves its own event.
      if (isReopen && row.reopen_count + 1 > 2 && !row.review_required_flag) {
        await appendAudit(tx.client, {
          serviceRequestId: input.serviceRequestId,
          eventType: 'review_required_flag_set',
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          payload: { reason: 'reopen_count_exceeded', auto: true },
        });
      }
    }

    await commitTx(tx);
    return {
      ok: true,
      data: {
        fromStatus: row.status,
        toStatus: input.toStatus,
        closedAt: updated[0]?.closed_at ?? null,
        reopened: isReopen,
      },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

function specializedEventFor(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
  reopened: boolean,
): import('./_shared.js').ServiceRequestAuditEventType | null {
  if (reopened) return 'request_reopened';
  if (to === 'awaiting_customer_info') return 'customer_info_requested';
  if (from === 'awaiting_customer_info' && to === 'in_review') return 'customer_info_received';
  if (to === 'rejected') return 'rejected_decision';
  if (to === 'cancelled') return 'cancelled_by_admin';
  if (from === 'received' && to === 'in_review') return 'claimed_by_operator';
  // promoted_to_task is emitted by promoteService (carries linked_open_task_id),
  // not here — we still write status_changed.
  return null;
}
