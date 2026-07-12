import type { PoolClient } from 'pg';

export type DeviceTaskType =
  | 'device_delivery'
  | 'device_installation'
  | 'device_activation'
  | 'device_checkup'
  | 'device_disconnection'
  | 'device_retrieval'
  | 'device_return'
  | 'device_transfer'
  | 'emergency_maintenance'
  | 'periodic_maintenance';

export class DeviceTaskEligibilityError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DeviceTaskEligibilityError';
  }
}

type Queryable = Pick<PoolClient, 'query'>;

const SUCCESSFUL_RESULT_DECISIONS: Partial<Record<DeviceTaskType, Set<string>>> = {
  device_delivery: new Set(['delivered_successfully']),
  device_installation: new Set(['installed_successfully']),
  device_activation: new Set(['activated_successfully']),
  device_checkup: new Set(['checked_successfully']),
  device_disconnection: new Set(['disconnected_successfully', 'requires_retrieval']),
  device_retrieval: new Set(['retrieved_successfully']),
  device_return: new Set(['returned_successfully']),
  device_transfer: new Set(['transferred_successfully']),
  emergency_maintenance: new Set(['resolved']),
  periodic_maintenance: new Set(['performed', 'partially_performed']),
};

export function isSuccessfulDeviceTaskDecision(taskType: string, decision: string | null | undefined): boolean {
  if (!decision) return false;
  return SUCCESSFUL_RESULT_DECISIONS[taskType as DeviceTaskType]?.has(decision) === true;
}

function assertStatus(taskType: DeviceTaskType, actual: string | null, allowed: string[], message: string): void {
  if (!actual || !allowed.includes(actual)) {
    throw new DeviceTaskEligibilityError(message);
  }
}

async function hasSuccessfulDisconnection(db: Queryable, installedDeviceId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT vtr.id
       FROM visit_tasks vt
       JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
      WHERE vt.task_type = 'device_disconnection'
        AND vt.source_open_task_id IN (
          SELECT id FROM open_tasks WHERE device_id = $1 AND task_type = 'device_disconnection'
        )
        AND vtr.final_decision IN ('disconnected_successfully', 'requires_retrieval')
      ORDER BY vtr.closed_at DESC NULLS LAST, vtr.id DESC
      LIMIT 1`,
    [installedDeviceId],
  );
  return rows.length > 0;
}

async function hasSuccessfulMaintenanceRetrieval(db: Queryable, installedDeviceId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT ot.id
       FROM open_tasks ot
       JOIN visit_tasks vt ON vt.source_open_task_id = ot.id
       JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
       JOIN visit_task_device_retrieval_results rr ON rr.visit_task_result_id = vtr.id
      WHERE ot.device_id = $1
        AND ot.task_type = 'device_retrieval'
        AND vtr.final_decision = 'retrieved_successfully'
        AND rr.retrieval_purpose = 'maintenance'
      ORDER BY vtr.closed_at DESC NULLS LAST, vtr.id DESC
      LIMIT 1`,
    [installedDeviceId],
  );
  return rows.length > 0;
}

async function hasActivePeriodicServiceBasis(db: Queryable, installedDeviceId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT d.id
       FROM installed_devices d
       LEFT JOIN contracts c ON c.id = d.contract_id
       LEFT JOIN LATERAL (
         SELECT sa.id
           FROM service_agreements sa
          WHERE sa.installed_device_id = d.id
            AND sa.status = 'active'
            AND (sa.start_date IS NULL OR sa.start_date <= CURRENT_DATE)
            AND (sa.end_date IS NULL OR sa.end_date >= CURRENT_DATE)
          ORDER BY COALESCE(sa.start_date, sa.agreement_date) DESC, sa.id DESC
          LIMIT 1
       ) sa ON TRUE
      WHERE d.id = $1
        AND (d.contract_id IS NOT NULL OR sa.id IS NOT NULL)
      LIMIT 1`,
    [installedDeviceId],
  );
  return rows.length > 0;
}

export async function assertCanRecordSuccessfulDeviceTaskResult(
  db: Queryable,
  input: {
    taskType: DeviceTaskType;
    installedDeviceId: number;
    finalDecision: string | null | undefined;
  },
): Promise<void> {
  if (!isSuccessfulDeviceTaskDecision(input.taskType, input.finalDecision)) return;

  const { rows } = await db.query(
    `SELECT id, status
       FROM installed_devices
      WHERE id = $1
      LIMIT 1
      FOR UPDATE`,
    [input.installedDeviceId],
  );
  const device = rows[0];
  if (!device) {
    throw new DeviceTaskEligibilityError('الجهاز المرتبط بالمهمة غير موجود');
  }

  const status = String(device.status ?? '');
  switch (input.taskType) {
    case 'device_delivery':
      assertStatus(input.taskType, status, ['pending_delivery'], 'لا يمكن تسجيل تسليم ناجح لأن حالة الجهاز الحالية لا تسمح بالتسليم');
      return;
    case 'device_installation':
      assertStatus(input.taskType, status, ['delivered'], 'لا يمكن تسجيل تركيب ناجح إلا لجهاز حالته مسلّم');
      return;
    case 'device_activation':
      assertStatus(input.taskType, status, ['installed', 'active'], 'لا يمكن تسجيل تشغيل ناجح إلا لجهاز مركّب');
      return;
    case 'device_checkup':
      assertStatus(input.taskType, status, ['delivered', 'installed', 'active'], 'لا يمكن تسجيل تشييك ناجح إلا لجهاز موجود عند الزبون');
      return;
    case 'device_disconnection':
      assertStatus(input.taskType, status, ['active', 'out_of_service'], 'لا يمكن تسجيل فك ناجح إلا لجهاز فعال أو مفكوك سابقاً');
      return;
    case 'device_retrieval':
      assertStatus(input.taskType, status, ['out_of_service'], 'لا يمكن تسجيل سحب ناجح إلا لجهاز مفكوك حالته خارج الخدمة');
      if (!(await hasSuccessfulDisconnection(db, input.installedDeviceId))) {
        throw new DeviceTaskEligibilityError('لا يمكن تسجيل سحب ناجح قبل وجود مهمة فك ناجحة سابقة للجهاز');
      }
      return;
    case 'device_return':
      assertStatus(input.taskType, status, ['in_workshop'], 'لا يمكن تسجيل إرجاع ناجح إلا لجهاز حالته في الورشة');
      if (!(await hasSuccessfulMaintenanceRetrieval(db, input.installedDeviceId))) {
        throw new DeviceTaskEligibilityError('لا يمكن تسجيل إرجاع ناجح قبل وجود سحب صيانة ناجح للجهاز');
      }
      return;
    case 'device_transfer':
      assertStatus(input.taskType, status, ['out_of_service'], 'لا يمكن تسجيل نقل ناجح إلا لجهاز مفكوك حالته خارج الخدمة');
      if (!(await hasSuccessfulDisconnection(db, input.installedDeviceId))) {
        throw new DeviceTaskEligibilityError('لا يمكن تسجيل نقل ناجح قبل وجود مهمة فك ناجحة سابقة للجهاز');
      }
      return;
    case 'periodic_maintenance':
      assertStatus(input.taskType, status, ['active'], 'لا يمكن تسجيل صيانة دورية ناجحة إلا لجهاز فعال');
      if (!(await hasActivePeriodicServiceBasis(db, input.installedDeviceId))) {
        throw new DeviceTaskEligibilityError('لا يمكن تسجيل صيانة دورية ناجحة دون عقد أو اتفاق خدمة ساري للجهاز');
      }
      return;
    case 'emergency_maintenance':
      assertStatus(input.taskType, status, ['active', 'installed', 'faulty'], 'لا يمكن تسجيل صيانة طارئة ناجحة لحالة الجهاز الحالية');
      return;
    default:
      return;
  }
}
