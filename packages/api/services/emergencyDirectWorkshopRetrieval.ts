import type { PoolClient } from 'pg';
import {
  applyDeviceDisconnectionResult,
  applyDeviceRetrievalResult,
  ResultValidationError,
} from './visitTaskResultReflection.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface EmergencyDirectWorkshopRetrievalInput {
  requested: boolean;
  finalDecision: string;
  waterDisconnected?: boolean | null;
  electricityDisconnected?: boolean | null;
  accessoriesRemoved?: boolean | null;
  customerAcknowledged?: boolean | null;
  notes?: string | null;
}

export interface EmergencyDirectWorkshopRetrievalRecord {
  disconnectionTaskId: number;
  retrievalTaskId: number;
  retrievalVisitTaskId: number;
  deviceStatus: 'in_workshop';
  waterDisconnected?: boolean;
  electricityDisconnected?: boolean;
  accessoriesRemoved?: boolean;
  customerAcknowledged?: boolean;
}

export function validateEmergencyDirectWorkshopRetrieval(
  input: EmergencyDirectWorkshopRetrievalInput,
): void {
  if (!input.requested) return;
  if (input.finalDecision !== 'unresolved') {
    throw new ResultValidationError('لا يمكن تسجيل سحب الجهاز إلى الورشة إلا عندما تكون نتيجة الصيانة الطارئة: لم تُحل');
  }
  if (
    input.waterDisconnected !== true
    && input.electricityDisconnected !== true
    && input.accessoriesRemoved !== true
  ) {
    throw new ResultValidationError('يجب توثيق إجراء فك واحد على الأقل قبل سحب الجهاز إلى الورشة');
  }
  if (input.customerAcknowledged !== true) {
    throw new ResultValidationError('تأكيد الزبون مطلوب عند سحب الجهاز إلى الورشة');
  }
}

export async function getEmergencyDirectWorkshopRetrieval(
  db: Queryable,
  emergencyTaskId: number,
): Promise<EmergencyDirectWorkshopRetrievalRecord | null> {
  const { rows } = await db.query(
    `SELECT dis.id AS "disconnectionTaskId",
            ret.id AS "retrievalTaskId",
            vt.id AS "retrievalVisitTaskId",
            dr.water_disconnected AS "waterDisconnected",
            dr.electricity_disconnected AS "electricityDisconnected",
            dr.accessories_removed AS "accessoriesRemoved",
            dr.customer_acknowledged AS "customerAcknowledged"
       FROM open_tasks ret
       JOIN visit_tasks vt ON vt.source_open_task_id = ret.id
       JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       JOIN visit_task_device_retrieval_results rr ON rr.visit_task_result_id = vtr.id
       JOIN open_tasks dis
         ON dis.source_context_type = ret.source_context_type
        AND dis.source_context_id = ret.source_context_id
        AND dis.task_type = 'device_disconnection'
       JOIN visit_tasks dvt ON dvt.source_open_task_id = dis.id
       JOIN visit_task_results dvtr ON dvtr.visit_task_id = dvt.id
       JOIN visit_task_device_disconnection_results dr ON dr.visit_task_result_id = dvtr.id
      WHERE ret.task_type = 'device_retrieval'
        AND ret.source_context_type = 'emergency_maintenance'
        AND ret.source_context_id = $1
        AND vtr.final_decision = 'retrieved_successfully'
        AND rr.retrieval_purpose = 'maintenance'
      ORDER BY ret.id DESC
      LIMIT 1`,
    [emergencyTaskId],
  );
  if (!rows[0]) return null;
  return {
    disconnectionTaskId: Number(rows[0].disconnectionTaskId),
    retrievalTaskId: Number(rows[0].retrievalTaskId),
    retrievalVisitTaskId: Number(rows[0].retrievalVisitTaskId),
    deviceStatus: 'in_workshop',
    waterDisconnected: rows[0].waterDisconnected === true,
    electricityDisconnected: rows[0].electricityDisconnected === true,
    accessoriesRemoved: rows[0].accessoriesRemoved === true,
    customerAcknowledged: rows[0].customerAcknowledged === true,
  };
}

export async function recordEmergencyDirectWorkshopRetrieval(
  db: PoolClient,
  emergencyTaskId: number,
  emergencyVisitTaskId: number,
  performedByUserId: number,
  input: EmergencyDirectWorkshopRetrievalInput,
): Promise<EmergencyDirectWorkshopRetrievalRecord | null> {
  validateEmergencyDirectWorkshopRetrieval(input);
  if (!input.requested) return null;

  const { rows: sourceRows } = await db.query(
    `SELECT ot.id, ot.client_id, ot.branch_id, ot.contract_id, ot.device_id,
            ot.priority, ot.contract_snapshot,
            vt.field_visit_id,
            fv.status AS visit_status,
            idev.status AS device_status,
            idev.branch_id AS device_branch_id,
            idev.installation_geo_unit_id,
            idev.installation_address_text,
            idev.installation_lat,
            idev.installation_lng,
            br.status AS service_branch_status
       FROM open_tasks ot
       JOIN visit_tasks vt ON vt.id = $2 AND vt.source_open_task_id = ot.id
       JOIN field_visits fv ON fv.id = vt.field_visit_id
       JOIN installed_devices idev ON idev.id = ot.device_id
       JOIN branches br ON br.id = ot.branch_id
      WHERE ot.id = $1
        AND ot.task_type = 'emergency_maintenance'
      LIMIT 1
      FOR UPDATE OF ot, vt, idev`,
    [emergencyTaskId, emergencyVisitTaskId],
  );
  const source = sourceRows[0];
  if (!source) {
    throw new ResultValidationError('مهمة الصيانة الطارئة غير مرتبطة بزيارة وجهاز مثبت صالحين للسحب');
  }
  // The emergency task row is locked above, so this second-save check is also
  // the concurrency guard: parallel saves serialize before either can insert.
  const existing = await getEmergencyDirectWorkshopRetrieval(db, emergencyTaskId);
  if (existing) return existing;
  if (!['in_progress', 'ended', 'completed'].includes(String(source.visit_status))) {
    throw new ResultValidationError('لا يمكن تسجيل السحب المباشر خارج زيارة منفذة');
  }
  if (source.service_branch_status === 'inactive') {
    throw new ResultValidationError('لا يمكن سحب الجهاز إلى فرع متوقف عن العمل');
  }
  if (!['active', 'installed', 'faulty'].includes(String(source.device_status))) {
    throw new ResultValidationError(`حالة الجهاز الحالية لا تسمح بسحبه مباشرة إلى الورشة: ${source.device_status}`);
  }

  const { rows: duplicateRows } = await db.query(
    `SELECT id, task_type, status
       FROM open_tasks
      WHERE device_id = $1
        AND task_type IN ('device_disconnection', 'device_retrieval')
        AND status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY id DESC
      LIMIT 1`,
    [source.device_id],
  );
  if (duplicateRows[0]) {
    throw new ResultValidationError(
      `توجد مهمة ${duplicateRows[0].task_type} نشطة لهذا الجهاز (#${duplicateRows[0].id})`,
    );
  }

  const notes = input.notes?.trim() || 'فك وسحب مباشر إلى الورشة بعد تعذر الصيانة الطارئة';
  const commonValues = [
    source.client_id,
    source.branch_id,
    source.contract_id,
    source.device_id,
    source.priority,
    notes,
    performedByUserId,
    emergencyTaskId,
    source.contract_snapshot ?? null,
  ];
  const { rows: disconnectionRows } = await db.query(
    `INSERT INTO open_tasks
       (client_id, branch_id, contract_id, device_id, task_type, task_family,
        reason, status, due_date, expected_date, priority, source, notes, created_by,
        origin, creation_origin, creation_reason, source_context_type, source_context_id,
        contract_snapshot)
     VALUES ($1,$2,$3,$4,'device_disconnection','service',
             'maintenance_preparation','in_execution',CURRENT_DATE,CURRENT_DATE,$5,
             'system',$6,$7,'manual_entry','cascading_during_visit',
             'emergency_direct_workshop_retrieval','emergency_maintenance',$8,$9)
     RETURNING id`,
    commonValues,
  );
  const disconnectionTaskId = Number(disconnectionRows[0].id);

  const { rows: retrievalRows } = await db.query(
    `INSERT INTO open_tasks
       (client_id, branch_id, contract_id, device_id, task_type, task_family,
        reason, status, due_date, expected_date, priority, source, notes, created_by,
        origin, creation_origin, creation_reason, source_context_type, source_context_id,
        contract_snapshot, service_branch_id, retrieval_purpose,
        pre_retrieval_branch_id, pre_retrieval_geo_unit_id,
        pre_retrieval_address_text, pre_retrieval_lat, pre_retrieval_lng)
     VALUES ($1,$2,$3,$4,'device_retrieval','service',
             'device_retrieval_maintenance','in_execution',CURRENT_DATE,CURRENT_DATE,$5,
             'system',$6,$7,'manual_entry','cascading_during_visit',
             'emergency_direct_workshop_retrieval','emergency_maintenance',$8,$9,
             $2,'maintenance',$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      ...commonValues,
      source.device_branch_id ?? null,
      source.installation_geo_unit_id ?? null,
      source.installation_address_text ?? null,
      source.installation_lat ?? null,
      source.installation_lng ?? null,
    ],
  );
  const retrievalTaskId = Number(retrievalRows[0].id);

  const { rows: sequenceRows } = await db.query(
    `SELECT COALESCE(MAX(sequence_no), 0)::int + 1 AS next_sequence
       FROM visit_tasks
      WHERE field_visit_id = $1`,
    [source.field_visit_id],
  );
  const firstSequence = Number(sequenceRows[0]?.next_sequence ?? 1);
  const { rows: visitTaskRows } = await db.query(
    `INSERT INTO visit_tasks
       (field_visit_id, source_open_task_id, task_type, task_family, sequence_no,
        status, contract_id, contract_snapshot, added_via)
     VALUES
       ($1,$2,'device_disconnection','service',$4,'in_progress',$5,$6,'booking'),
       ($1,$3,'device_retrieval','service',$4 + 1,'in_progress',$5,$6,'booking')
     RETURNING id, task_type`,
    [
      source.field_visit_id,
      disconnectionTaskId,
      retrievalTaskId,
      firstSequence,
      source.contract_id,
      source.contract_snapshot ?? null,
    ],
  );
  const disconnectionVisitTaskId = Number(
    visitTaskRows.find((row: any) => row.task_type === 'device_disconnection')?.id,
  );
  const retrievalVisitTaskId = Number(
    visitTaskRows.find((row: any) => row.task_type === 'device_retrieval')?.id,
  );

  await applyDeviceDisconnectionResult(
    disconnectionVisitTaskId,
    {
      final_decision: 'disconnected_successfully',
      closing_notes: notes,
      device_left_on_site: false,
      water_disconnected: input.waterDisconnected === true,
      electricity_disconnected: input.electricityDisconnected === true,
      accessories_removed: input.accessoriesRemoved === true,
      customer_acknowledged: true,
      requires_retrieval_task: false,
      technical_notes: notes,
    },
    performedByUserId,
    db,
  );
  await applyDeviceRetrievalResult(
    retrievalVisitTaskId,
    {
      final_decision: 'retrieved_successfully',
      retrieval_purpose: 'maintenance',
      service_branch_id: Number(source.branch_id),
      customer_acknowledged: true,
      closing_notes: notes,
      technical_notes: notes,
    },
    performedByUserId,
    db,
  );

  return {
    disconnectionTaskId,
    retrievalTaskId,
    retrievalVisitTaskId,
    deviceStatus: 'in_workshop',
    waterDisconnected: input.waterDisconnected === true,
    electricityDisconnected: input.electricityDisconnected === true,
    accessoriesRemoved: input.accessoriesRemoved === true,
    customerAcknowledged: true,
  };
}
