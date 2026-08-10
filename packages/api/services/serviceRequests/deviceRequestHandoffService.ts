import type { PoolClient } from 'pg';
import { persistOpenTaskSnapshots } from '../../routes/openTasks.js';
import { acquireTx, appendAudit, commitTx, rollbackTx, type ServiceResult } from './_shared.js';

export interface DeviceRequestHandoffInput {
  serviceRequestId: number;
  operatorUserId: number;
  employeeId: number;
  deviceModelIds: number[];
  inactiveModelsConfirmed?: boolean;
  priority?: 'high' | 'medium' | 'low' | null;
  dueDate?: string | null;
  operatorNote?: string | null;
}

export async function handoffDeviceRequestToDemo(
  input: DeviceRequestHandoffInput,
  db?: PoolClient,
): Promise<ServiceResult<{ openTaskId: number; alreadyHandedOff: boolean }>> {
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      id: number; status: string; request_type: string; beneficiary_client_id: number | null;
      branch_id: number | null; branch_resolution_status: string | null; linked_open_task_id: number | null;
      problem_description: string; device_request_purpose_snapshot: Record<string, unknown> | null;
    }>(
      `SELECT id, status, request_type, beneficiary_client_id, branch_id,
              branch_resolution_status, linked_open_task_id, problem_description,
              device_request_purpose_snapshot
         FROM service_requests WHERE id = $1 FOR UPDATE`,
      [input.serviceRequestId],
    );
    const request = rows[0];
    if (!request) { await rollbackTx(tx); return { ok: false, code: 'not_found' }; }
    if (request.request_type !== 'device_request') {
      await rollbackTx(tx); return { ok: false, code: 'wrong_request_type_for_device_request_handoff' };
    }
    if (request.linked_open_task_id != null) {
      await commitTx(tx);
      return { ok: true, data: { openTaskId: Number(request.linked_open_task_id), alreadyHandedOff: true } };
    }
    if (request.status !== 'in_review') {
      await rollbackTx(tx); return { ok: false, code: 'invalid_status_for_device_request_handoff', details: { status: request.status } };
    }
    if (request.beneficiary_client_id == null) {
      await rollbackTx(tx); return { ok: false, code: 'beneficiary_client_required' };
    }
    if (request.branch_id == null || request.branch_resolution_status !== 'resolved') {
      await rollbackTx(tx); return { ok: false, code: 'device_request_branch_required' };
    }

    const modelIds = [...new Set(input.deviceModelIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (modelIds.length === 0) {
      await rollbackTx(tx); return { ok: false, code: 'device_model_required' };
    }
    const { rows: modelRows } = await tx.client.query<{ id: number; name: string; is_active: boolean }>(
      `SELECT id, COALESCE(name_ar, name_en, name) AS name, is_active
         FROM device_models WHERE id = ANY($1::int[])`,
      [modelIds],
    );
    if (modelRows.length !== modelIds.length) {
      await rollbackTx(tx); return { ok: false, code: 'device_model_not_found' };
    }
    const inactive = modelRows.filter((row) => row.is_active !== true).map((row) => ({ id: Number(row.id), name: row.name }));
    if (inactive.length > 0 && input.inactiveModelsConfirmed !== true) {
      await rollbackTx(tx);
      return { ok: false, code: 'inactive_device_models_confirmation_required', details: { models: inactive } };
    }

    const { rows: interestRows } = await tx.client.query<{ device_model_id: number | null }>(
      `SELECT device_model_id FROM service_request_device_interests
        WHERE service_request_id = $1 ORDER BY selection_order`,
      [request.id],
    );
    const requestedIds = interestRows.map((row) => Number(row.device_model_id)).filter((id) => Number.isInteger(id) && id > 0);
    if (requestedIds.length > 0 && !modelIds.some((id) => requestedIds.includes(id))) {
      await rollbackTx(tx);
      return { ok: false, code: 'requested_device_model_required', details: { requestedDeviceModelIds: requestedIds } };
    }

    const { rows: employeeRows } = await tx.client.query<{ id: number }>(
      `SELECT id FROM employees
        WHERE id = $1 AND status = 'active' AND branch_id = $2 LIMIT 1`,
      [input.employeeId, request.branch_id],
    );
    if (!employeeRows[0]) {
      await rollbackTx(tx); return { ok: false, code: 'eligible_employee_not_found' };
    }
    const { rows: typeRows } = await tx.client.query<{ is_active: boolean }>(
      `SELECT is_active FROM task_type_config WHERE task_type = 'device_demo' LIMIT 1`,
    );
    if (!typeRows[0]?.is_active) {
      await rollbackTx(tx); return { ok: false, code: 'device_demo_task_type_inactive' };
    }
    const { rows: activeRows } = await tx.client.query<{ id: number; status: string }>(
      `SELECT id, status FROM open_tasks
        WHERE client_id = $1 AND task_type = 'device_demo'
          AND status NOT IN ('completed','closed','cancelled')
        ORDER BY created_at DESC LIMIT 1`,
      [request.beneficiary_client_id],
    );
    if (activeRows[0]) {
      await rollbackTx(tx);
      return { ok: false, code: 'active_device_demo_exists', details: { existingTaskId: activeRows[0].id, existingTaskStatus: activeRows[0].status } };
    }

    const purposeLabel = typeof request.device_request_purpose_snapshot?.label === 'string'
      ? request.device_request_purpose_snapshot.label : 'طلب جهاز';
    const notes = [
      `مصدر المهمة: طلب جهاز #${request.id}`,
      `الغرض: ${purposeLabel}`,
      request.problem_description ? `الملاحظات: ${request.problem_description}` : null,
      input.operatorNote?.trim() ? `ملاحظة الموظف: ${input.operatorNote.trim()}` : null,
    ].filter(Boolean).join('\n');
    const { rows: taskRows } = await tx.client.query<{ id: number }>(
      `INSERT INTO open_tasks (
         client_id, branch_id, task_type, task_family, reason, status,
         due_date, priority, source, notes, created_by, origin, creation_origin,
         source_service_request_id, source_context_type, source_context_id, requested_employee_id
       ) VALUES (
         $1, $2, 'device_demo', 'marketing', 'device_demo', 'open',
         $3, $4, 'service_request', $5, $6, 'service_request', 'manual_creation',
         $7, 'service_request', $7, $8
       ) RETURNING id`,
      [request.beneficiary_client_id, request.branch_id, input.dueDate ?? null,
        input.priority ?? 'medium', notes, input.operatorUserId, request.id, input.employeeId],
    );
    const openTaskId = Number(taskRows[0].id);
    const modelById = new Map(modelRows.map((row) => [Number(row.id), row]));
    for (const modelId of modelIds) {
      const model = modelById.get(modelId)!;
      await tx.client.query(
        `INSERT INTO open_task_devices (task_id, device_model_id, device_name_snapshot, quantity)
         VALUES ($1, $2, $3, 1)`,
        [openTaskId, modelId, model.name],
      );
    }
    await persistOpenTaskSnapshots(tx.client, openTaskId, Number(request.beneficiary_client_id), null, null);
    await tx.client.query(
      `UPDATE service_requests
          SET status = 'promoted', triage_outcome = 'needs_field_intervention',
              linked_open_task_id = $2, closed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [request.id, openTaskId],
    );
    await appendAudit(tx.client, {
      serviceRequestId: request.id,
      eventType: 'promoted_to_task',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: { request_type: 'device_request', open_task_id: openTaskId, task_type: 'device_demo',
        employee_id: input.employeeId, device_model_ids: modelIds, branch_id: request.branch_id },
    });
    await commitTx(tx);
    return { ok: true, data: { openTaskId, alreadyHandedOff: false } };
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}
