import type { PoolClient } from 'pg';
import { createServiceRequest } from './createService.js';

function normalizePeriods(value: unknown): Array<{ months: number; label: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const months = Number(raw.months);
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    return Number.isInteger(months) && months > 0 && label ? [{ months, label }] : [];
  });
}

export async function createInternalGoldenWarrantyRequest(input: {
  db: PoolClient;
  request: Record<string, unknown>;
  requesterClientId: number;
  beneficiaryClientId: number | null;
  sourceCallLogId: string;
  actorUserId: number;
}) {
  const beneficiaryClientId = input.beneficiaryClientId
    ?? (input.request.submissionType === 'refer_a_candidate' ? null : input.requesterClientId);
  if (!beneficiaryClientId) return { ok: false as const, code: 'beneficiary_client_required' };
  if (input.request.beneficiaryContactConsentConfirmed !== true) {
    return { ok: false as const, code: 'beneficiary_contact_consent_required' };
  }
  const installedDeviceId = Number(input.request.installedDeviceId);
  const requestedMonths = Number(input.request.requestedWarrantyMonths);
  if (!Number.isInteger(installedDeviceId) || installedDeviceId <= 0) {
    return { ok: false as const, code: 'installed_device_id_required' };
  }
  if (!Number.isInteger(requestedMonths) || requestedMonths <= 0) {
    return { ok: false as const, code: 'requested_warranty_months_required' };
  }
  const { rows } = await input.db.query<{
    id: number; customer_id: number; branch_id: number | null; contract_id: number | null;
    device_model_id: number; device_source: string | null; serial_number: string | null;
    status: string; model_name: string; golden_warranty_periods: unknown;
  }>(
    `SELECT d.id, d.customer_id, d.branch_id, d.contract_id, d.device_model_id,
            d.device_source, d.serial_number, d.status,
            COALESCE(dm.name_ar, dm.name_en, dm.name) AS model_name,
            dm.golden_warranty_periods
       FROM installed_devices d
       JOIN device_models dm ON dm.id = d.device_model_id
      WHERE d.id = $1
        AND dm.is_active = TRUE
        AND dm.is_golden_warranty = TRUE
      LIMIT 1
      FOR UPDATE OF d`,
    [installedDeviceId],
  );
  const device = rows[0];
  if (!device) return { ok: false as const, code: 'device_model_not_golden_warranty_eligible' };
  if (Number(device.customer_id) !== beneficiaryClientId) {
    return { ok: false as const, code: 'installed_device_beneficiary_mismatch' };
  }
  if (device.status !== 'active') return { ok: false as const, code: 'device_not_active' };
  const periods = normalizePeriods(device.golden_warranty_periods);
  const period = periods.find((item) => item.months === requestedMonths);
  if (!period) return { ok: false as const, code: 'requested_warranty_period_not_supported' };
  const periodSnapshot = { months: period.months, label: period.label };
  const reportedDeviceSnapshot = {
    selection: 'registered_device',
    installedDeviceId,
    modelId: Number(device.device_model_id),
    modelName: device.model_name,
    serialNumber: device.serial_number,
    source: 'server_record',
    goldenWarrantyPeriods: periods,
  };
  const result = await createServiceRequest({
    requestType: 'golden_warranty',
    channel: 'phone',
    applicationSource: 'telemarketing_service_request',
    submittedPayload: {
      requestType: 'golden_warranty',
      formVersion: 'golden_warranty.internal.v1',
      capturedAt: new Date().toISOString(),
      requestedWarrantyPeriod: periodSnapshot,
      reportedDevice: reportedDeviceSnapshot,
      beneficiaryContactConsentConfirmed: true,
    },
    requesterClientId: input.requesterClientId,
    beneficiaryClientId,
    referrerClientId: null,
    referrerExternal: null,
    submissionType: input.request.submissionType === 'refer_a_candidate' ? 'refer_a_candidate' : 'apply',
    submitterTier: 'staff',
    contractId: device.contract_id,
    deviceSource: device.device_source === 'external' ? 'external_device' : 'company_device',
    installedDeviceId,
    reportedDeviceSelection: 'registered_device',
    reportedDeviceModelId: Number(device.device_model_id),
    reportedDeviceSnapshot,
    problemDescription: typeof input.request.notes === 'string' ? input.request.notes.trim() || null : null,
    attachments: [],
    safetyIndicatorCodes: [],
    serviceAddress: null,
    priority: null,
    branchId: device.branch_id,
    branchResolutionStatus: device.branch_id == null ? 'not_applicable' : 'resolved',
    branchResolutionReason: device.branch_id == null ? 'device_branch_missing' : 'registered_device_branch',
    sourceCallLogId: input.sourceCallLogId,
    actorUserId: input.actorUserId,
    actorRole: 'operator',
  }, input.db);
  if (result.ok !== true) return result;
  await input.db.query(
    `UPDATE service_requests
        SET requested_warranty_months = $2,
            requested_warranty_period_snapshot = $3::jsonb,
            beneficiary_contact_consent_confirmed = TRUE,
            updated_at = NOW()
      WHERE id = $1`,
    [result.data.id, requestedMonths, JSON.stringify(periodSnapshot)],
  );
  return result;
}
