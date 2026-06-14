// ============================================================
// serviceRequests/promoteService.ts
// ============================================================
// Constitution source:
//   §SR-R004     promote prerequisites (beneficiary + installed_device_id +
//                open_task within same tx + linked_open_task_id stored)
//   §SR-AUTH-02  promote requires beneficiary link + installed_device_id
//   §SR-AUTH-06  open_tasks.branch_id computed from beneficiary client
//   §٠.١٣        external_device path: synthesize a lightweight installed_device
//   §EM-UNIQ-01  partial unique on open_tasks(device_id) for active emergency
//   §EM-UNIQ-02  promote enforces merge OR split decision
//   §EM-UNIQ-03  merge: existing open_task gets `additional_report_attached`
//                event; new open_task is NOT created
//   §EM-UNIQ-04  split: needs override reason + audit-admin permission
//                (enforced at endpoint layer; here we require a flag)
//   §P-MAINT-10  open_task_emergency_payload (1:1 UNIQUE FK)
//
// This service handles two flows:
//   1. promote(requestId, options)        — fresh promotion (may detect collision)
//   2. mergeIntoExistingTask(requestId,…) — explicit merge into an existing
//                                            emergency task (EM-UNIQ-03 path)
//
// Both flows transition the service_request through transitionStatus to
// `promoted` with triage_outcome = 'needs_field_intervention'.
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
import { persistOpenTaskSnapshots } from '../../routes/openTasks.js';

export interface PromoteInput {
  serviceRequestId: number;
  operatorUserId: number;
  /** When true, bypasses EM-UNIQ-01 collision (caller asserts split was
   *  authorized by audit admin with an override reason). EM-UNIQ-04. */
  splitAuthorized?: boolean;
  splitReason?: string | null;
  /** For external_device: optional model id when admin can map it. */
  externalDeviceModelId?: number | null;
}

export interface PromoteOutput {
  newOpenTaskId: number;
  installedDeviceId: number;
  externalDeviceCreated: boolean;
  branchId: number;
}

export interface PromoteCollision {
  code: 'merge_or_split_required';
  existingOpenTaskId: number;
  installedDeviceId: number;
}

export type PromoteResult =
  | ServiceResult<PromoteOutput>
  | { ok: false; code: 'merge_or_split_required'; existingOpenTaskId: number; installedDeviceId: number };

export async function promote(
  input: PromoteInput,
  db?: PoolClient,
): Promise<PromoteResult> {
  const tx = await acquireTx(db);
  try {
    // 1. Load + lock the service request.
    const { rows } = await tx.client.query<{
      id: number;
      status: string;
      channel: string;
      beneficiary_client_id: number | null;
      beneficiary_candidate_id: number | null;
      contract_id: number | null;
      device_source: 'company_device' | 'external_device' | null;
      installed_device_id: number | null;
      external_device_name: string | null;
      external_device_serial: string | null;
      problem_description: string;
      requested_action_type_id: number | null;
      service_address: Record<string, unknown> | null;
      priority: string | null;
    }>(
      `SELECT id, status, channel, beneficiary_client_id, beneficiary_candidate_id,
              contract_id, device_source, installed_device_id,
              external_device_name, external_device_serial,
              problem_description, requested_action_type_id,
              service_address, priority
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (rows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const sr = rows[0];

    if (sr.status !== 'in_review') {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'invalid_status_for_promote',
        details: { status: sr.status },
      };
    }

    // 2. SR-R004 / SR-AUTH-02 — beneficiary link required.
    // Per the constitution, candidate-only beneficiaries cannot promote
    // directly to an open_task because open_tasks.client_id FK demands
    // a real client. Operator must first convert candidate → client.
    if (sr.beneficiary_client_id == null) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'beneficiary_client_required',
        message: 'SR-R004/SR-AUTH-02: link a client beneficiary before promote',
      };
    }
    const clientId = sr.beneficiary_client_id;

    // 3. Resolve installed_device_id — company path or external.
    let installedDeviceId: number | null = sr.installed_device_id;
    let externalDeviceCreated = false;

    if (sr.device_source === 'external_device') {
      const created = await createLightweightInstalledDevice(
        tx.client,
        clientId,
        sr.external_device_name,
        sr.external_device_serial,
        sr.service_address,
        input.externalDeviceModelId ?? null,
      );
      if (created.ok !== true) {
        await rollbackTx(tx);
        return created as ServiceResult<PromoteOutput>;
      }
      installedDeviceId = created.data.id;
      externalDeviceCreated = true;
      // Persist back on the request so subsequent reads see the link.
      await tx.client.query(
        `UPDATE service_requests SET installed_device_id = $2 WHERE id = $1`,
        [sr.id, installedDeviceId],
      );
    }
    if (installedDeviceId == null) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'installed_device_id_required',
        message: 'SR-AUTH-02: company_device path requires installed_device_id linkage',
      };
    }

    // 4. SR-AUTH-06 — compute branch from client.
    const { rows: branchRows } = await tx.client.query<{ branch_id: number | null }>(
      `SELECT branch_id FROM clients WHERE id = $1`,
      [clientId],
    );
    const branchId = branchRows[0]?.branch_id ?? null;
    if (branchId == null) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'client_branch_required',
        message: 'SR-AUTH-06: beneficiary client must have a branch_id',
      };
    }

    // 5. EM-UNIQ-01 — check for an active emergency on this device.
    if (!input.splitAuthorized) {
      const { rows: existingRows } = await tx.client.query<{ id: number }>(
        `SELECT id FROM open_tasks
          WHERE task_type = 'emergency_maintenance'
            AND device_id = $1
            AND status NOT IN ('completed', 'closed', 'cancelled')
          LIMIT 1`,
        [installedDeviceId],
      );
      if (existingRows.length > 0) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'merge_or_split_required',
          existingOpenTaskId: existingRows[0].id,
          installedDeviceId,
        };
      }
    }

    // 6. INSERT open_task.
    // Map service_request priority (Critical/High/Normal/Low) to the
    // open_tasks CHECK domain (high/medium/low/NULL).
    const priorityMap: Record<string, 'high' | 'medium' | 'low' | null> = {
      Critical: 'high',
      High: 'high',
      Normal: 'medium',
      Low: 'low',
    };
    const openTaskPriority = sr.priority ? priorityMap[sr.priority] ?? null : null;
    // maintenance.md §٧ — emergency task due_date defaults to NOW + 48h
    // (2 days from promotion). Stored as DATE.
    const { rows: taskRows } = await tx.client.query<{ id: number }>(
      `INSERT INTO open_tasks (
         client_id, branch_id, contract_id,
         task_type, task_family, reason,
         status, source, creation_origin,
         priority, notes, created_by,
         device_id,
         source_service_request_id,
         due_date
       ) VALUES (
         $1, $2, $3,
         'emergency_maintenance', 'emergency', 'service_request',
         'open', 'service_request', 'emergency_request',
         $4, $5, $6,
         $7,
         $8,
         (CURRENT_DATE + INTERVAL '2 days')::date
       )
       RETURNING id`,
      [
        clientId,
        branchId,
        sr.contract_id,
        openTaskPriority,
        sr.problem_description,
        input.operatorUserId,
        installedDeviceId,
        sr.id,
      ],
    );
    const newOpenTaskId = taskRows[0].id;

    // 7. Snapshots (reuse existing helper).
    await persistOpenTaskSnapshots(
      tx.client,
      newOpenTaskId,
      clientId,
      sr.contract_id ?? null,
      installedDeviceId ?? null,
    );

    // 8. INSERT open_task_emergency_payload (P-MAINT-10).
    await tx.client.query(
      `INSERT INTO open_task_emergency_payload
         (open_task_id, source_service_request_id,
          reported_problem_snapshot, reported_action_type_id)
       VALUES ($1, $2, $3, $4)`,
      [newOpenTaskId, sr.id, sr.problem_description, sr.requested_action_type_id],
    );

    // 9. Move problems to the new task (open_task_id transfer, no copy).
    await tx.client.query(
      `UPDATE service_request_problems
          SET open_task_id = $2, updated_at = NOW()
        WHERE service_request_id = $1
          AND deleted_at IS NULL
          AND open_task_id IS NULL`,
      [sr.id, newOpenTaskId],
    );

    // 10. Mark the service request promoted.
    await tx.client.query(
      `UPDATE service_requests
          SET status = 'promoted',
              triage_outcome = 'needs_field_intervention',
              linked_open_task_id = $2,
              closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [sr.id, newOpenTaskId],
    );

    // 11. Audit events.
    await appendAudit(tx.client, {
      serviceRequestId: sr.id,
      eventType: 'status_changed',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: { from: 'in_review', to: 'promoted', via: 'promote' },
    });
    await appendAudit(tx.client, {
      serviceRequestId: sr.id,
      eventType: 'promoted_to_task',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: {
        open_task_id: newOpenTaskId,
        branch_id: branchId,
        installed_device_id: installedDeviceId,
        external_device_created: externalDeviceCreated,
        split_authorized: !!input.splitAuthorized,
        split_reason: input.splitAuthorized ? input.splitReason ?? null : undefined,
      },
    });

    await commitTx(tx);
    return {
      ok: true,
      data: {
        newOpenTaskId,
        installedDeviceId,
        externalDeviceCreated,
        branchId,
      },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

// ============================================================
// EM-UNIQ-03 — merge into existing emergency task
// ============================================================

export interface MergeInput {
  serviceRequestId: number;
  existingOpenTaskId: number;
  operatorUserId: number;
  mergeNote?: string | null;
}

export async function mergeIntoExistingTask(
  input: MergeInput,
  db?: PoolClient,
): Promise<ServiceResult<{ mergedIntoOpenTaskId: number }>> {
  const tx = await acquireTx(db);
  try {
    // Validate request is in_review.
    const { rows: srRows } = await tx.client.query<{
      id: number;
      status: string;
      problem_description: string;
      beneficiary_client_id: number | null;
    }>(
      `SELECT id, status, problem_description, beneficiary_client_id
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    if (srRows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'not_found' };
    }
    const sr = srRows[0];
    if (sr.status !== 'in_review') {
      await rollbackTx(tx);
      return { ok: false, code: 'invalid_status_for_merge', details: { status: sr.status } };
    }

    // Validate existing task is active emergency for same client.
    const { rows: otRows } = await tx.client.query<{
      id: number;
      task_type: string;
      status: string;
      client_id: number;
    }>(
      `SELECT id, task_type, status, client_id
         FROM open_tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.existingOpenTaskId],
    );
    if (otRows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'existing_open_task_not_found' };
    }
    const ot = otRows[0];
    if (ot.task_type !== 'emergency_maintenance') {
      await rollbackTx(tx);
      return { ok: false, code: 'existing_task_not_emergency' };
    }
    if (['completed', 'closed', 'cancelled'].includes(ot.status)) {
      await rollbackTx(tx);
      return { ok: false, code: 'existing_task_not_active', details: { status: ot.status } };
    }
    if (sr.beneficiary_client_id != null && ot.client_id !== sr.beneficiary_client_id) {
      await rollbackTx(tx);
      return { ok: false, code: 'beneficiary_mismatch' };
    }

    // Move problems to the existing task.
    await tx.client.query(
      `UPDATE service_request_problems
          SET open_task_id = $2, updated_at = NOW()
        WHERE service_request_id = $1
          AND deleted_at IS NULL
          AND open_task_id IS NULL`,
      [sr.id, input.existingOpenTaskId],
    );

    // Mark request promoted (linked to existing task — EM-UNIQ-05).
    await tx.client.query(
      `UPDATE service_requests
          SET status = 'promoted',
              triage_outcome = 'needs_field_intervention',
              linked_open_task_id = $2,
              closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [sr.id, input.existingOpenTaskId],
    );

    // Record an attached-report event on the EXISTING open_task's activity log
    // (task_activity_log uses event_type CHECK so we go through 'note_added').
    await tx.client.query(
      `INSERT INTO task_activity_log
         (task_id, event_type, performed_by, role, new_value, reason)
       VALUES ($1, 'note_added', $2, 'operator', $3, $4)`,
      [
        input.existingOpenTaskId,
        input.operatorUserId,
        sr.problem_description,
        `additional_report_attached from service_request #${sr.id}`,
      ],
    );

    // Audit on the service_request.
    await appendAudit(tx.client, {
      serviceRequestId: sr.id,
      eventType: 'status_changed',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: { from: 'in_review', to: 'promoted', via: 'merge' },
    });
    await appendAudit(tx.client, {
      serviceRequestId: sr.id,
      eventType: 'merged_into_existing_task',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: {
        merged_into_open_task_id: input.existingOpenTaskId,
        note: input.mergeNote ?? null,
      },
    });

    await commitTx(tx);
    return { ok: true, data: { mergedIntoOpenTaskId: input.existingOpenTaskId } };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}

// ============================================================
// helpers
// ============================================================

async function createLightweightInstalledDevice(
  db: PoolClient,
  customerId: number,
  externalDeviceName: string | null,
  externalDeviceSerial: string | null,
  serviceAddress: Record<string, unknown> | null,
  modelId: number | null,
): Promise<ServiceResult<{ id: number }>> {
  // §٠.١٣ — synthesize installed_device for external. No contract, no warranty.
  // Note: installed_devices.contract_id is NOT NULL in current schema. We need
  // a sentinel "no-contract" path. For V1.0, we surface a clear error here and
  // require the operator to either: (a) link an existing installed_device, or
  // (b) the admin schema-evolution to allow NULL contract for external devices.
  // The implementation plan acknowledges this in §٠.١٣ but the migration to
  // relax contract_id NOT NULL is intentionally deferred.
  if (!externalDeviceName || externalDeviceName.trim().length === 0) {
    return { ok: false, code: 'external_device_name_required' };
  }
  // Probe NOT NULL constraint on contract_id.
  // (Documented limitation — promoted as a known V1.0 gap.)
  // Attempt INSERT and let DB reject if constraint forbids NULL.
  try {
    const geoUnitId =
      (serviceAddress?.['geo_unit_id'] as number | undefined) ?? null;
    const addressText =
      (serviceAddress?.['address_text'] as string | undefined) ??
      (serviceAddress?.['text'] as string | undefined) ??
      null;
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO installed_devices (
         contract_id, customer_id, branch_id, device_source,
         device_model_id, device_model_name,
         external_device_name, external_device_serial,
         serial_number, status, installation_geo_unit_id, installation_address_text,
         is_golden_warranty, warranty_months, warranty_visits
       )
       SELECT
         NULL, c.id, c.branch_id, 'external',
         $2, $3,
         $3, $4,
         $4, 'active', $5, $6,
         false, NULL, NULL
       FROM clients c
       WHERE c.id = $1
       RETURNING id`,
      [
        customerId,
        modelId,
        externalDeviceName,
        externalDeviceSerial,
        geoUnitId,
        addressText,
      ],
    );
    if (!rows[0]) return { ok: false, code: 'client_not_found' };
    return { ok: true, data: { id: rows[0].id } };
  } catch (err: unknown) {
    const pgErr = err as { code?: string; constraint?: string; message?: string };
    if (pgErr?.code === '23502') {
      return {
        ok: false,
        code: 'external_device_required_field_missing',
        message:
          '§٠.١٣ V1.0 gap: installed_devices.contract_id NOT NULL blocks external_device synthesis. Migration pending.',
      };
    }
    throw err;
  }
}
