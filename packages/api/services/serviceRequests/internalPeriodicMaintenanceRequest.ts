import type { PoolClient } from 'pg';
import { createServiceRequest } from './createService.js';

function text(value: unknown, max: number): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (normalized.length > max) {
    throw Object.assign(new Error('field_too_long'), { status: 400, code: 'field_too_long' });
  }
  return normalized;
}

export async function createInternalPeriodicMaintenanceRequest(input: {
  db: PoolClient;
  request: Record<string, unknown>;
  requesterClientId: number;
  beneficiaryClientId: number | null;
  beneficiaryExternal?: Record<string, unknown> | null;
  referrerClientId?: number | null;
  referrerExternal?: Record<string, unknown> | null;
  sourceCallLogId: string;
  actorUserId: number;
}) {
  const { db, request } = input;
  const submissionType = request.submissionType === 'refer_a_candidate' ? 'refer_a_candidate' : 'apply';
  const effectiveBeneficiaryClientId = input.beneficiaryClientId
    ?? (submissionType === 'apply' ? input.requesterClientId : null);
  if (effectiveBeneficiaryClientId == null) {
    return { ok: false as const, code: 'beneficiary_client_id_required' };
  }

  const serviceAddress = request.serviceAddress && typeof request.serviceAddress === 'object'
    ? request.serviceAddress as Record<string, unknown>
    : null;
  const governorateId = Number(serviceAddress?.governorateId ?? serviceAddress?.governorate) || null;
  const detailedAddress = text(
    serviceAddress?.detailedAddress ?? serviceAddress?.detailed_address,
    500,
  );
  if (governorateId == null || !detailedAddress) {
    return { ok: false as const, code: 'service_address_required' };
  }

  const reasonId = Number(request.reasonId);
  if (!Number.isInteger(reasonId) || reasonId <= 0) {
    return { ok: false as const, code: 'periodic_maintenance_reason_required' };
  }
  const { rows: reasonRows } = await db.query<{
    id: number; value: string; metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, value, metadata
       FROM system_lists
      WHERE id = $1
        AND category = 'periodic_maintenance_request_reasons'
        AND is_active = TRUE
      LIMIT 1`,
    [reasonId],
  );
  if (!reasonRows[0]) return { ok: false as const, code: 'periodic_maintenance_reason_not_found' };
  const reasonSnapshot = {
    id: Number(reasonRows[0].id),
    code: String(reasonRows[0].metadata?.code ?? reasonRows[0].value),
    label: reasonRows[0].value,
  };

  const selection = String(request.reportedDeviceSelection ?? request.deviceSelectionType ?? '').trim();
  if (!['registered_device', 'catalog_model', 'other'].includes(selection)) {
    return { ok: false as const, code: 'device_selection_required' };
  }
  const installedDeviceId = Number(request.installedDeviceId) || null;
  const modelId = Number(request.reportedDeviceModelId ?? request.deviceModelId) || null;
  const submittedSerial = text(request.serialNumber ?? request.externalDeviceSerial, 100);
  let reportedDeviceSnapshot: Record<string, unknown>;
  let reportedDeviceModelId: number | null = null;
  let deviceSource: 'company_device' | 'external_device' = 'external_device';
  let branchId: number | null = null;

  if (selection === 'registered_device') {
    if (!installedDeviceId) return { ok: false as const, code: 'installed_device_id_required' };
    if (submittedSerial) return { ok: false as const, code: 'serial_number_not_accepted_for_registered_device' };
    const { rows } = await db.query<{
      id: number; customer_id: number; branch_id: number | null; device_model_id: number | null;
      device_source: string | null; serial_number: string | null; model_name: string | null;
    }>(
      `SELECT d.id, d.customer_id, d.branch_id, d.device_model_id, d.device_source, d.serial_number,
              COALESCE(dm.name_ar, dm.name_en, dm.name, d.device_model_name, d.external_device_name) AS model_name
         FROM installed_devices d
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
        WHERE d.id = $1
        LIMIT 1
        FOR UPDATE OF d`,
      [installedDeviceId],
    );
    const device = rows[0];
    if (!device) return { ok: false as const, code: 'installed_device_not_found' };
    if (effectiveBeneficiaryClientId != null && Number(device.customer_id) !== effectiveBeneficiaryClientId) {
      return { ok: false as const, code: 'installed_device_beneficiary_mismatch' };
    }
    branchId = device.branch_id == null ? null : Number(device.branch_id);
    reportedDeviceModelId = device.device_model_id == null ? null : Number(device.device_model_id);
    deviceSource = device.device_source === 'external' ? 'external_device' : 'company_device';
    reportedDeviceSnapshot = {
      selection,
      installedDeviceId: Number(device.id),
      modelId: reportedDeviceModelId,
      modelName: device.model_name,
      serialNumber: device.serial_number,
      source: 'server_record',
    };
  } else if (selection === 'catalog_model') {
    if (installedDeviceId) return { ok: false as const, code: 'installed_device_id_not_accepted' };
    if (!modelId) return { ok: false as const, code: 'device_model_id_required' };
    const { rows } = await db.query<{ id: number; name: string }>(
      `SELECT id, COALESCE(name_ar, name_en, name) AS name
         FROM device_models
        WHERE id = $1 AND is_active = TRUE
        LIMIT 1`,
      [modelId],
    );
    if (!rows[0]) return { ok: false as const, code: 'device_model_not_found' };
    reportedDeviceModelId = Number(rows[0].id);
    reportedDeviceSnapshot = {
      selection,
      modelId: reportedDeviceModelId,
      modelName: rows[0].name,
      serialNumber: submittedSerial,
      source: 'submitted_catalog_selection',
    };
  } else {
    if (installedDeviceId) return { ok: false as const, code: 'installed_device_id_not_accepted' };
    if (modelId) return { ok: false as const, code: 'device_model_id_not_accepted' };
    const deviceName = text(request.deviceName ?? request.externalDeviceName, 255);
    if (!deviceName) return { ok: false as const, code: 'device_name_required' };
    reportedDeviceSnapshot = {
      selection,
      deviceName,
      serialNumber: submittedSerial,
      source: 'submitted_free_text',
    };
  }

  if (branchId == null && effectiveBeneficiaryClientId != null) {
    const { rows } = await db.query<{ branch_id: number | null }>(
      'SELECT branch_id FROM clients WHERE id = $1 AND deleted_at IS NULL',
      [effectiveBeneficiaryClientId],
    );
    branchId = rows[0]?.branch_id == null ? null : Number(rows[0].branch_id);
  }

  if (installedDeviceId != null) {
    const { rows } = await db.query<{
      id: number; public_ref_number: string; status: string; review_required_flag: boolean;
    }>(
      `SELECT id, public_ref_number, status, review_required_flag
         FROM service_requests
        WHERE request_type = 'periodic_maintenance'
          AND installed_device_id = $1
          AND status IN ('received', 'in_review')
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [installedDeviceId],
    );
    if (rows[0]) {
      return {
        ok: true as const,
        data: {
          id: Number(rows[0].id),
          publicRefNumber: rows[0].public_ref_number,
          status: rows[0].status,
          reviewRequiredFlag: rows[0].review_required_flag,
          activeRequestExists: true,
        },
      };
    }
  }

  const result = await createServiceRequest({
    requestType: 'periodic_maintenance',
    channel: 'phone',
    applicationSource: 'telemarketing_service_request',
    submittedPayload: {
      requestType: 'periodic_maintenance',
      formVersion: 'periodic_maintenance.internal.v1',
      capturedAt: new Date().toISOString(),
      requestReason: reasonSnapshot,
      reportedDevice: reportedDeviceSnapshot,
    },
    requesterClientId: input.requesterClientId,
    beneficiaryClientId: effectiveBeneficiaryClientId,
    beneficiaryExternal: input.beneficiaryExternal,
    referrerClientId: input.referrerClientId,
    referrerExternal: input.referrerExternal,
    submissionType,
    submitterTier: 'staff',
    deviceSource,
    installedDeviceId,
    reportedDeviceSelection: selection as 'registered_device' | 'catalog_model' | 'other',
    reportedDeviceModelId,
    reportedDeviceSnapshot,
    problemDescription: reasonRows[0].value,
    attachments: [],
    safetyIndicatorCodes: [],
    serviceAddress,
    priority: null,
    branchId,
    branchResolutionStatus: branchId == null ? 'not_applicable' : 'resolved',
    branchResolutionReason: branchId == null ? 'beneficiary_or_device_not_linked' : 'device_or_beneficiary_branch',
    sourceCallLogId: input.sourceCallLogId,
    actorUserId: input.actorUserId,
    actorRole: 'operator',
  }, db);
  if (result.ok !== true) return result;

  await db.query(
    `UPDATE service_requests
        SET periodic_maintenance_reason_id = $2,
            periodic_maintenance_reason_snapshot = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [result.data.id, reasonId, JSON.stringify(reasonSnapshot)],
  );
  return result;
}
