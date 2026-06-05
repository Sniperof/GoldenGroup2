// ============================================================
// serviceRequests/problemsService.ts
// ============================================================
// Constitution source:
//   §٠.١٩.ب   — schema (dual ref, 7 statuses, 4 phases)
//   §٠.١٩.د   — recorded_by vs repaired_by distinction
//   §٠.١٩.هـ  — permission matrix per phase
//   §٠.١٩.و   — audit events
//   §EM-PROB-01  soft-delete only
//   §EM-PROB-02  resolved → other status needs audit-admin override
//   §EM-PROB-04  override event
//   §EM-PROB-05  installed_device_id must belong to beneficiary
//
// This service handles row-level operations. The endpoint layer
// (Phase 3) enforces the per-phase permission matrix; here we
// expose a tight, type-safe API and an `auditAdminOverride()`
// that flips the session GUC the DB trigger checks.
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  commitTx,
  rollbackTx,
  appendAudit,
  type ActorRole,
  type ServiceResult,
} from './_shared.js';

const PROBLEM_STATUSES = [
  'reported',
  'confirmed',
  'resolved_at_intake',
  'resolved',
  'deferred',
  'unresolvable_field',
  'cancelled',
] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

const ADD_PHASES = [
  'intake',
  'in_review',
  'technical_consultation',
  'field_discovery',
] as const;
export type AddedDuringPhase = (typeof ADD_PHASES)[number];

// ============================================================
// addProblem
// ============================================================

export interface AddProblemInput {
  serviceRequestId: number;
  installedDeviceId: number;
  problemTypeId: number;
  details?: string | null;
  addedDuringPhase: AddedDuringPhase;
  createdByUserId: number;
  creatorRoleSnapshot: string;
  /** Pre-resolved at intake (٠.٤ + ٠.٥) flips status immediately. */
  resolveAtIntake?: boolean;
  actorRole: ActorRole;
}

export interface AddedProblem {
  id: number;
  status: ProblemStatus;
}

export async function addProblem(
  input: AddProblemInput,
  db?: PoolClient,
): Promise<ServiceResult<AddedProblem>> {
  const tx = await acquireTx(db);
  try {
    // EM-PROB-05: device must belong to the request's beneficiary (if linked).
    const ownershipCheck = await assertDeviceOwnership(
      tx.client,
      input.serviceRequestId,
      input.installedDeviceId,
    );
    if (ownershipCheck.ok !== true) {
      await rollbackTx(tx);
      return ownershipCheck as ServiceResult<AddedProblem>;
    }

    const initialStatus: ProblemStatus = input.resolveAtIntake
      ? 'resolved_at_intake'
      : 'reported';

    const { rows } = await tx.client.query<{ id: number }>(
      `INSERT INTO service_request_problems (
         service_request_id, installed_device_id, problem_type_id,
         details, status,
         created_by_user_id, added_during_phase, creator_role_snapshot,
         resolved_at, resolution_recorded_by_user_id
       ) VALUES (
         $1, $2, $3,
         $4, $5,
         $6, $7, $8,
         CASE WHEN $5 = 'resolved_at_intake' THEN NOW() ELSE NULL END,
         CASE WHEN $5 = 'resolved_at_intake' THEN $6 ELSE NULL END
       )
       RETURNING id`,
      [
        input.serviceRequestId,
        input.installedDeviceId,
        input.problemTypeId,
        input.details ?? null,
        initialStatus,
        input.createdByUserId,
        input.addedDuringPhase,
        input.creatorRoleSnapshot,
      ],
    );
    const problemId = rows[0].id;

    await appendAudit(tx.client, {
      serviceRequestId: input.serviceRequestId,
      eventType: 'problem_added',
      actorUserId: input.createdByUserId,
      actorRole: input.actorRole,
      payload: {
        problem_id: problemId,
        problem_type_id: input.problemTypeId,
        added_during_phase: input.addedDuringPhase,
        creator_role_snapshot: input.creatorRoleSnapshot,
        installed_device_id: input.installedDeviceId,
        initial_status: initialStatus,
      },
    });

    await commitTx(tx);
    return { ok: true, data: { id: problemId, status: initialStatus } };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

async function assertDeviceOwnership(
  db: PoolClient,
  serviceRequestId: number,
  installedDeviceId: number,
): Promise<ServiceResult<void>> {
  const { rows } = await db.query<{
    beneficiary_client_id: number | null;
    device_customer_id: number | null;
  }>(
    `SELECT sr.beneficiary_client_id,
            id.customer_id AS device_customer_id
       FROM service_requests sr
       LEFT JOIN installed_devices id ON id.id = $2
      WHERE sr.id = $1`,
    [serviceRequestId, installedDeviceId],
  );
  if (rows.length === 0) {
    return { ok: false, code: 'service_request_not_found' };
  }
  const r = rows[0];
  if (r.device_customer_id == null) {
    return { ok: false, code: 'installed_device_not_found' };
  }
  // Only assert when beneficiary is linked. Pre-link adds (intake before
  // linkage) are permitted — the link step itself revalidates.
  if (
    r.beneficiary_client_id != null &&
    r.beneficiary_client_id !== r.device_customer_id
  ) {
    return {
      ok: false,
      code: 'device_not_owned_by_beneficiary',
      message: 'EM-PROB-05: installed_device must belong to the beneficiary',
    };
  }
  return { ok: true, data: undefined };
}

// ============================================================
// editProblem — type or details
// ============================================================

export interface EditProblemInput {
  problemId: number;
  problemTypeId?: number;
  details?: string | null;
  editorUserId: number;
  actorRole: ActorRole;
}

export async function editProblem(
  input: EditProblemInput,
  db?: PoolClient,
): Promise<ServiceResult<void>> {
  if (input.problemTypeId == null && input.details === undefined) {
    return { ok: false, code: 'nothing_to_edit' };
  }
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      service_request_id: number;
      problem_type_id: number;
      details: string | null;
      deleted_at: string | null;
    }>(
      `SELECT service_request_id, problem_type_id, details, deleted_at
         FROM service_request_problems
        WHERE id = $1
        FOR UPDATE`,
      [input.problemId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const row = rows[0];
    if (row.deleted_at != null) {
      await rollbackTx(tx);
      return { ok: false, code: 'problem_deleted' };
    }

    const sets: string[] = [
      'last_edited_at = NOW()',
      `last_edited_by_user_id = $${2}`,
      'edit_count = edit_count + 1',
    ];
    const params: unknown[] = [input.problemId, input.editorUserId];
    let idx = 3;
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (input.problemTypeId != null && input.problemTypeId !== row.problem_type_id) {
      sets.push(`problem_type_id = $${idx++}`);
      params.push(input.problemTypeId);
      changes.problem_type_id = { from: row.problem_type_id, to: input.problemTypeId };
    }
    if (input.details !== undefined && input.details !== row.details) {
      sets.push(`details = $${idx++}`);
      params.push(input.details);
      changes.details = { from: row.details, to: input.details };
    }

    if (Object.keys(changes).length === 0) {
      await commitTx(tx);
      return { ok: true, data: undefined };
    }

    await tx.client.query(
      `UPDATE service_request_problems SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );

    await appendAudit(tx.client, {
      serviceRequestId: row.service_request_id,
      eventType: 'problem_edited',
      actorUserId: input.editorUserId,
      actorRole: input.actorRole,
      payload: { problem_id: input.problemId, changes },
    });

    await commitTx(tx);
    return { ok: true, data: undefined };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

// ============================================================
// changeStatus
// ============================================================

const STATUS_TRANSITIONS: Record<ProblemStatus, ProblemStatus[]> = {
  reported: ['confirmed', 'resolved_at_intake', 'deferred', 'cancelled'],
  confirmed: ['resolved', 'deferred', 'unresolvable_field', 'cancelled'],
  resolved_at_intake: [], // terminal at intake
  resolved: [], // EM-PROB-02 — override-only
  deferred: ['confirmed', 'resolved', 'unresolvable_field', 'cancelled'],
  unresolvable_field: ['cancelled'],
  cancelled: [],
};

export interface ChangeProblemStatusInput {
  problemId: number;
  toStatus: ProblemStatus;
  actorUserId: number;
  actorRole: ActorRole;
  /** Required when target is `resolved` per §٠.١٩.د. */
  resolutionRecordedByUserId?: number | null;
  repairedByEmployeeId?: number | null;
  resolutionVisitTaskId?: number | null;
  repairTeamSnapshot?: Record<string, unknown> | null;
  resolutionNotes?: string | null;
  reason?: string | null;
}

export async function changeProblemStatus(
  input: ChangeProblemStatusInput,
  db?: PoolClient,
): Promise<ServiceResult<{ from: ProblemStatus; to: ProblemStatus }>> {
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      service_request_id: number;
      status: ProblemStatus;
      deleted_at: string | null;
    }>(
      `SELECT service_request_id, status, deleted_at
         FROM service_request_problems
        WHERE id = $1
        FOR UPDATE`,
      [input.problemId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const row = rows[0];
    if (row.deleted_at != null) {
      await rollbackTx(tx);
      return { ok: false, code: 'problem_deleted' };
    }

    const allowed = STATUS_TRANSITIONS[row.status];
    if (!allowed.includes(input.toStatus)) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'invalid_problem_transition',
        details: { from: row.status, to: input.toStatus, allowed },
      };
    }

    if (input.toStatus === 'resolved' && input.repairedByEmployeeId == null) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'repaired_by_required',
        message: '§٠.١٩.د: resolved transitions require repaired_by_employee_id',
      };
    }

    const setParts: string[] = ['status = $2', 'updated_at = NOW()'];
    const params: unknown[] = [input.problemId, input.toStatus];
    let idx = 3;

    if (input.toStatus === 'resolved' || input.toStatus === 'resolved_at_intake') {
      setParts.push('resolved_at = NOW()');
      setParts.push(`resolution_recorded_by_user_id = $${idx++}`);
      params.push(input.resolutionRecordedByUserId ?? input.actorUserId);
      if (input.repairedByEmployeeId != null) {
        setParts.push(`repaired_by_employee_id = $${idx++}`);
        params.push(input.repairedByEmployeeId);
      }
      if (input.resolutionVisitTaskId != null) {
        setParts.push(`resolution_visit_task_id = $${idx++}`);
        params.push(input.resolutionVisitTaskId);
      }
      if (input.repairTeamSnapshot != null) {
        setParts.push(`repair_team_snapshot = $${idx++}::jsonb`);
        params.push(JSON.stringify(input.repairTeamSnapshot));
      }
      if (input.resolutionNotes != null) {
        setParts.push(`resolution_notes = $${idx++}`);
        params.push(input.resolutionNotes);
      }
    }

    await tx.client.query(
      `UPDATE service_request_problems SET ${setParts.join(', ')} WHERE id = $1`,
      params,
    );

    await appendAudit(tx.client, {
      serviceRequestId: row.service_request_id,
      eventType: 'problem_status_changed',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: {
        problem_id: input.problemId,
        old_status: row.status,
        new_status: input.toStatus,
        reason: input.reason ?? null,
      },
    });

    if (input.toStatus === 'resolved' || input.toStatus === 'resolved_at_intake') {
      await appendAudit(tx.client, {
        serviceRequestId: row.service_request_id,
        eventType: 'problem_resolution_recorded',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        payload: {
          problem_id: input.problemId,
          resolution_recorded_by_user_id: input.resolutionRecordedByUserId ?? input.actorUserId,
          repaired_by_employee_id: input.repairedByEmployeeId ?? null,
          resolution_visit_task_id: input.resolutionVisitTaskId ?? null,
        },
      });
    }

    await commitTx(tx);
    return { ok: true, data: { from: row.status, to: input.toStatus } };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

// ============================================================
// softDelete + restore (EM-PROB-01)
// ============================================================

export async function softDeleteProblem(
  input: {
    problemId: number;
    reason: string;
    actorUserId: number;
    actorRole: ActorRole;
  },
  db?: PoolClient,
): Promise<ServiceResult<void>> {
  if (!input.reason || input.reason.trim().length === 0) {
    return { ok: false, code: 'deletion_reason_required' };
  }
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      service_request_id: number;
      deleted_at: string | null;
    }>(
      `SELECT service_request_id, deleted_at
         FROM service_request_problems
        WHERE id = $1
        FOR UPDATE`,
      [input.problemId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    if (rows[0].deleted_at != null) {
      await rollbackTx(tx);
      return { ok: false, code: 'already_deleted' };
    }
    await tx.client.query(
      `UPDATE service_request_problems
          SET deleted_at = NOW(),
              deleted_by_user_id = $2,
              deletion_reason = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [input.problemId, input.actorUserId, input.reason],
    );
    await appendAudit(tx.client, {
      serviceRequestId: rows[0].service_request_id,
      eventType: 'problem_soft_deleted',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: { problem_id: input.problemId, deletion_reason: input.reason },
    });
    await commitTx(tx);
    return { ok: true, data: undefined };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

export async function restoreProblem(
  input: { problemId: number; reason: string; actorUserId: number },
  db?: PoolClient,
): Promise<ServiceResult<void>> {
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      service_request_id: number;
      deleted_at: string | null;
    }>(
      `SELECT service_request_id, deleted_at
         FROM service_request_problems
        WHERE id = $1
        FOR UPDATE`,
      [input.problemId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    if (rows[0].deleted_at == null) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_deleted' };
    }
    await tx.client.query(
      `UPDATE service_request_problems
          SET deleted_at = NULL,
              deleted_by_user_id = NULL,
              deletion_reason = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [input.problemId],
    );
    await appendAudit(tx.client, {
      serviceRequestId: rows[0].service_request_id,
      eventType: 'problem_restored',
      actorUserId: input.actorUserId,
      actorRole: 'audit_admin',
      payload: { problem_id: input.problemId, restoration_reason: input.reason },
    });
    await commitTx(tx);
    return { ok: true, data: undefined };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

// ============================================================
// auditAdminOverride — bypass EM-PROB-02 resolved-lock
// ============================================================

export interface AuditOverrideInput {
  problemId: number;
  newStatus: ProblemStatus;
  reason: string;
  actorUserId: number;
}

export async function auditAdminOverride(
  input: AuditOverrideInput,
  db?: PoolClient,
): Promise<ServiceResult<{ previousStatus: ProblemStatus; newStatus: ProblemStatus }>> {
  if (!input.reason || input.reason.trim().length === 0) {
    return { ok: false, code: 'override_reason_required' };
  }
  const tx = await acquireTx(db);
  try {
    // Flip session GUC so the EM-PROB-02 trigger accepts the change.
    await tx.client.query(`SET LOCAL service_request.audit_override = 'on'`);

    const { rows } = await tx.client.query<{
      service_request_id: number;
      status: ProblemStatus;
    }>(
      `SELECT service_request_id, status
         FROM service_request_problems
        WHERE id = $1
        FOR UPDATE`,
      [input.problemId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const row = rows[0];
    await tx.client.query(
      `UPDATE service_request_problems
          SET status = $2, updated_at = NOW()
        WHERE id = $1`,
      [input.problemId, input.newStatus],
    );
    await appendAudit(tx.client, {
      serviceRequestId: row.service_request_id,
      eventType: 'problem_audit_admin_override',
      actorUserId: input.actorUserId,
      actorRole: 'audit_admin',
      payload: {
        problem_id: input.problemId,
        previous_state: row.status,
        new_state: input.newStatus,
        override_reason: input.reason,
      },
    });
    await commitTx(tx);
    return {
      ok: true,
      data: { previousStatus: row.status, newStatus: input.newStatus },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
