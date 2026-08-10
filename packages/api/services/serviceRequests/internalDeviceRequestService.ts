import type { PoolClient } from 'pg';
import { acquireTx, commitTx, rollbackTx, type ActorRole, type ServiceResult } from './_shared.js';
import { createServiceRequest, type CreatedServiceRequest } from './createService.js';

export interface InternalDeviceRequestInput {
  channel: 'phone' | 'internal_button' | 'client_detail_button' | 'admin_manual';
  applicationSource?: string | null;
  requesterClientId?: number | null;
  requesterExternal?: Record<string, unknown> | null;
  beneficiaryClientId: number;
  beneficiaryExternal?: Record<string, unknown> | null;
  referrerClientId?: number | null;
  referrerExternal?: Record<string, unknown> | null;
  submissionType?: 'apply' | 'refer_a_candidate';
  purposeId: number;
  deviceModelIds?: number[];
  notes?: string | null;
  serviceAddress?: Record<string, unknown> | null;
  sourceCallLogId?: string | null;
  actorUserId: number;
  actorRole: ActorRole;
}

export async function createInternalDeviceRequest(
  input: InternalDeviceRequestInput,
  db?: PoolClient,
): Promise<ServiceResult<CreatedServiceRequest>> {
  const tx = await acquireTx(db);
  try {
    const { rows: clientRows } = await tx.client.query<{ id: number; branch_id: number | null }>(
      `SELECT id, branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [input.beneficiaryClientId],
    );
    const beneficiary = clientRows[0];
    if (!beneficiary) { await rollbackTx(tx); return { ok: false, code: 'beneficiary_client_not_found' }; }
    if (beneficiary.branch_id == null) { await rollbackTx(tx); return { ok: false, code: 'beneficiary_branch_required' }; }

    const { rows: purposeRows } = await tx.client.query<{ id: number; value: string; metadata: Record<string, unknown> }>(
      `SELECT id, value, metadata FROM system_lists
        WHERE id = $1 AND category = 'device_request_purpose' AND is_active = TRUE LIMIT 1`,
      [input.purposeId],
    );
    const purpose = purposeRows[0];
    if (!purpose) { await rollbackTx(tx); return { ok: false, code: 'device_request_purpose_not_found' }; }
    const purposeSnapshot = { id: Number(purpose.id), code: String(purpose.metadata?.code ?? purpose.value), label: purpose.value };

    const modelIds = [...new Set((input.deviceModelIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const { rows: modelRows } = modelIds.length === 0 ? { rows: [] as Array<{ id: number; name: string }> }
      : await tx.client.query<{ id: number; name: string }>(
        `SELECT id, COALESCE(name_ar, name_en, name) AS name
           FROM device_models WHERE id = ANY($1::int[]) AND is_active = TRUE`,
        [modelIds],
      );
    if (modelRows.length !== modelIds.length) {
      await rollbackTx(tx); return { ok: false, code: 'invalid_or_inactive_device_model_ids' };
    }
    const notes = input.notes?.trim() ?? '';
    if ((modelIds.length === 0 || purposeSnapshot.code === 'other') && !notes) {
      await rollbackTx(tx); return { ok: false, code: 'device_request_notes_required' };
    }
    const modelById = new Map(modelRows.map((row) => [Number(row.id), row]));
    const snapshots = modelIds.map((id) => ({ id, name: modelById.get(id)!.name }));
    const result = await createServiceRequest({
      requestType: 'device_request',
      channel: input.channel,
      applicationSource: input.applicationSource ?? 'internal_device_request',
      submittedPayload: {
        requestType: 'device_request', formVersion: 'device_request.internal.v1',
        capturedAt: new Date().toISOString(), purpose: purposeSnapshot, devices: snapshots,
        data: { purposeId: input.purposeId, deviceModelIds: modelIds, notes: notes || null },
      },
      requesterClientId: input.requesterClientId ?? null,
      requesterExternal: input.requesterExternal ?? null,
      beneficiaryClientId: input.beneficiaryClientId,
      beneficiaryExternal: input.beneficiaryExternal ?? null,
      referrerClientId: input.referrerClientId ?? null,
      referrerExternal: input.referrerExternal ?? null,
      submissionType: input.submissionType ?? 'apply',
      submitterTier: 'staff',
      problemDescription: notes || purpose.value,
      attachments: [],
      serviceAddress: input.serviceAddress ?? null,
      priority: 'Normal',
      branchId: Number(beneficiary.branch_id),
      branchResolutionStatus: 'resolved',
      branchResolutionReason: 'beneficiary_client_branch',
      sourceCallLogId: input.sourceCallLogId ?? null,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    }, tx.client);
    if (result.ok !== true) { await rollbackTx(tx); return result; }
    await tx.client.query(
      `UPDATE service_requests
          SET device_request_purpose_id = $2, device_request_purpose_snapshot = $3::jsonb, updated_at = NOW()
        WHERE id = $1`,
      [result.data.id, input.purposeId, JSON.stringify(purposeSnapshot)],
    );
    for (const [index, snapshot] of snapshots.entries()) {
      await tx.client.query(
        `INSERT INTO service_request_device_interests
           (service_request_id, device_model_id, device_snapshot, selection_order)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [result.data.id, snapshot.id, JSON.stringify(snapshot), index],
      );
    }
    await commitTx(tx);
    return result;
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}
