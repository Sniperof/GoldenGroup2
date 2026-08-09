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
// list (٠.٤ table). Human terminal decisions require the request to be claimed
// (in_review with reviewed_by_user_id set — i.e. a human triager is present
// regardless of the intake channel). resolved_at_intake additionally requires
// non-empty triage_notes. The old channel-based gate wrongly blocked mobile_app.
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  isTerminal,
  type ActorRole,
  type ServiceRequestChannel,
  type ServiceRequestStatus,
  type ServiceResult,
} from './_shared.js';

// Allowed forward + reopen transitions per ٠.٣ + ٠.٤.ب
// 'awaiting_customer_info' dropped (request-section-contract.md §3): the map
// keeps a legacy escape hatch FROM it (old rows → back to review/cancel) but
// no transition INTO it exists anymore.
const ALLOWED: Record<string, ServiceRequestStatus[]> = {
  received: ['in_review', 'cancelled'],
  in_review: [
    'resolved_at_intake',
    'rejected',
    'promoted',
    'completed',
    'cancelled',
  ],
  awaiting_customer_info: ['in_review', 'cancelled'], // legacy rows only
  resolved_at_intake: ['in_review'], // SR-REOPEN-01
  rejected: ['in_review'], // SR-REOPEN-01
  cancelled: ['in_review'], // SR-REOPEN-01
  promoted: [], // SR-R011 — no transitions out
  completed: [], // side-effect already applied — no reopen (like promoted)
};

const TRIAGE_OUTCOMES_BY_TERMINAL: Record<string, string[]> = {
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

const RESOLVE_AT_INTAKE_LIST_BY_REQUEST_TYPE: Record<string, string> = {
  emergency_maintenance: 'service_request_resolve_at_intake_emergency_maintenance',
  water_check: 'service_request_resolve_at_intake_water_check',
};

// Terminals whose outcome list is admin-managed per request type (system_lists),
// instead of the hard-coded TRIAGE_OUTCOMES_BY_TERMINAL map. `completed` is
// per-type because each self-completing type has its own outcome vocabulary
// (account_creation → linked_to_op/fop/lead/confirmed_duplicate).
const COMPLETED_LIST_BY_REQUEST_TYPE: Record<string, string> = {
  account_creation: 'service_request_completed_account_creation',
};

function resolveAtIntakeListCode(requestType: string | null | undefined): string {
  return RESOLVE_AT_INTAKE_LIST_BY_REQUEST_TYPE[requestType || '']
    ?? RESOLVE_AT_INTAKE_LIST_BY_REQUEST_TYPE.emergency_maintenance;
}

/** The system_lists category for a list-driven terminal, or null if the
 * terminal uses the hard-coded TRIAGE_OUTCOMES_BY_TERMINAL map. */
function listCategoryForTerminal(
  toStatus: ServiceRequestStatus,
  requestType: string | null | undefined,
): string | null {
  if (toStatus === 'resolved_at_intake') return resolveAtIntakeListCode(requestType);
  if (toStatus === 'completed') return COMPLETED_LIST_BY_REQUEST_TYPE[requestType || ''] ?? null;
  return null;
}

async function loadListOutcomes(client: PoolClient, category: string): Promise<string[]> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value
       FROM system_lists
      WHERE category = $1
        AND is_active = TRUE
      ORDER BY display_order ASC, id ASC`,
    [category],
  );
  return rows.map(row => String(row.value).trim()).filter(Boolean);
}

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
      request_type: string | null;
      beneficiary_client_id: number | null;
      installed_device_id: number | null;
      has_structured_problem: boolean;
      reviewed_by_user_id: number | null;
      reopen_count: number;
      review_required_flag: boolean;
      escalated_at: string | null;
      duplicate_flag: boolean;
      archived_at: string | null;
    }>(
      `SELECT id, status, channel, request_type, beneficiary_client_id,
              installed_device_id,
              EXISTS (
                SELECT 1 FROM service_request_problems problem
                 WHERE problem.service_request_id = service_requests.id
                   AND problem.deleted_at IS NULL
              ) AS has_structured_problem,
              reviewed_by_user_id, reopen_count,
              review_required_flag, escalated_at, duplicate_flag, archived_at
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

    if (row.escalated_at != null && input.toStatus !== 'rejected') {
      await rollbackTx(tx);
      return { ok: false, code: 'request_is_escalated_actions_blocked' };
    }

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
    // A human-triage terminal decision requires the request to be claimed
    // first (reviewed_by_user_id set — true for any channel once an operator
    // claims). The audit admin who rejects remains a separate decision actor;
    // this guard does not replace the operational reviewer (SR-CLAIM-06).
    if (
      input.toStatus === 'resolved_at_intake'
      || input.toStatus === 'completed'
      || input.toStatus === 'rejected'
    ) {
      if (row.reviewed_by_user_id == null) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: `${input.toStatus}_requires_claim`,
          message: `${input.toStatus === 'rejected' ? 'SR-R007' : 'SR-R005'}: claim the request (assign a reviewer) before this decision`,
        };
      }
    }
    // Operational service requests cannot be closed by rejection or an
    // intake-resolution until their beneficiary is an identified client.
    // account_creation is structurally different: linking is the approval
    // side-effect itself, so its reject path cannot depend on that link.
    if (
      row.request_type !== 'account_creation'
      && (input.toStatus === 'resolved_at_intake' || input.toStatus === 'rejected')
      && row.beneficiary_client_id == null
    ) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: `${input.toStatus}_requires_beneficiary_client`,
        message: 'Link the beneficiary to a client record before this decision',
      };
    }
    if (input.toStatus === 'resolved_at_intake') {
      if (row.request_type === 'emergency_maintenance' && row.installed_device_id == null) {
        await rollbackTx(tx);
        return { ok: false, code: 'resolved_at_intake_requires_installed_device' };
      }
      if (row.request_type === 'emergency_maintenance' && !row.has_structured_problem) {
        await rollbackTx(tx);
        return { ok: false, code: 'resolved_at_intake_requires_structured_problem' };
      }
      if (!input.triageNotes || input.triageNotes.trim().length === 0) {
        await rollbackTx(tx);
        return { ok: false, code: 'triage_notes_required' };
      }
    }

    if (isTerminal(input.toStatus)) {
      // SR-R006: every terminal needs a triage_outcome from the per-terminal list.
      const listCategory = listCategoryForTerminal(input.toStatus, row.request_type);
      const allowedOutcomes = listCategory
        ? await loadListOutcomes(tx.client, listCategory)
        : (TRIAGE_OUTCOMES_BY_TERMINAL[input.toStatus] ?? []);
      if (!input.triageOutcome || !allowedOutcomes.includes(input.triageOutcome)) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'invalid_triage_outcome',
          details: {
            allowed: allowedOutcomes,
            got: input.triageOutcome ?? null,
            listCode: listCategory,
          },
        };
      }

      // SR-AUTH-01: reject requires the request to be either escalated
      // (escalated_at set) or carry review_required_flag (duplicate/branch/reopen).
      // The two are decoupled (SR-ESC-02) but both open the reject door.
      if (input.toStatus === 'rejected' && !row.review_required_flag && row.escalated_at == null) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'review_required_flag_must_be_set',
          message: 'SR-AUTH-01: escalate the request or flag review_required first',
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
      // SR-ESC-02: reaching any terminal clears the escalation lock — reject is
      // the only terminal reachable while escalated; other terminals are gated
      // and already have a null marker, so clearing is a harmless no-op there.
      setParts.push('escalated_at = NULL', 'escalated_by_user_id = NULL', 'escalation_reason = NULL');

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
  from: string,
  to: ServiceRequestStatus,
  reopened: boolean,
): import('./_shared.js').ServiceRequestAuditEventType | null {
  if (reopened) return 'request_reopened';
  // request-info dropped (contract §3) — only the legacy exit event remains.
  if (from === 'awaiting_customer_info' && to === 'in_review') return 'customer_info_received';
  if (to === 'rejected') return 'rejected_decision';
  if (to === 'completed') return 'request_completed';
  if (to === 'cancelled') return 'cancelled_by_admin';
  if (from === 'received' && to === 'in_review') return 'claimed_by_operator';
  // promoted_to_task is emitted by promoteService (carries linked_open_task_id),
  // not here — we still write status_changed.
  return null;
}
