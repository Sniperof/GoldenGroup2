// ============================================================
// services/employeeStatusChange.ts — employee status as an operation (migration 479)
// ============================================================
// Status left the edit form: changing it now has consequences, so it is one
// explicit, audited operation. Decisions D1-D5 are listed in the migration.
// ============================================================

import pool from '../db.js';

export type EmployeeStatus = 'active' | 'vacation' | 'suspended' | 'terminated';
export const EMPLOYEE_STATUSES: EmployeeStatus[] = ['active', 'vacation', 'suspended', 'terminated'];
export const STATUS_REASON_CATEGORY = 'employee_status_change_reasons';

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: 'نشط',
  vacation: 'إجازة',
  suspended: 'موقوف',
  terminated: 'منتهي الخدمة',
};

/** Statuses whose system account must not be usable (D1). */
const ACCOUNT_BLOCKING: ReadonlySet<EmployeeStatus> = new Set(['suspended', 'terminated']);

/** A visit counts as open work until it reaches one of these (D2). */
const FINISHED_VISIT_STATUSES = ['completed', 'not_completed', 'cancelled', 'closed'];

export class EmployeeStatusChangeError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;
  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function isEmployeeStatus(value: unknown): value is EmployeeStatus {
  return typeof value === 'string' && (EMPLOYEE_STATUSES as string[]).includes(value);
}

/** D1: what the linked account(s) must do for this transition. */
export function accountEffectFor(from: EmployeeStatus, to: EmployeeStatus): 'deactivated' | 'reactivated' | null {
  if (ACCOUNT_BLOCKING.has(to) && !ACCOUNT_BLOCKING.has(from)) return 'deactivated';
  if (to === 'active' && ACCOUNT_BLOCKING.has(from)) return 'reactivated';
  return null;
}

export interface ChangeEmployeeStatusInput {
  employeeId: number;
  toStatus: EmployeeStatus;
  reasonId: number;
  note?: string | null;
  /** Required when the new status is terminated (YYYY-MM-DD, not future). */
  endOfServiceDate?: string | null;
  /** Required when returning from terminated to active (YYYY-MM-DD). */
  newStartDate?: string | null;
  actorUserId: number;
  canChangeInBranch: (branchId: number) => boolean;
}

export async function changeEmployeeStatus(input: ChangeEmployeeStatusInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, name, status, branch_id,
              to_char(start_work_date, 'YYYY-MM-DD') AS start_work_date,
              to_char(end_of_service_date, 'YYYY-MM-DD') AS end_of_service_date
         FROM employees WHERE id = $1 FOR UPDATE`,
      [input.employeeId],
    );
    const employee = rows[0];
    if (!employee) throw new EmployeeStatusChangeError(404, 'الموظف غير موجود');
    if (!input.canChangeInBranch(Number(employee.branch_id))) {
      throw new EmployeeStatusChangeError(403, 'ليس لديك صلاحية تغيير حالة موظفي هذا الفرع.');
    }

    const fromStatus: EmployeeStatus = isEmployeeStatus(employee.status) ? employee.status : 'active';
    if (fromStatus === input.toStatus) {
      throw new EmployeeStatusChangeError(400, `الموظف بحالة «${STATUS_LABEL[fromStatus]}» أصلاً.`);
    }

    // Changing one's own status could lock the actor out mid-request.
    const { rows: ownRows } = await client.query(
      `SELECT 1 FROM hr_users WHERE id = $1 AND employee_id = $2`,
      [input.actorUserId, input.employeeId],
    );
    if (ownRows.length > 0) {
      throw new EmployeeStatusChangeError(403, 'لا يمكنك تغيير حالتك الوظيفية بنفسك.');
    }

    const { rows: reasonRows } = await client.query(
      `SELECT id FROM system_lists WHERE id = $1 AND category = $2 AND is_active = TRUE`,
      [input.reasonId, STATUS_REASON_CATEGORY],
    );
    if (reasonRows.length === 0) {
      throw new EmployeeStatusChangeError(400, 'سبب تغيير الحالة مطلوب أو غير فعّال.');
    }

    // D2: leaving active work is refused while a visit still counts on them.
    if (input.toStatus !== 'active') {
      const { rows: visits } = await client.query(
        `SELECT fv.id, to_char(fv.scheduled_date, 'YYYY-MM-DD') AS date, fv.status
           FROM field_visits fv
          WHERE fv.status <> ALL($2::text[])
            AND (
              $1 = ANY(public.field_visit_member_ids(
                fv.team_snapshot, fv.reassigned_supervisor_id,
                fv.reassigned_technician_id, fv.reassigned_trainee_id))
              OR fv.team_responsible_user_id IN (SELECT id FROM hr_users WHERE employee_id = $1)
            )
          ORDER BY fv.scheduled_date NULLS LAST, fv.id
          LIMIT 20`,
        [input.employeeId, FINISHED_VISIT_STATUSES],
      );
      if (visits.length > 0) {
        const list = visits.map((v: any) => `#${v.id}${v.date ? ` (${v.date})` : ''}`).join('، ');
        throw new EmployeeStatusChangeError(
          409,
          `لا يمكن تغيير الحالة: الموظف ضمن فريق زيارات لم تنتهِ بعد: ${list}. `
            + 'استبدله في هذه الزيارات عبر «تغيير الفريق» (الفريق الرديف) ثم أعد المحاولة.',
          { openVisits: visits.map((v: any) => ({ id: Number(v.id), date: v.date, status: v.status })) },
        );
      }
    }

    const accountEffect = accountEffectFor(fromStatus, input.toStatus);

    // Migration 480 D2: the dates of the current employment period.
    //   → terminated: the effective end-of-service date (not in the future).
    //   terminated → active (rehire): a new start date; the end date is cleared.
    // Both previous values stay in employee_activity_log.
    const today = new Date().toISOString().slice(0, 10);
    let endOfServiceDate: string | null | undefined;   // undefined = leave as is
    let newStartDate: string | undefined;
    if (input.toStatus === 'terminated') {
      if (!isIsoDate(input.endOfServiceDate)) {
        throw new EmployeeStatusChangeError(400, 'تاريخ إيقاف الخدمة مطلوب.');
      }
      if (input.endOfServiceDate > today) {
        throw new EmployeeStatusChangeError(400, 'تاريخ إيقاف الخدمة لا يمكن أن يكون في المستقبل.');
      }
      if (employee.start_work_date && input.endOfServiceDate < employee.start_work_date) {
        throw new EmployeeStatusChangeError(400, `تاريخ إيقاف الخدمة قبل تاريخ بدء العمل (${employee.start_work_date}).`);
      }
      endOfServiceDate = input.endOfServiceDate;
    } else if (fromStatus === 'terminated' && input.toStatus === 'active') {
      if (!isIsoDate(input.newStartDate)) {
        throw new EmployeeStatusChangeError(400, 'تاريخ بدء العمل الجديد مطلوب عند إعادة الموظف.');
      }
      if (employee.end_of_service_date && input.newStartDate < employee.end_of_service_date) {
        throw new EmployeeStatusChangeError(400, `تاريخ بدء العمل الجديد قبل تاريخ إيقاف الخدمة (${employee.end_of_service_date}).`);
      }
      newStartDate = input.newStartDate;
      endOfServiceDate = null;
    }

    // Status first: the hr_users trigger (479) checks the employee's status
    // when an account is re-enabled. One UPDATE, so the activity log (480)
    // records the status-period dates together.
    await client.query(
      `UPDATE employees
          SET status = $2,
              end_of_service_date = CASE WHEN $3::boolean THEN $4::date ELSE end_of_service_date END,
              start_work_date = COALESCE($5::date, start_work_date)
        WHERE id = $1`,
      [input.employeeId, input.toStatus, endOfServiceDate !== undefined, endOfServiceDate ?? null, newStartDate ?? null],
    );
    if (accountEffect) {
      await client.query(
        `UPDATE hr_users SET is_active = $2 WHERE employee_id = $1`,
        [input.employeeId, accountEffect === 'reactivated'],
      );
    }

    await client.query(
      `INSERT INTO employee_status_changes (
         employee_id, from_status, to_status, reason_id, note, account_effect, changed_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.employeeId, fromStatus, input.toStatus, input.reasonId,
        typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
        accountEffect, input.actorUserId,
      ],
    );

    await client.query('COMMIT');
    return { employeeId: input.employeeId, fromStatus, toStatus: input.toStatus, accountEffect };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listEmployeeStatusChanges(employeeId: number) {
  const { rows } = await pool.query(
    `SELECT c.id, c.from_status AS "fromStatus", c.to_status AS "toStatus", c.note,
            c.account_effect AS "accountEffect", c.changed_at AS "changedAt",
            hu.name AS "changedByName",
            COALESCE(sl.metadata->>'label', sl.value) AS "reasonLabel"
       FROM employee_status_changes c
       LEFT JOIN hr_users hu ON hu.id = c.changed_by
       LEFT JOIN system_lists sl ON sl.id = c.reason_id
      WHERE c.employee_id = $1
      ORDER BY c.changed_at DESC, c.id DESC`,
    [employeeId],
  );
  return rows;
}
