import type { PoolClient } from 'pg';
import { persistOpenTaskSnapshots } from '../../routes/openTasks.js';
import { acquireTx, appendAudit, commitTx, rollbackTx, type ServiceResult } from './_shared.js';

export interface GoldenWarrantyHandoffInput {
  serviceRequestId: number;
  operatorUserId: number;
  priority?: 'high' | 'medium' | 'low' | null;
  dueDate?: string | null;
  operatorNote?: string | null;
}

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

export async function handoffGoldenWarrantyRequest(
  input: GoldenWarrantyHandoffInput,
  db?: PoolClient,
): Promise<ServiceResult<{ openTaskId: number; alreadyHandedOff: boolean }>> {
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<{
      id: number; request_type: string; status: string; beneficiary_client_id: number | null;
      installed_device_id: number | null; reviewed_by_user_id: number | null;
      linked_open_task_id: number | null; requested_warranty_months: number | null;
      requested_warranty_period_snapshot: Record<string, unknown> | null;
      beneficiary_contact_consent_confirmed: boolean | null; problem_description: string | null;
    }>(
      `SELECT id, request_type, status, beneficiary_client_id, installed_device_id,
              reviewed_by_user_id, linked_open_task_id, requested_warranty_months,
              requested_warranty_period_snapshot, beneficiary_contact_consent_confirmed,
              problem_description
         FROM service_requests
        WHERE id = $1
        FOR UPDATE`,
      [input.serviceRequestId],
    );
    const request = rows[0];
    if (!request) { await rollbackTx(tx); return { ok: false, code: 'not_found' }; }
    if (request.request_type !== 'golden_warranty') {
      await rollbackTx(tx); return { ok: false, code: 'wrong_request_type_for_golden_warranty_handoff' };
    }
    if (request.status === 'promoted' && request.linked_open_task_id != null) {
      await commitTx(tx);
      return { ok: true, data: { openTaskId: Number(request.linked_open_task_id), alreadyHandedOff: true } };
    }
    if (request.status !== 'in_review' || request.reviewed_by_user_id == null) {
      await rollbackTx(tx); return { ok: false, code: 'handoff_requires_claim', details: { status: request.status } };
    }
    if (request.beneficiary_client_id == null) {
      await rollbackTx(tx); return { ok: false, code: 'beneficiary_client_required' };
    }
    if (request.installed_device_id == null) {
      await rollbackTx(tx); return { ok: false, code: 'installed_device_id_required' };
    }
    if (!request.beneficiary_contact_consent_confirmed) {
      await rollbackTx(tx); return { ok: false, code: 'beneficiary_contact_consent_required' };
    }
    const requestedMonths = Number(request.requested_warranty_months);
    if (!Number.isInteger(requestedMonths) || requestedMonths <= 0 || !request.requested_warranty_period_snapshot) {
      await rollbackTx(tx); return { ok: false, code: 'requested_warranty_period_required' };
    }

    const { rows: deviceRows } = await tx.client.query<{
      id: number; customer_id: number; branch_id: number | null; contract_id: number | null;
      status: string; device_model_id: number | null; is_active: boolean | null;
      is_golden_warranty: boolean | null; golden_warranty_periods: unknown; model_name: string | null;
    }>(
      `SELECT d.id, d.customer_id, d.branch_id, d.contract_id, d.status, d.device_model_id,
              dm.is_active, dm.is_golden_warranty, dm.golden_warranty_periods,
              COALESCE(dm.name_ar, dm.name_en, dm.name) AS model_name
         FROM installed_devices d
         LEFT JOIN device_models dm ON dm.id = d.device_model_id
        WHERE d.id = $1
        FOR UPDATE OF d`,
      [request.installed_device_id],
    );
    const device = deviceRows[0];
    if (!device) { await rollbackTx(tx); return { ok: false, code: 'installed_device_not_found' }; }
    if (Number(device.customer_id) !== Number(request.beneficiary_client_id)) {
      await rollbackTx(tx); return { ok: false, code: 'installed_device_beneficiary_mismatch' };
    }
    if (device.status !== 'active') {
      await rollbackTx(tx); return { ok: false, code: 'device_not_active' };
    }
    if (device.branch_id == null) {
      await rollbackTx(tx); return { ok: false, code: 'installed_device_branch_required' };
    }
    if (!device.device_model_id || device.is_active !== true || device.is_golden_warranty !== true) {
      await rollbackTx(tx); return { ok: false, code: 'device_model_not_golden_warranty_eligible' };
    }
    const supported = normalizePeriods(device.golden_warranty_periods);
    if (!supported.some((period) => period.months === requestedMonths)) {
      await rollbackTx(tx); return { ok: false, code: 'requested_period_no_longer_available' };
    }

    const { rows: warrantyRows } = await tx.client.query<{ id: number; warranty_type: string }>(
      `SELECT id, warranty_type
         FROM device_warranties
        WHERE device_id = $1
          AND status = 'active'
          AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        ORDER BY id
        LIMIT 1`,
      [request.installed_device_id],
    );
    if (warrantyRows[0]) {
      await rollbackTx(tx);
      return {
        ok: false,
        code: warrantyRows[0].warranty_type === 'golden'
          ? 'active_golden_warranty_exists' : 'active_contract_warranty_exists',
        details: { warrantyId: Number(warrantyRows[0].id) },
      };
    }
    const { rows: activeOfferRows } = await tx.client.query<{ id: number }>(
      `SELECT id FROM open_tasks
        WHERE device_id = $1
          AND task_type = 'golden_warranty_offer'
          AND status NOT IN ('completed', 'closed', 'cancelled')
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [request.installed_device_id],
    );
    if (activeOfferRows[0]) {
      await rollbackTx(tx);
      return { ok: false, code: 'active_golden_warranty_offer_exists', details: { openTaskId: Number(activeOfferRows[0].id) } };
    }
    const { rows: typeRows } = await tx.client.query<{ is_active: boolean }>(
      `SELECT is_active FROM task_type_config WHERE task_type = 'golden_warranty_offer' LIMIT 1`,
    );
    if (!typeRows[0]?.is_active) {
      await rollbackTx(tx); return { ok: false, code: 'golden_warranty_offer_task_type_inactive' };
    }

    const periodLabel = String(request.requested_warranty_period_snapshot.label ?? `${requestedMonths} شهر`);
    const notes = [
      `مصدر المهمة: طلب كفالة ذهبية #${request.id}`,
      `المدة المقفلة من الطلب: ${periodLabel}`,
      request.problem_description ? `ملاحظات الطلب: ${request.problem_description}` : null,
      input.operatorNote?.trim() ? `ملاحظة الموظف: ${input.operatorNote.trim()}` : null,
    ].filter(Boolean).join('\n');
    const { rows: taskRows } = await tx.client.query<{ id: number }>(
      `INSERT INTO open_tasks (
         client_id, branch_id, contract_id, device_id,
         task_type, task_family, reason, status, due_date, priority,
         source, notes, created_by, origin, creation_origin,
         source_service_request_id, source_context_type, source_context_id
       ) VALUES (
         $1, $2, $3, $4,
         'golden_warranty_offer', 'warranty', 'golden_warranty_offer', 'open', $5, $6,
         'service_request', $7, $8, 'service_request', 'golden_warranty_request',
         $9, 'service_request', $9
       ) RETURNING id`,
      [request.beneficiary_client_id, device.branch_id, device.contract_id, request.installed_device_id,
        input.dueDate ?? null, input.priority ?? 'medium', notes, input.operatorUserId, request.id],
    );
    const openTaskId = Number(taskRows[0].id);
    await tx.client.query(
      `INSERT INTO open_task_installed_devices (task_id, installed_device_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [openTaskId, request.installed_device_id],
    );
    await persistOpenTaskSnapshots(
      tx.client,
      openTaskId,
      Number(request.beneficiary_client_id),
      device.contract_id,
      request.installed_device_id,
    );
    await tx.client.query(
      `UPDATE service_requests
          SET status = 'promoted',
              triage_outcome = 'golden_warranty_offer_task_created',
              linked_open_task_id = $2,
              branch_id = $3,
              branch_resolution_status = 'resolved',
              branch_resolution_reason = 'installed_device_branch',
              closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [request.id, openTaskId, device.branch_id],
    );
    await appendAudit(tx.client, {
      serviceRequestId: request.id,
      eventType: 'promoted_to_task',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: {
        request_type: 'golden_warranty',
        open_task_id: openTaskId,
        task_type: 'golden_warranty_offer',
        installed_device_id: request.installed_device_id,
        requested_warranty_months: requestedMonths,
        branch_id: device.branch_id,
      },
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
