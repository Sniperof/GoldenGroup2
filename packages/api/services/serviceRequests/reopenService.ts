// ============================================================
// serviceRequests/reopenService.ts
// ============================================================
// Constitution source: §٠.٤.ب — Reopen paths per terminal
//
//   rejected            → in_review  (Audit Admin only)
//   resolved_at_intake  → in_review  (Operator)
//   cancelled           → in_review  (Operator)
//   promoted            → ❌ never (SR-R011)
//
// This service is a thin role-aware wrapper on transitionStatus that:
//   - Validates the actor's role matches the terminal's required role.
//   - Enforces SR-REOPEN-05 (no reopen while archived).
//   - Delegates the actual transition + audit to transitionStatus.
//
// Role-to-perm mapping is owned by the endpoint layer (Phase 3); this
// service trusts the caller's declared actorRole. The DB layer enforces
// no-op on `promoted` reopen automatically since 'promoted' has no
// allowed transitions in the ALLOWED map of stateMachine.ts.
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  type ActorRole,
  type ServiceResult,
} from './_shared.js';
import { transitionStatus } from './stateMachine.js';

const TERMINAL_TO_REQUIRED_ROLE: Record<string, ActorRole> = {
  rejected: 'audit_admin',
  resolved_at_intake: 'operator',
  cancelled: 'operator',
};

export interface ReopenInput {
  serviceRequestId: number;
  actorUserId: number;
  actorRole: ActorRole;
  reopenReason: string;
  note?: string | null;
}

export async function reopen(
  input: ReopenInput,
  db?: PoolClient,
): Promise<ServiceResult<{ fromStatus: string; toStatus: 'in_review' }>> {
  if (!input.reopenReason || input.reopenReason.trim().length === 0) {
    return { ok: false, code: 'reopen_reason_required' };
  }

  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{ status: string; archived_at: string | null }>(
      `SELECT status, archived_at FROM service_requests
        WHERE id = $1 FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const row = rows[0];

    if (row.status === 'promoted') {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'promoted_cannot_be_reopened',
        message: 'SR-R011: open_task is the live entity now',
      };
    }

    const requiredRole = TERMINAL_TO_REQUIRED_ROLE[row.status];
    if (!requiredRole) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'not_terminal',
        details: { status: row.status },
      };
    }
    if (input.actorRole !== requiredRole && input.actorRole !== 'audit_admin') {
      // audit_admin can act in place of operator if needed (SR-AUTH-03 spirit).
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'wrong_role_for_reopen',
        details: { required: requiredRole, got: input.actorRole },
      };
    }

    // Delegate to stateMachine — it owns SR-REOPEN-01..04 + archived guard.
    const result = await transitionStatus(
      {
        serviceRequestId: input.serviceRequestId,
        toStatus: 'in_review',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        reopenReason: input.reopenReason,
        note: input.note ?? null,
      },
      tx.client,
    );
    if (result.ok !== true) {
      await rollbackTx(tx);
      return result as ServiceResult<{ fromStatus: string; toStatus: 'in_review' }>;
    }

    await commitTx(tx);
    return {
      ok: true,
      data: { fromStatus: result.data.fromStatus, toStatus: 'in_review' },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
