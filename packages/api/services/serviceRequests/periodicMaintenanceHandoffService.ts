import type { PoolClient } from 'pg';
import { createPeriodicMaintenanceTaskFromServiceRequest } from '../periodicMaintenanceTasks.js';
import { acquireTx, appendAudit, commitTx, rollbackTx } from './_shared.js';

export async function handoffPeriodicMaintenanceRequest(input: {
  serviceRequestId: number;
  operatorUserId: number;
  deviceLocationDecision?: 'registered_location_confirmed' | null;
}, db?: PoolClient) {
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      id: number; request_type: string; status: string; beneficiary_client_id: number | null;
      installed_device_id: number | null; reviewed_by_user_id: number | null;
      linked_open_task_id: number | null; service_address: Record<string, unknown> | null;
      periodic_maintenance_reason_id: number | null;
      periodic_maintenance_reason_snapshot: Record<string, unknown> | null;
    }>(
      `SELECT id, request_type, status, beneficiary_client_id, installed_device_id,
              reviewed_by_user_id, linked_open_task_id, service_address,
              periodic_maintenance_reason_id, periodic_maintenance_reason_snapshot
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    const request = rows[0];
    if (!request) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'not_found' };
    }
    if (request.request_type !== 'periodic_maintenance') {
      await rollbackTx(tx);
      return { ok: false as const, code: 'wrong_request_type_for_periodic_handoff' };
    }
    if (request.status === 'promoted' && request.linked_open_task_id != null) {
      await commitTx(tx);
      return {
        ok: true as const,
        data: { openTaskId: Number(request.linked_open_task_id), alreadyHandedOff: true },
      };
    }
    if (request.status !== 'in_review' || request.reviewed_by_user_id == null) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'handoff_requires_claim', details: { status: request.status } };
    }
    if (request.beneficiary_client_id == null) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'beneficiary_client_required' };
    }
    if (request.installed_device_id == null) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'installed_device_id_required' };
    }
    if (request.periodic_maintenance_reason_id == null || !request.periodic_maintenance_reason_snapshot) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'periodic_maintenance_reason_required' };
    }

    const { rows: deviceRows } = await tx.client.query<{
      customer_id: number | null; branch_id: number | null;
      installation_geo_unit_id: number | null; installation_address_text: string | null;
    }>(
      `SELECT customer_id, branch_id, installation_geo_unit_id, installation_address_text
         FROM installed_devices
        WHERE id = $1
        FOR UPDATE`,
      [request.installed_device_id],
    );
    const device = deviceRows[0];
    if (!device) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'installed_device_not_found' };
    }
    if (Number(device.customer_id) !== Number(request.beneficiary_client_id)) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'installed_device_beneficiary_mismatch' };
    }
    if (device.branch_id == null) {
      await rollbackTx(tx);
      return { ok: false as const, code: 'installed_device_branch_required' };
    }

    const reportedGeoUnitId = Number(request.service_address?.geo_unit_id ?? 0) || null;
    const reportedAddressText = String(
      request.service_address?.detailed_address
      ?? request.service_address?.address_text
      ?? '',
    ).trim() || null;
    const registeredAddressText = device.installation_address_text?.trim() || null;
    const locationDiffers = (
      reportedGeoUnitId != null
      && device.installation_geo_unit_id != null
      && reportedGeoUnitId !== Number(device.installation_geo_unit_id)
    ) || (
      reportedAddressText != null
      && registeredAddressText != null
      && reportedAddressText !== registeredAddressText
    );
    if (locationDiffers && input.deviceLocationDecision !== 'registered_location_confirmed') {
      await rollbackTx(tx);
      return {
        ok: false as const,
        code: 'device_location_decision_required',
        details: {
          reportedGeoUnitId,
          registeredGeoUnitId: device.installation_geo_unit_id,
          reportedAddressText,
          registeredAddressText,
        },
      };
    }

    const { rows: transferRows } = await tx.client.query<{ id: number }>(
      `SELECT id FROM open_tasks
        WHERE task_type = 'device_transfer'
          AND device_id = $1
          AND status NOT IN ('completed', 'closed', 'cancelled')
        LIMIT 1`,
      [request.installed_device_id],
    );
    if (transferRows[0]) {
      await rollbackTx(tx);
      return {
        ok: false as const,
        code: 'active_device_transfer_blocks_handoff',
        details: { openTaskId: Number(transferRows[0].id) },
      };
    }

    const created = await createPeriodicMaintenanceTaskFromServiceRequest(tx.client, {
      serviceRequestId: request.id,
      installedDeviceId: request.installed_device_id,
      requestReasonId: request.periodic_maintenance_reason_id,
      requestReasonSnapshot: request.periodic_maintenance_reason_snapshot,
      createdByUserId: input.operatorUserId,
    });
    if (created.outcome === 'active_task_exists') {
      await rollbackTx(tx);
      return {
        ok: false as const,
        code: 'active_periodic_task_exists',
        details: { openTaskId: created.taskId },
      };
    }
    if (created.outcome === 'ineligible' || created.outcome === 'missing_schedule_anchor') {
      await rollbackTx(tx);
      return {
        ok: false as const,
        code: 'periodic_maintenance_ineligible',
        details: { reason: created.reason },
      };
    }

    await tx.client.query(
      `UPDATE service_requests
          SET status = 'promoted',
              triage_outcome = 'new_periodic_task_created',
              linked_open_task_id = $2,
              branch_id = $3,
              branch_resolution_status = 'resolved',
              branch_resolution_reason = 'installed_device_branch',
              device_location_decision = 'registered_location_confirmed',
              device_location_decided_by_user_id = $4,
              device_location_decided_at = NOW(),
              closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [request.id, created.taskId, created.branchId, input.operatorUserId],
    );
    await appendAudit(tx.client, {
      serviceRequestId: request.id,
      eventType: 'status_changed',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: { from: 'in_review', to: 'promoted', via: 'periodic_maintenance_handoff' },
    });
    await appendAudit(tx.client, {
      serviceRequestId: request.id,
      eventType: 'promoted_to_task',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: {
        open_task_id: created.taskId,
        installed_device_id: request.installed_device_id,
        branch_id: created.branchId,
        due_date: created.dueDate,
        interval_days: created.intervalDays,
        generation_origin: 'service_request',
      },
    });
    await commitTx(tx);
    return {
      ok: true as const,
      data: {
        openTaskId: created.taskId,
        dueDate: created.dueDate,
        intervalDays: created.intervalDays,
        alreadyHandedOff: false,
      },
    };
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}
