// ============================================================
// serviceRequests/waterCheckHandoffService.ts
// ============================================================
// Converts a water_check service_request into a conservative device_demo
// open_task after the operator links a real client and branch resolution is
// complete. Authorization for the target branch is enforced by the route before
// this service mutates records.
// ============================================================

import type { PoolClient } from 'pg';
import {
  acquireTx,
  appendAudit,
  commitTx,
  rollbackTx,
  type ServiceResult,
} from './_shared.js';
import { persistOpenTaskSnapshots } from '../../routes/openTasks.js';

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

interface WaterCheckServiceRequestRow {
  id: number;
  status: string;
  request_type: string;
  beneficiary_client_id: number | null;
  branch_id: number | null;
  branch_resolution_status: string | null;
  linked_open_task_id: number | null;
  submitted_payload: Record<string, unknown> | null;
  beneficiary_external: Record<string, unknown> | null;
  service_address: Record<string, unknown> | null;
}

export interface WaterCheckHandoffInput {
  serviceRequestId: number;
  operatorUserId: number;
  priority?: 'high' | 'medium' | 'low' | null;
  operatorNote?: string | null;
}

export interface WaterCheckHandoffOutput {
  openTaskId: number;
  newOpenTaskId: number;
  clientId: number;
  branchId: number;
  alreadyHandedOff: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readText(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function extractSubmittedData(payload: Record<string, unknown> | null): Record<string, unknown> {
  return asRecord(asRecord(payload).data);
}

function buildWaterCheckTaskNote(sr: WaterCheckServiceRequestRow, operatorNote?: string | null): string {
  const submitted = extractSubmittedData(sr.submitted_payload);
  const external = asRecord(sr.beneficiary_external);
  const address = asRecord(sr.service_address);

  const fullName = readText(external, 'name')
    || [readText(submitted, 'firstName'), readText(submitted, 'lastName')].filter(Boolean).join(' ');
  const phone = readText(external, 'primary_phone') || readText(submitted, 'phoneNumber');
  const secondaryPhone = readText(external, 'secondary_phone') || readText(submitted, 'secondaryPhone');
  const detailedAddress = readText(address, 'detailedAddress')
    || readText(address, 'detailed_address')
    || readText(submitted, 'detailedAddress');
  const notes = readText(external, 'notes') || readText(submitted, 'notes');
  const cleanOperatorNote = typeof operatorNote === 'string' ? operatorNote.trim() : '';

  return [
    'طلب فحص مياه من التطبيق',
    fullName ? `صاحب الطلب: ${fullName}` : null,
    phone ? `الهاتف: ${phone}` : null,
    secondaryPhone ? `الهاتف الثانوي: ${secondaryPhone}` : null,
    detailedAddress ? `العنوان: ${detailedAddress}` : null,
    notes ? `ملاحظات: ${notes}` : null,
    cleanOperatorNote ? `ملاحظة إنشاء المهمة: ${cleanOperatorNote}` : null,
  ].filter(Boolean).join('\n');
}

function extractDetailedAddress(sr: WaterCheckServiceRequestRow): string | null {
  const submitted = extractSubmittedData(sr.submitted_payload);
  const address = asRecord(sr.service_address);
  return readText(address, 'detailedAddress')
    || readText(address, 'detailed_address')
    || readText(submitted, 'detailedAddress')
    || null;
}

async function hasOpenTaskColumn(db: Queryable, columnName: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'open_tasks'
          AND column_name = $1
     ) AS present`,
    [columnName],
  );
  return rows[0]?.present === true;
}

async function resolveDeviceDemoCreationReason(db: Queryable): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT value
       FROM system_lists
      WHERE category = 'device_demo_creation_reasons'
        AND is_active = TRUE
        AND (
          metadata->>'code' = 'customer_request'
          OR metadata->>'systemReason' = 'customer_request'
          OR value = 'طلب الزبون'
        )
      ORDER BY
        CASE
          WHEN metadata->>'code' = 'customer_request' THEN 0
          WHEN metadata->>'systemReason' = 'customer_request' THEN 1
          ELSE 2
        END,
        display_order ASC,
        id ASC
      LIMIT 1`,
  );
  return rows[0]?.value ? String(rows[0].value) : null;
}

async function findLinkedOpenTask(db: Queryable, openTaskId: number | null): Promise<{ id: number } | null> {
  if (openTaskId == null) return null;
  const { rows } = await db.query(
    `SELECT id FROM open_tasks WHERE id = $1 LIMIT 1`,
    [openTaskId],
  );
  return rows[0] ?? null;
}

export async function handoffWaterCheckToDeviceDemo(
  input: WaterCheckHandoffInput,
  db?: PoolClient,
): Promise<ServiceResult<WaterCheckHandoffOutput>> {
  const tx = await acquireTx(db);
  try {
    const { rows } = await tx.client.query<WaterCheckServiceRequestRow>(
      `SELECT id, status, request_type, beneficiary_client_id, branch_id,
              branch_resolution_status, linked_open_task_id, submitted_payload,
              beneficiary_external, service_address
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
    if (sr.request_type !== 'water_check') {
      await rollbackTx(tx);
      return { ok: false, code: 'wrong_request_type_for_water_check_handoff' };
    }

    const linkedTask = await findLinkedOpenTask(tx.client, sr.linked_open_task_id);
    if (linkedTask) {
      await commitTx(tx);
      return {
        ok: true,
        data: {
          openTaskId: linkedTask.id,
          newOpenTaskId: linkedTask.id,
          clientId: Number(sr.beneficiary_client_id ?? 0),
          branchId: Number(sr.branch_id ?? 0),
          alreadyHandedOff: true,
        },
      };
    }

    if (sr.status !== 'in_review') {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'invalid_status_for_water_check_handoff',
        details: { status: sr.status },
      };
    }
    if (sr.beneficiary_client_id == null) {
      await rollbackTx(tx);
      return { ok: false, code: 'beneficiary_client_required' };
    }
    if (sr.branch_id == null) {
      await rollbackTx(tx);
      return { ok: false, code: 'water_check_branch_required' };
    }
    if (sr.branch_resolution_status !== 'resolved') {
      await rollbackTx(tx);
      return {
        ok: false,
        code: 'water_check_branch_resolution_required',
        details: { branchResolutionStatus: sr.branch_resolution_status },
      };
    }

    const clientId = Number(sr.beneficiary_client_id);
    const branchId = Number(sr.branch_id);

    const { rows: clientRows } = await tx.client.query<{ id: number }>(
      `SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [clientId],
    );
    if (clientRows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'client_not_found' };
    }

    const { rows: branchRows } = await tx.client.query<{ status: string | null }>(
      `SELECT status FROM branches WHERE id = $1 LIMIT 1`,
      [branchId],
    );
    if (branchRows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'branch_not_found' };
    }
    if (branchRows[0].status === 'inactive') {
      await rollbackTx(tx);
      return { ok: false, code: 'inactive_branch_for_water_check_handoff' };
    }

    const { rows: taskTypeRows } = await tx.client.query<{
      allowMultiple: boolean;
      isActive: boolean;
    }>(
      `SELECT allow_multiple AS "allowMultiple",
              is_active AS "isActive"
         FROM task_type_config
        WHERE task_type = 'device_demo'
        LIMIT 1`,
    );
    if (taskTypeRows.length === 0) {
      await rollbackTx(tx);
      return { ok: false, code: 'device_demo_task_type_missing' };
    }
    if (!taskTypeRows[0].isActive) {
      await rollbackTx(tx);
      return { ok: false, code: 'device_demo_task_type_inactive' };
    }

    const hasSourceServiceRequestId = await hasOpenTaskColumn(tx.client, 'source_service_request_id');
    if (hasSourceServiceRequestId) {
      const { rows: sourceRows } = await tx.client.query<{ id: number; status: string }>(
        `SELECT id, status
           FROM open_tasks
          WHERE source_service_request_id = $1
            AND task_type = 'device_demo'
            AND status NOT IN ('completed', 'closed', 'cancelled')
          ORDER BY created_at DESC
          LIMIT 1`,
        [sr.id],
      );
      if (sourceRows.length > 0) {
        await tx.client.query(
          `UPDATE service_requests
              SET status = 'promoted',
                  triage_outcome = 'needs_field_intervention',
                  linked_open_task_id = $2,
                  closed_at = COALESCE(closed_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1`,
          [sr.id, sourceRows[0].id],
        );
        await commitTx(tx);
        return {
          ok: true,
          data: {
            openTaskId: sourceRows[0].id,
            newOpenTaskId: sourceRows[0].id,
            clientId,
            branchId,
            alreadyHandedOff: true,
          },
        };
      }
    }

    if (taskTypeRows[0].allowMultiple !== true) {
      const { rows: activeDuplicateRows } = await tx.client.query<{ id: number; status: string }>(
        `SELECT id, status
           FROM open_tasks
          WHERE client_id = $1
            AND task_type = 'device_demo'
            AND status NOT IN ('completed', 'closed', 'cancelled')
          ORDER BY created_at DESC
          LIMIT 1`,
        [clientId],
      );
      if (activeDuplicateRows.length > 0) {
        await rollbackTx(tx);
        return {
          ok: false,
          code: 'active_device_demo_exists',
          message: 'لا يمكن تحويل الطلب لأن الزبون لديه مهمة عرض جهاز نشطة.',
          details: {
            existingTaskId: activeDuplicateRows[0].id,
            existingTaskStatus: activeDuplicateRows[0].status,
          },
        };
      }
    }

    const taskColumns = [
      'client_id',
      'branch_id',
      'task_type',
      'task_family',
      'reason',
      'status',
      'due_date',
      'expected_date',
      'priority',
      'source',
      'notes',
      'created_by',
      'origin',
      'creation_origin',
    ];
    const taskValues: any[] = [
      clientId,
      branchId,
      'device_demo',
      'marketing',
      'device_demo',
      'open',
      null,
      null,
      input.priority ?? 'medium',
      'service_request',
      buildWaterCheckTaskNote(sr, input.operatorNote),
      input.operatorUserId,
      'service_request',
      'service_request_call',
    ];

    const addOptionalColumn = async (columnName: string, value: unknown) => {
      if (await hasOpenTaskColumn(tx.client, columnName)) {
        taskColumns.push(columnName);
        taskValues.push(value);
      }
    };

    await addOptionalColumn('source_service_request_id', sr.id);
    await addOptionalColumn('source_context_type', 'service_request');
    await addOptionalColumn('source_context_id', sr.id);
    await addOptionalColumn('delivery_address', extractDetailedAddress(sr));
    await addOptionalColumn('creation_reason', await resolveDeviceDemoCreationReason(tx.client));

    const placeholders = taskValues.map((_, index) => `$${index + 1}`);
    const { rows: taskRows } = await tx.client.query<{ id: number }>(
      `INSERT INTO open_tasks (${taskColumns.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING id`,
      taskValues,
    );
    const openTaskId = taskRows[0].id;

    await persistOpenTaskSnapshots(tx.client, openTaskId, clientId, null, null);

    await tx.client.query(
      `UPDATE service_requests
          SET status = 'promoted',
              triage_outcome = 'needs_field_intervention',
              linked_open_task_id = $2,
              closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [sr.id, openTaskId],
    );

    await appendAudit(tx.client, {
      serviceRequestId: sr.id,
      eventType: 'status_changed',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: { from: 'in_review', to: 'promoted', via: 'water_check_handoff' },
    });
    await appendAudit(tx.client, {
      serviceRequestId: sr.id,
      eventType: 'promoted_to_task',
      actorUserId: input.operatorUserId,
      actorRole: 'operator',
      payload: {
        request_type: 'water_check',
        open_task_id: openTaskId,
        task_type: 'device_demo',
        branch_id: branchId,
        client_id: clientId,
      },
    });

    await commitTx(tx);
    return {
      ok: true,
      data: {
        openTaskId,
        newOpenTaskId: openTaskId,
        clientId,
        branchId,
        alreadyHandedOff: false,
      },
    };
  } catch (err) {
    await rollbackTx(tx);
    throw err;
  } finally {
    tx.release();
  }
}
