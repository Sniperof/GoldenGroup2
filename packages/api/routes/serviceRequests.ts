// ============================================================
// routes/serviceRequests.ts
// ============================================================
// Phase 3 — REST surface for the service_requests intake layer.
//
// All endpoints sit under /api/service-requests except the two
// open-task companion routes, which are added directly to
// routes/openTasks.ts (GET /:id/problems, GET /:id/derived-outcome).
//
// Conventions:
//   - requirePermission(...) gates every route per §٠.١٦ matrix.
//   - actorRole is inferred from the endpoint's permission level:
//     reject/restore/override → 'audit_admin'; everything else
//     for non-super-admin callers → 'operator'.
//   - Service results { ok:false, code } are mapped to HTTP 400
//     unless the code names a recognized status code (not_found
//     → 404, wrong_role → 403, merge_or_split_required → 409).
//   - Tx orchestration lives in the services; routes are thin.
// ============================================================

import { Router, type Request, type Response } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  appendAudit,
  type ActorRole,
  type ServiceRequestStatus,
} from '../services/serviceRequests/_shared.js';
import { createServiceRequest } from '../services/serviceRequests/createService.js';
import { transitionStatus } from '../services/serviceRequests/stateMachine.js';
import { claimOrTakeOver } from '../services/serviceRequests/claimService.js';
import {
  addProblem,
  editProblem,
  changeProblemStatus,
  softDeleteProblem,
  restoreProblem,
  auditAdminOverride,
  type ProblemStatus,
  type AddedDuringPhase,
} from '../services/serviceRequests/problemsService.js';
import {
  promote,
  mergeIntoExistingTask,
} from '../services/serviceRequests/promoteService.js';
import { reopen } from '../services/serviceRequests/reopenService.js';
import { suggestRecords } from '../services/serviceRequests/fuzzyMatching.js';

const router = Router();
router.use(requireAuth);

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function getActor(req: Request): { userId: number; isSuperAdmin: boolean } {
  const ctx = req.authContext!;
  return { userId: ctx.userId, isSuperAdmin: ctx.isSuperAdmin };
}

/** Maps a service-result error code to an HTTP status. */
function statusFromCode(code: string): number {
  switch (code) {
    case 'not_found':
    case 'service_request_not_found':
    case 'installed_device_not_found':
    case 'existing_open_task_not_found':
      return 404;
    case 'wrong_role_for_reopen':
    case 'audit_admin_cannot_claim':
    case 'promoted_cannot_be_reopened':
      return 403;
    case 'merge_or_split_required':
      return 409;
    default:
      return 400;
  }
}

function sendErr(res: Response, result: { code: string; message?: string; details?: unknown }) {
  res.status(statusFromCode(result.code)).json({
    error: result.code,
    message: result.message ?? null,
    details: result.details ?? null,
  });
}

const SR_SELECT = `
  sr.id,
  sr.public_ref_number AS "publicRefNumber",
  sr.channel,
  sr.application_source AS "applicationSource",
  sr.requester_user_id AS "requesterUserId",
  sr.requester_external AS "requesterExternal",
  sr.beneficiary_client_id AS "beneficiaryClientId",
  sr.beneficiary_candidate_id AS "beneficiaryCandidateId",
  sr.beneficiary_external AS "beneficiaryExternal",
  sr.referrer_user_id AS "referrerUserId",
  sr.referrer_external AS "referrerExternal",
  sr.submission_type AS "submissionType",
  sr.submitter_tier AS "submitterTier",
  sr.contract_id AS "contractId",
  sr.device_source AS "deviceSource",
  sr.installed_device_id AS "installedDeviceId",
  sr.external_device_name AS "externalDeviceName",
  sr.external_device_serial AS "externalDeviceSerial",
  sr.problem_description AS "problemDescription",
  sr.requested_action_type_id AS "requestedActionTypeId",
  sr.attachments,
  sr.service_address AS "serviceAddress",
  sr.priority,
  sr.status,
  sr.reviewed_by_user_id AS "reviewedByUserId",
  sr.claimed_at AS "claimedAt",
  sr.triage_outcome AS "triageOutcome",
  sr.triage_notes AS "triageNotes",
  sr.linked_open_task_id AS "linkedOpenTaskId",
  sr.expected_callback_at AS "expectedCallbackAt",
  sr.duplicate_flag AS "duplicateFlag",
  sr.duplicate_of_request_id AS "duplicateOfRequestId",
  sr.review_required_flag AS "reviewRequiredFlag",
  sr.rejected_by_user_id AS "rejectedByUserId",
  sr.rejection_reason AS "rejectionReason",
  sr.archived_at AS "archivedAt",
  sr.archived_by_user_id AS "archivedByUserId",
  sr.reopen_count AS "reopenCount",
  sr.last_reopened_at AS "lastReopenedAt",
  sr.branch_id AS "branchId",
  sr.created_at AS "createdAt",
  sr.closed_at AS "closedAt",
  sr.updated_at AS "updatedAt"
`;

// ------------------------------------------------------------
// CREATE (٠.٦ — channel determines initial status)
// ------------------------------------------------------------

router.post('/', requirePermission('service_requests.create'), async (req, res) => {
  const actor = getActor(req);
  const result = await createServiceRequest({
    ...req.body,
    actorUserId: actor.userId,
    actorRole: 'operator',
    branchId: req.body.branchId ?? req.authContext!.actingBranchId ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.status(201).json(result.data);
});

// Convenience: same as POST / but forces channel='admin_manual' + in_review.
router.post('/internal', requirePermission('service_requests.create'), async (req, res) => {
  const actor = getActor(req);
  const result = await createServiceRequest({
    ...req.body,
    channel: 'admin_manual',
    actorUserId: actor.userId,
    actorRole: 'operator',
    branchId: req.body.branchId ?? req.authContext!.actingBranchId ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.status(201).json(result.data);
});

// ------------------------------------------------------------
// LIST + DETAIL (٠.١٦ — view is GLOBAL only; SR-08)
// ------------------------------------------------------------

router.get('/', requirePermission('service_requests.view'), async (req, res) => {
  const q = req.query;
  const filters: string[] = ['1=1'];
  const params: unknown[] = [];
  let idx = 1;

  if (q.status) {
    filters.push(`sr.status = $${idx++}`);
    params.push(String(q.status));
  }
  if (q.channel) {
    filters.push(`sr.channel = $${idx++}`);
    params.push(String(q.channel));
  }
  if (q.duplicateOnly === 'true') filters.push(`sr.duplicate_flag = TRUE`);
  if (q.reviewRequired === 'true') filters.push(`sr.review_required_flag = TRUE`);
  if (q.archived === 'true') filters.push(`sr.archived_at IS NOT NULL`);
  else if (q.archived !== 'all') filters.push(`sr.archived_at IS NULL`);
  if (q.mine === 'true') {
    filters.push(`sr.reviewed_by_user_id = $${idx++}`);
    params.push(req.authContext!.userId);
  }
  if (q.beneficiaryClientId) {
    filters.push(`sr.beneficiary_client_id = $${idx++}`);
    params.push(Number(q.beneficiaryClientId));
  }

  const limit = Math.min(Number(q.limit) || 50, 200);
  const offset = Number(q.offset) || 0;

  const { rows } = await pool.query(
    `SELECT ${SR_SELECT}
       FROM service_requests sr
      WHERE ${filters.join(' AND ')}
      ORDER BY sr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const totalRes = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM service_requests sr WHERE ${filters.join(' AND ')}`,
    params,
  );

  res.json({ items: rows, total: Number(totalRes.rows[0].n), limit, offset });
});

router.get('/:id', requirePermission('service_requests.view'), async (req, res) => {
  const id = Number(req.params.id);
  const [reqRes, logRes, problemsRes] = await Promise.all([
    pool.query(`SELECT ${SR_SELECT} FROM service_requests sr WHERE sr.id = $1`, [id]),
    pool.query(
      `SELECT id, event_type AS "eventType", event_payload AS "eventPayload",
              actor_user_id AS "actorUserId", actor_role AS "actorRole",
              note, created_at AS "createdAt"
         FROM service_request_audit_log
        WHERE service_request_id = $1
        ORDER BY created_at ASC, id ASC`,
      [id],
    ),
    pool.query(
      `SELECT p.id, p.service_request_id AS "serviceRequestId",
              p.open_task_id AS "openTaskId",
              p.installed_device_id AS "installedDeviceId",
              p.problem_type_id AS "problemTypeId",
              sl.value AS "problemTypeLabel",
              p.details, p.status,
              p.added_during_phase AS "addedDuringPhase",
              p.creator_role_snapshot AS "creatorRoleSnapshot",
              p.created_by_user_id AS "createdByUserId",
              p.created_at AS "createdAt",
              p.resolved_at AS "resolvedAt",
              p.resolution_recorded_by_user_id AS "resolutionRecordedByUserId",
              p.repaired_by_employee_id AS "repairedByEmployeeId",
              p.resolution_visit_task_id AS "resolutionVisitTaskId",
              p.resolution_notes AS "resolutionNotes",
              p.no_resolve_reason AS "noResolveReason",
              p.edit_count AS "editCount", p.last_edited_at AS "lastEditedAt",
              p.deleted_at AS "deletedAt"
         FROM service_request_problems p
         LEFT JOIN system_lists sl ON sl.id = p.problem_type_id
        WHERE p.service_request_id = $1
        ORDER BY p.created_at ASC`,
      [id],
    ),
  ]);

  if (reqRes.rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({
    request: reqRes.rows[0],
    auditLog: logRes.rows,
    problems: problemsRes.rows,
  });
});

// ------------------------------------------------------------
// CLAIM / TAKE-OVER (٠.٤.أ)
// ------------------------------------------------------------

router.post('/:id/claim', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await claimOrTakeOver({
    serviceRequestId: Number(req.params.id),
    operatorUserId: actor.userId,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

router.post('/:id/take-over', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await claimOrTakeOver({
    serviceRequestId: Number(req.params.id),
    operatorUserId: actor.userId,
    actorRole: 'operator',
    transferReason: req.body.reason ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

// ------------------------------------------------------------
// LINK / RELINK (٠.١٢ — beneficiary/candidate)
// Inline service: validates target, updates row, writes audit.
// ------------------------------------------------------------

async function linkBeneficiary(input: {
  serviceRequestId: number;
  beneficiaryClientId?: number | null;
  beneficiaryCandidateId?: number | null;
  installedDeviceId?: number | null;
  contractId?: number | null;
  actorUserId: number;
  actorRole: ActorRole;
  isChange: boolean;
  changeReason?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      beneficiary_client_id: number | null;
      beneficiary_candidate_id: number | null;
      status: string;
    }>(
      `SELECT beneficiary_client_id, beneficiary_candidate_id, status
         FROM service_requests WHERE id = $1 FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false as const, code: 'not_found' };
    }
    if (input.isChange && rows[0].beneficiary_client_id == null && rows[0].beneficiary_candidate_id == null) {
      await client.query('ROLLBACK');
      return { ok: false as const, code: 'nothing_to_change_use_link' };
    }
    if (input.beneficiaryClientId != null) {
      const exists = await client.query(`SELECT 1 FROM clients WHERE id = $1`, [input.beneficiaryClientId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'client_not_found' };
      }
    }
    if (input.beneficiaryCandidateId != null) {
      const exists = await client.query(`SELECT 1 FROM candidates WHERE id = $1`, [input.beneficiaryCandidateId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false as const, code: 'candidate_not_found' };
      }
    }

    await client.query(
      `UPDATE service_requests
          SET beneficiary_client_id = $2,
              beneficiary_candidate_id = $3,
              installed_device_id = COALESCE($4, installed_device_id),
              contract_id = COALESCE($5, contract_id),
              updated_at = NOW()
        WHERE id = $1`,
      [
        input.serviceRequestId,
        input.beneficiaryClientId ?? null,
        input.beneficiaryCandidateId ?? null,
        input.installedDeviceId ?? null,
        input.contractId ?? null,
      ],
    );

    await appendAudit(client, {
      serviceRequestId: input.serviceRequestId,
      eventType: input.isChange ? 'linkage_changed' : 'party_linked',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      payload: input.isChange
        ? {
            old_target: {
              beneficiary_client_id: rows[0].beneficiary_client_id,
              beneficiary_candidate_id: rows[0].beneficiary_candidate_id,
            },
            new_target: {
              beneficiary_client_id: input.beneficiaryClientId ?? null,
              beneficiary_candidate_id: input.beneficiaryCandidateId ?? null,
            },
            reason: input.changeReason ?? null,
          }
        : {
            beneficiary_client_id: input.beneficiaryClientId ?? null,
            beneficiary_candidate_id: input.beneficiaryCandidateId ?? null,
            installed_device_id: input.installedDeviceId ?? null,
            contract_id: input.contractId ?? null,
          },
    });

    await client.query('COMMIT');
    return { ok: true as const };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

router.post('/:id/link', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await linkBeneficiary({
    serviceRequestId: Number(req.params.id),
    beneficiaryClientId: req.body.beneficiaryClientId ?? null,
    beneficiaryCandidateId: req.body.beneficiaryCandidateId ?? null,
    installedDeviceId: req.body.installedDeviceId ?? null,
    contractId: req.body.contractId ?? null,
    actorUserId: actor.userId,
    actorRole: 'operator',
    isChange: false,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.post('/:id/change-linkage', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await linkBeneficiary({
    serviceRequestId: Number(req.params.id),
    beneficiaryClientId: req.body.beneficiaryClientId ?? null,
    beneficiaryCandidateId: req.body.beneficiaryCandidateId ?? null,
    installedDeviceId: req.body.installedDeviceId ?? null,
    contractId: req.body.contractId ?? null,
    actorUserId: actor.userId,
    actorRole: 'operator',
    isChange: true,
    changeReason: req.body.reason ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.get('/:id/suggested-matches', requirePermission('service_requests.review'), async (req, res) => {
  // Load name + phone from the request's requester_external and use them as
  // the seed for the fuzzy search.
  const { rows } = await pool.query<{ name: string | null; phone: string | null }>(
    `SELECT requester_external->>'name' AS name,
            requester_external->>'primary_phone' AS phone
       FROM service_requests WHERE id = $1`,
    [Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  const suggestions = await suggestRecords({ name: rows[0].name, phone: rows[0].phone });
  res.json(suggestions);
});

// ------------------------------------------------------------
// LIFECYCLE TRANSITIONS via stateMachine
// ------------------------------------------------------------

function transitionEndpoint(
  endpointPerm: string,
  toStatus: ServiceRequestStatus,
  options: {
    actorRoleOverride?: ActorRole;
    bodyTriageOutcome?: (body: Record<string, unknown>) => string | undefined;
    bodyTriageNotes?: (body: Record<string, unknown>) => string | undefined;
  } = {},
) {
  return async (req: Request, res: Response) => {
    const actor = getActor(req);
    const result = await transitionStatus({
      serviceRequestId: Number(req.params.id),
      toStatus,
      actorUserId: actor.userId,
      actorRole: options.actorRoleOverride ?? 'operator',
      triageOutcome:
        options.bodyTriageOutcome?.(req.body) ?? (req.body.triageOutcome as string | undefined) ?? null,
      triageNotes:
        options.bodyTriageNotes?.(req.body) ?? (req.body.triageNotes as string | undefined) ?? null,
      note: req.body.note ?? null,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json(result.data);
  };
}

router.post(
  '/:id/request-info',
  requirePermission('service_requests.review'),
  transitionEndpoint('service_requests.review', 'awaiting_customer_info'),
);

router.post(
  '/:id/resume-review',
  requirePermission('service_requests.review'),
  transitionEndpoint('service_requests.review', 'in_review'),
);

router.post(
  '/:id/resolve-at-intake',
  requirePermission('service_requests.review'),
  transitionEndpoint('service_requests.review', 'resolved_at_intake'),
);

router.post('/:id/escalate', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE service_requests SET review_required_flag = TRUE, updated_at = NOW() WHERE id = $1`,
      [Number(req.params.id)],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'escalated_to_audit_admin',
      actorUserId: actor.userId,
      actorRole: 'operator',
      payload: { reason: req.body.reason ?? null },
    });
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'review_required_flag_set',
      actorUserId: actor.userId,
      actorRole: 'operator',
      payload: { reason: 'escalated_by_operator', auto: false },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post(
  '/:id/reject',
  requirePermission('service_requests.reject'),
  transitionEndpoint('service_requests.reject', 'rejected', { actorRoleOverride: 'audit_admin' }),
);

router.post(
  '/:id/cancel',
  requirePermission('service_requests.review'),
  transitionEndpoint('service_requests.review', 'cancelled'),
);

router.post('/:id/reopen', async (req, res) => {
  // role gate is per-terminal — let the service decide which role is required.
  const actor = getActor(req);
  const ctx = req.authContext!;
  // pick role: if user has reject perm → may act as audit_admin
  const hasReject = ctx.grants.some((g) => g.permission === 'service_requests.reject');
  const hasReview = ctx.grants.some((g) => g.permission === 'service_requests.review');
  if (!hasReject && !hasReview && !ctx.isSuperAdmin) {
    return res.status(403).json({ error: 'missing_permission' });
  }
  const actorRole: ActorRole = hasReject ? 'audit_admin' : 'operator';
  const result = await reopen({
    serviceRequestId: Number(req.params.id),
    actorUserId: actor.userId,
    actorRole,
    reopenReason: req.body.reason ?? '',
    note: req.body.note ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

// ------------------------------------------------------------
// PROMOTE / MERGE
// ------------------------------------------------------------

router.post('/:id/promote', requirePermission('service_requests.promote'), async (req, res) => {
  const actor = getActor(req);
  const result = await promote({
    serviceRequestId: Number(req.params.id),
    operatorUserId: actor.userId,
    splitAuthorized: !!req.body.splitAuthorized,
    splitReason: req.body.splitReason ?? null,
    externalDeviceModelId: req.body.externalDeviceModelId ?? null,
  });
  if (result.ok !== true) {
    if (result.code === 'merge_or_split_required') {
      // Pass collision context so the UI can render the merge/split modal.
      return res.status(409).json({
        error: 'merge_or_split_required',
        existingOpenTaskId: (result as { existingOpenTaskId: number }).existingOpenTaskId,
        installedDeviceId: (result as { installedDeviceId: number }).installedDeviceId,
      });
    }
    return sendErr(res, result as { code: string; message?: string });
  }
  res.json(result.data);
});

router.post('/:id/merge', requirePermission('service_requests.promote'), async (req, res) => {
  const actor = getActor(req);
  if (!req.body.existingOpenTaskId) {
    return res.status(400).json({ error: 'existingOpenTaskId_required' });
  }
  const result = await mergeIntoExistingTask({
    serviceRequestId: Number(req.params.id),
    existingOpenTaskId: Number(req.body.existingOpenTaskId),
    operatorUserId: actor.userId,
    mergeNote: req.body.note ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

// ------------------------------------------------------------
// ARCHIVE
// ------------------------------------------------------------

router.post('/:id/archive', requirePermission('service_requests.archive'), async (req, res) => {
  const actor = getActor(req);
  const ctx = req.authContext!;
  const hasReject = ctx.grants.some((g) => g.permission === 'service_requests.reject');
  const actorRole: ActorRole = hasReject ? 'audit_admin' : 'operator';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string; archived_at: string | null }>(
      `SELECT status, archived_at FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (rows[0].archived_at != null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'already_archived' });
    }
    const terminal = ['resolved_at_intake', 'rejected', 'promoted', 'cancelled'];
    if (!terminal.includes(rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'archive_requires_terminal_status' });
    }
    await client.query(
      `UPDATE service_requests SET archived_at = NOW(), archived_by_user_id = $2 WHERE id = $1`,
      [Number(req.params.id), actor.userId],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'archived',
      actorUserId: actor.userId,
      actorRole,
      payload: { reason: req.body.reason ?? null },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.post('/:id/unarchive', requirePermission('service_requests.archive'), async (req, res) => {
  const actor = getActor(req);
  const ctx = req.authContext!;
  const hasReject = ctx.grants.some((g) => g.permission === 'service_requests.reject');
  const actorRole: ActorRole = hasReject ? 'audit_admin' : 'operator';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ archived_at: string | null }>(
      `SELECT archived_at FROM service_requests WHERE id = $1 FOR UPDATE`,
      [Number(req.params.id)],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (rows[0].archived_at == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'not_archived' });
    }
    await client.query(
      `UPDATE service_requests SET archived_at = NULL, archived_by_user_id = NULL WHERE id = $1`,
      [Number(req.params.id)],
    );
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'unarchived',
      actorUserId: actor.userId,
      actorRole,
      payload: { reason: req.body.reason ?? null },
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// INTERNAL NOTES
// ------------------------------------------------------------

router.post('/:id/notes', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  if (!req.body.note || String(req.body.note).trim().length === 0) {
    return res.status(400).json({ error: 'note_required' });
  }
  const client = await pool.connect();
  try {
    await appendAudit(client, {
      serviceRequestId: Number(req.params.id),
      eventType: 'internal_note_added',
      actorUserId: actor.userId,
      actorRole: 'operator',
      note: String(req.body.note),
    });
    res.status(201).json({ ok: true });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------
// PROBLEMS (٠.١٩) — per-phase auth left to caller; we expose actions.
// ------------------------------------------------------------

router.post('/:id/problems', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await addProblem({
    serviceRequestId: Number(req.params.id),
    installedDeviceId: Number(req.body.installedDeviceId),
    problemTypeId: Number(req.body.problemTypeId),
    details: req.body.details ?? null,
    addedDuringPhase: (req.body.addedDuringPhase as AddedDuringPhase) ?? 'in_review',
    createdByUserId: actor.userId,
    creatorRoleSnapshot: req.body.creatorRoleSnapshot ?? 'operator',
    resolveAtIntake: !!req.body.resolveAtIntake,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  // Phase 6c.1 — field_discovery additions during a visit need the
  // open_task_id stamped immediately so the problem appears in the
  // wizard's problems list. Optional body param keeps the route
  // backward compatible for intake-time additions.
  if (req.body.openTaskId) {
    await pool.query(
      `UPDATE service_request_problems
          SET open_task_id = $2, updated_at = NOW()
        WHERE id = $1 AND open_task_id IS NULL`,
      [result.data.id, Number(req.body.openTaskId)],
    );
  }
  res.status(201).json(result.data);
});

router.patch('/:id/problems/:pid', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await editProblem({
    problemId: Number(req.params.pid),
    problemTypeId: req.body.problemTypeId,
    details: req.body.details,
    editorUserId: actor.userId,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.patch('/:id/problems/:pid/status', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await changeProblemStatus({
    problemId: Number(req.params.pid),
    toStatus: req.body.toStatus as ProblemStatus,
    actorUserId: actor.userId,
    actorRole: 'operator',
    resolutionRecordedByUserId: req.body.resolutionRecordedByUserId ?? null,
    repairedByEmployeeId: req.body.repairedByEmployeeId ?? null,
    resolutionVisitTaskId: req.body.resolutionVisitTaskId ?? null,
    repairTeamSnapshot: req.body.repairTeamSnapshot ?? null,
    resolutionNotes: req.body.resolutionNotes ?? null,
    reason: req.body.reason ?? null,
    noResolveReason: req.body.noResolveReason ?? null,
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json(result.data);
});

router.post(
  '/:id/problems/:pid/record-resolution',
  requirePermission('service_requests.review'),
  async (req, res) => {
    // Shortcut: changes status to 'resolved' and fills resolution fields.
    const actor = getActor(req);
    const result = await changeProblemStatus({
      problemId: Number(req.params.pid),
      toStatus: 'resolved',
      actorUserId: actor.userId,
      actorRole: 'operator',
      resolutionRecordedByUserId: req.body.resolutionRecordedByUserId ?? actor.userId,
      repairedByEmployeeId: req.body.repairedByEmployeeId,
      resolutionVisitTaskId: req.body.resolutionVisitTaskId ?? null,
      repairTeamSnapshot: req.body.repairTeamSnapshot ?? null,
      resolutionNotes: req.body.resolutionNotes ?? null,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json(result.data);
  },
);

router.delete('/:id/problems/:pid', requirePermission('service_requests.review'), async (req, res) => {
  const actor = getActor(req);
  const result = await softDeleteProblem({
    problemId: Number(req.params.pid),
    reason: String(req.body.reason ?? ''),
    actorUserId: actor.userId,
    actorRole: 'operator',
  });
  if (result.ok !== true) return sendErr(res, result);
  res.json({ ok: true });
});

router.post(
  '/:id/problems/:pid/restore',
  requirePermission('service_requests.reject'), // audit-admin perm gates restore
  async (req, res) => {
    const actor = getActor(req);
    const result = await restoreProblem({
      problemId: Number(req.params.pid),
      reason: String(req.body.reason ?? ''),
      actorUserId: actor.userId,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json({ ok: true });
  },
);

router.post(
  '/:id/problems/:pid/override',
  requirePermission('service_requests.reject'), // audit-admin perm gates override
  async (req, res) => {
    const actor = getActor(req);
    const result = await auditAdminOverride({
      problemId: Number(req.params.pid),
      newStatus: req.body.newStatus as ProblemStatus,
      reason: String(req.body.reason ?? ''),
      actorUserId: actor.userId,
    });
    if (result.ok !== true) return sendErr(res, result);
    res.json(result.data);
  },
);

export default router;
