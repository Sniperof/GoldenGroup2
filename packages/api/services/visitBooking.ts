// ============================================================
// visitBooking.ts — Unified visit booking service (DEC-003 + DEC-004)
// ============================================================
// Constitution source:
//   DEC-003 D1  — field_visits is the single entity (no separate moa3id table)
//   DEC-003 D2  — POST /telemarketing/book-visit replaces POST /appointments
//   DEC-003 D3  — origin_type + origin_id required on every field_visit
//   DEC-003 D7  — cascading visit_tasks during in_progress for same client_id
//   DEC-004 D18 — triple booking guard: day_schedule + route_assignments + date >= today
//   DEC-004 D22 — Schedule-from-Expected path uses origin_type = 'expected_followup'
//   DEC-007 D47 — team_responsible_user_id snapshot on field_visit
//
// This module is the SINGLE source of truth for "how a visit gets created".
// /telemarketing/book-visit, /open-tasks/:id/schedule-from-expected, and any
// future origin (manual, emergency_request) all funnel through bookVisit().
//
// Returns a structured result; throws an Error with a `.statusCode` property
// for caller-facing validation failures so route handlers can map cleanly.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { resolveTeamZoneIds } from './planningMarketingTargets.js';

export type VisitOriginType =
  | 'telemarketing'
  | 'expected_followup'
  | 'manual'
  | 'emergency_request'
  | 'system';

export interface BookVisitInput {
  branchId: number;
  clientId: number;
  scheduledDate: string;       // 'YYYY-MM-DD'
  scheduledTime: string;       // e.g. '10:00-12:00'
  teamKey: string;             // 'team_0' | 'solo_0' etc.
  originType: VisitOriginType;
  /** Reference id whose semantics depend on originType (call_log id, hr_user id, …) */
  originId: number | string | null;
  /** Open tasks to attach as visit_tasks. Must all belong to clientId. */
  selectedTasks: Array<{ openTaskId: number; taskType: string }>;
  /** User performing the booking — recorded as created_by / team_responsible_user_id source. */
  performedByUserId: number | null;
  customerSnapshot?: Record<string, unknown> | null;
  telemarketerNotes?: string | null;
}

export interface BookVisitResult {
  fieldVisitId: number;
  visitTaskIds: number[];
}

class BookingError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const POST_SALE_TASK_TYPES = new Set([
  'device_delivery',
  'gift_delivery',
  'device_installation',
  'device_activation',
  'device_disconnection',
]);

// ─── D18 triple guard ──────────────────────────────────────────────────────

/**
 * DEC-004 D18: enforce that the visit is being booked into a real planned day.
 * Checks:
 *   1. scheduledDate >= today (local server date).
 *   2. day_schedules row exists for scheduledDate.
 *   3. route_assignments row exists for (date + teamKey).
 *
 * The customer-in-route check is NOT enforced here because the planning service
 * already filters customer eligibility upstream; enforcing it again here would
 * double-block legitimate edge cases (e.g. extraZones added after sync).
 */
export async function assertD18(
  db: PoolClient,
  params: { scheduledDate: string; teamKey: string },
): Promise<void> {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (params.scheduledDate < todayIso) {
    throw new BookingError(
      400,
      `لا يمكن الحجز في تاريخ ماضٍ (${params.scheduledDate}). شرط DEC-004 D18.`,
    );
  }

  const { rows: scheduleRows } = await db.query(
    'SELECT date FROM day_schedules WHERE date = $1 LIMIT 1',
    [params.scheduledDate],
  );
  if (scheduleRows.length === 0) {
    throw new BookingError(
      409,
      `لا يوجد جدول يومي محفوظ لتاريخ ${params.scheduledDate}. اطلب من مدير الفرع حفظ خطة اليوم أولاً (DEC-004 D18).`,
    );
  }

  const assignmentKey = `${params.scheduledDate}_${params.teamKey}`;
  const { rows: assignmentRows } = await db.query(
    'SELECT key FROM route_assignments WHERE key = $1 LIMIT 1',
    [assignmentKey],
  );
  if (assignmentRows.length === 0) {
    throw new BookingError(
      409,
      `لا يوجد توزيع مسارات محفوظ للفريق ${params.teamKey} في تاريخ ${params.scheduledDate} (DEC-004 D18).`,
    );
  }
}

// ─── Task validation ───────────────────────────────────────────────────────

interface TaskRow {
  id: number;
  status: string;
  client_id: number;
  task_type: string;
}

const LOCKED_TASK_STATUSES = new Set([
  'scheduled',
  'completed',
  'closed',
  'cancelled',
]);

async function validateSelectedTasks(
  db: PoolClient,
  input: BookVisitInput,
): Promise<Map<number, TaskRow>> {
  if (!input.selectedTasks || input.selectedTasks.length === 0) {
    throw new BookingError(400, 'يجب اختيار مهمة واحدة على الأقل للحجز.');
  }

  const taskIds = input.selectedTasks.map((t) => t.openTaskId);
  const { rows } = await db.query<TaskRow>(
    `SELECT ot.id, ot.status, ot.client_id, ot.task_type
       FROM open_tasks ot
       INNER JOIN task_type_config ttc ON ttc.task_type = ot.task_type
      WHERE ot.id = ANY($1::int[])
        AND ttc.is_active = TRUE`,
    [taskIds],
  );
  const byId = new Map<number, TaskRow>();
  rows.forEach((r) => byId.set(Number(r.id), r));

  for (const sel of input.selectedTasks) {
    const row = byId.get(sel.openTaskId);
    if (!row) {
      throw new BookingError(
        400,
        `المهمة #${sel.openTaskId} غير موجودة أو نوعها معطّل.`,
      );
    }
    if (Number(row.client_id) !== Number(input.clientId)) {
      throw new BookingError(
        400,
        `المهمة #${sel.openTaskId} لا تخص هذا الزبون.`,
      );
    }
    if (row.task_type !== sel.taskType) {
      throw new BookingError(
        400,
        `نوع المهمة المرسل ("${sel.taskType}") لا يطابق نوع المهمة الفعلي ("${row.task_type}") للمهمة #${sel.openTaskId}.`,
      );
    }
    if (LOCKED_TASK_STATUSES.has(row.status)) {
      throw new BookingError(
        409,
        `لا يمكن حجز موعد — المهمة #${sel.openTaskId} في حالة "${row.status}".`,
      );
    }
  }
  return byId;
}

// ─── Team snapshot helper (used to fill team_responsible_user_id) ──────────

interface TeamSnapshotInfo {
  teamSnapshot: Record<string, unknown> | null;
  /** DEC-007 D47: for TeamSlot = supervisor employee_id; for EmergencySlot = technician. */
  responsibleEmployeeId: number | null;
}

async function loadTeamSnapshot(
  db: PoolClient,
  scheduledDate: string,
  teamKey: string,
): Promise<TeamSnapshotInfo> {
  const { rows } = await db.query(
    'SELECT teams, solos FROM day_schedules WHERE date = $1',
    [scheduledDate],
  );
  const sched = rows[0] ?? null;
  if (!sched) {
    return { teamSnapshot: null, responsibleEmployeeId: null };
  }

  const teamMatch = teamKey.match(/^team_(\d+)$/);
  if (teamMatch) {
    const team = Array.isArray(sched.teams) ? sched.teams[Number(teamMatch[1])] : null;
    if (!team) return { teamSnapshot: null, responsibleEmployeeId: null };
    return {
      teamSnapshot: {
        teamKey,
        supervisorEmployeeId: Number.isInteger(team.supervisor) ? team.supervisor : null,
        technicianEmployeeId: Number.isInteger(team.technician) ? team.technician : null,
        traineeEmployeeId: Number.isInteger(team.trainee) ? team.trainee : null,
        telemarketerEmployeeIds: Array.isArray(team.telemarketers) ? team.telemarketers : [],
      },
      responsibleEmployeeId: Number.isInteger(team.supervisor) ? team.supervisor : null,
    };
  }

  const soloMatch = teamKey.match(/^solo_(\d+)$/);
  if (soloMatch) {
    const solo = Array.isArray(sched.solos) ? sched.solos[Number(soloMatch[1])] : null;
    if (!solo) return { teamSnapshot: null, responsibleEmployeeId: null };
    // Emergency / solo: technician carries the visit per DEC-007 D47.
    return {
      teamSnapshot: {
        teamKey,
        technicianEmployeeId: Number.isInteger(solo.technician) ? solo.technician : null,
        telemarketerEmployeeIds: Array.isArray(solo.telemarketers) ? solo.telemarketers : [],
      },
      responsibleEmployeeId: Number.isInteger(solo.technician) ? solo.technician : null,
    };
  }

  return { teamSnapshot: null, responsibleEmployeeId: null };
}

async function assertTeamSlotAvailable(
  db: PoolClient,
  params: { branchId: number; scheduledDate: string; scheduledTime: string; teamKey: string },
): Promise<void> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT fv.id
       FROM field_visits fv
       LEFT JOIN contact_targets ct ON ct.latest_visit_id = fv.id
      WHERE fv.branch_id = $1
        AND fv.scheduled_date = $2
        AND COALESCE(fv.team_snapshot->>'teamKey', ct.team_key) = $3
        AND substring(COALESCE(fv.scheduled_time, '') from 1 for 5) = substring($4 from 1 for 5)
        AND fv.status IN ('scheduled', 'in_progress', 'ended', 'completed')
      LIMIT 1`,
    [params.branchId, params.scheduledDate, params.teamKey, params.scheduledTime],
  );

  if (rows.length > 0) {
    throw new BookingError(
      409,
      'هذا الموعد محجوز مسبقاً للفريق في نفس الوقت.',
    );
  }
}

/** Resolve hr_users.id from an employee_id (DEC-007 D47 needs FK id). */
async function resolveHrUserId(
  db: PoolClient,
  employeeId: number | null,
): Promise<number | null> {
  if (employeeId == null) return null;
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM hr_users WHERE employee_id = $1 LIMIT 1',
    [employeeId],
  );
  return rows[0]?.id ?? null;
}

// ─── Visit family inference ────────────────────────────────────────────────

function inferVisitFamily(selectedTasks: BookVisitInput['selectedTasks']): 'marketing' | 'service' {
  const allPostSale = selectedTasks.every((t) => POST_SALE_TASK_TYPES.has(t.taskType));
  return allPostSale ? 'service' : 'marketing';
}

// ─── The unified booking entry point ───────────────────────────────────────

export async function bookVisit(input: BookVisitInput): Promise<BookVisitResult> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // 1. D18 triple guard
    await assertD18(db, {
      scheduledDate: input.scheduledDate,
      teamKey: input.teamKey,
    });

    // 2. Validate every selected open_task
    const taskById = await validateSelectedTasks(db, input);

    // 3. Resolve team snapshot + responsible user
    const teamInfo = await loadTeamSnapshot(db, input.scheduledDate, input.teamKey);
    const responsibleHrUserId = await resolveHrUserId(db, teamInfo.responsibleEmployeeId);

    await assertTeamSlotAvailable(db, {
      branchId: input.branchId,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime,
      teamKey: input.teamKey,
    });

    // 4. Create the field_visit
    const visitFamily = inferVisitFamily(input.selectedTasks);
    const { rows: visitRows } = await db.query<{ id: number }>(
      `INSERT INTO field_visits (
         visit_type, visit_family, branch_id, client_id, status,
         scheduled_date, scheduled_time,
         origin_type, origin_id,
         team_snapshot, team_responsible_user_id,
         customer_snapshot,
         appointment_booked_at,
         booked_by_telemarketer_id,
         telemarketer_notes,
         created_by
       ) VALUES (
         'marketing', $1, $2, $3, 'scheduled',
         $4, $5,
         $6, $7,
         $8::jsonb, $9,
         $10::jsonb,
         NOW(),
         $11,
         $12,
         $13
       )
       RETURNING id`,
      [
        visitFamily,
        input.branchId,
        input.clientId,
        input.scheduledDate,
        input.scheduledTime,
        input.originType,
        Number.isInteger(Number(input.originId)) ? Number(input.originId) : null,
        teamInfo.teamSnapshot ? JSON.stringify(teamInfo.teamSnapshot) : null,
        responsibleHrUserId,
        input.customerSnapshot ? JSON.stringify(input.customerSnapshot) : null,
        input.performedByUserId,
        input.telemarketerNotes ?? null,
        input.performedByUserId,
      ],
    );
    const fieldVisitId = Number(visitRows[0].id);

    // 5. Create one visit_task per selection
    const visitTaskIds: number[] = [];
    for (let i = 0; i < input.selectedTasks.length; i++) {
      const sel = input.selectedTasks[i];
      const taskRow = taskById.get(sel.openTaskId)!;
      const taskFamily = POST_SALE_TASK_TYPES.has(sel.taskType) ? 'service' : 'marketing';
      const { rows: vtRows } = await db.query<{ id: number }>(
        `INSERT INTO visit_tasks (
           field_visit_id, source_open_task_id,
           task_type, task_family,
           sequence_no, status
         ) VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        [fieldVisitId, sel.openTaskId, sel.taskType, taskFamily, i + 1],
      );
      visitTaskIds.push(Number(vtRows[0].id));

      // Advance the open_task to scheduled
      await db.query(
        `UPDATE open_tasks
            SET status        = 'scheduled',
                team_snapshot = $1::jsonb,
                assigned_at   = COALESCE(assigned_at, NOW()),
                assigned_by   = COALESCE(assigned_by, $2),
                assigned_via  = COALESCE(assigned_via, $3),
                updated_at    = NOW()
          WHERE id = $4`,
        [
          teamInfo.teamSnapshot ? JSON.stringify(teamInfo.teamSnapshot) : null,
          input.performedByUserId,
          input.originType === 'telemarketing'
            ? 'telemarketing_booking'
            : input.originType === 'expected_followup'
              ? 'manual_override'
              : 'manual_override',
          sel.openTaskId,
        ],
      );

      // Use prior status if it deviates from in_scheduling (audit trail)
      const priorStatus = taskRow.status;
      if (priorStatus && priorStatus !== 'in_scheduling') {
        await db.query(
          `INSERT INTO task_activity_log
             (task_id, event_type, performed_by, role, old_value, new_value, reason)
           VALUES ($1, 'lifecycle_skip', $2, NULL, $3, 'scheduled', $4)`,
          [
            sel.openTaskId,
            input.performedByUserId,
            priorStatus,
            `Booking via ${input.originType} (DEC-003 D2)`,
          ],
        );
      }
    }

    await db.query('COMMIT');
    return { fieldVisitId, visitTaskIds };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

// ─── DEC-011: Field-Initiated Instant Visit ────────────────────────────────

export interface CreateInstantVisitInput {
  performedByUserId: number;
  clientId: number;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  locationMissingReasonId?: number | null;
}

export interface CreateInstantVisitResult {
  fieldVisitId: number;
}

/** Find the teamKey (team_N / solo_N) the employee belongs to in today's schedule. */
async function findTeamKeyForUserToday(
  db: PoolClient,
  employeeId: number,
  date: string,
): Promise<string | null> {
  const { rows } = await db.query('SELECT teams, solos FROM day_schedules WHERE date = $1', [date]);
  const sched = rows[0];
  if (!sched) return null;

  const teams = Array.isArray(sched.teams) ? sched.teams : [];
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i] ?? {};
    if (Number(t.supervisor) === employeeId
        || Number(t.technician) === employeeId
        || Number(t.trainee) === employeeId) {
      return `team_${i}`;
    }
  }
  const solos = Array.isArray(sched.solos) ? sched.solos : [];
  for (let i = 0; i < solos.length; i++) {
    if (Number(solos[i]?.technician) === employeeId) return `solo_${i}`;
  }
  return null;
}

/**
 * DEC-011: create an off-plan visit on the spot, already in_progress. The team
 * responsible (supervisor/technician) creates it for a customer in their branch
 * whose neighborhood falls in their route zones today. Starts empty — tasks are
 * added via the pull flow (DEC-010). Hard guards: D18 (day+route exist), branch,
 * zone membership, and cooldown/do_not_contact (BLOCK). Also creates+closes a
 * contact_target so daily-contact reporting stays coherent.
 */
export async function createInstantVisit(input: CreateInstantVisitInput): Promise<CreateInstantVisitResult> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();

    // 1. Resolve performer → employee + branch.
    const { rows: userRows } = await db.query(
      `SELECT u.employee_id AS "employeeId", e.branch_id AS "branchId"
         FROM hr_users u
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.id = $1 AND u.is_active = TRUE`,
      [input.performedByUserId],
    );
    const employeeId = Number(userRows[0]?.employeeId);
    const branchId = Number(userRows[0]?.branchId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      throw new BookingError(403, 'حسابك غير مرتبط بموظف — لا يمكن إنشاء زيارة فورية.');
    }
    if (!Number.isInteger(branchId) || branchId <= 0) {
      throw new BookingError(409, 'تعذّر تحديد فرعك من بيانات الموظف.');
    }

    // 2. Resolve the team she leads today.
    const teamKey = await findTeamKeyForUserToday(db, employeeId, today);
    if (!teamKey) {
      throw new BookingError(409, 'لست ضمن أي فريق في جدول اليوم — لا يمكن إنشاء زيارة فورية.');
    }

    // 3. D18 triple guard (day_schedule + route_assignment + date>=today).
    await assertD18(db, { scheduledDate: today, teamKey });

    // 4. Team snapshot + responsible user.
    const teamInfo = await loadTeamSnapshot(db, today, teamKey);
    const responsibleHrUserId = await resolveHrUserId(db, teamInfo.responsibleEmployeeId);

    // 5. Client guards: exists, active, same branch.
    const { rows: clientRows } = await db.query(
      `SELECT id, name, mobile, detailed_address, branch_id, neighborhood, water_source,
              cooldown_until, do_not_contact, is_active, deleted_at
         FROM clients WHERE id = $1 LIMIT 1`,
      [input.clientId],
    );
    const client = clientRows[0];
    if (!client || client.deleted_at != null || client.is_active === false) {
      throw new BookingError(404, 'الزبون غير موجود أو غير نشط.');
    }
    if (Number(client.branch_id) !== branchId) {
      throw new BookingError(403, 'هذا الزبون ليس ضمن فرعك (DEC-011).');
    }

    // 6. Cooldown / do_not_contact — BLOCK (DEC-005, no field override).
    if (client.do_not_contact === true) {
      throw new BookingError(409, 'الزبون مُعلَّم «عدم التواصل» — لا يمكن إنشاء زيارة.');
    }
    if (client.cooldown_until != null) {
      const cd = new Date(client.cooldown_until).toISOString().slice(0, 10);
      if (cd >= today) {
        throw new BookingError(409, `الزبون ضمن فترة تهدئة حتى ${cd} — لا يمكن إنشاء زيارة فورية (DEC-005).`);
      }
    }

    // 7. Zone guard: client's neighborhood must be in the team's route zones today.
    const neighborhood = Number(client.neighborhood);
    if (!Number.isInteger(neighborhood) || neighborhood <= 0) {
      throw new BookingError(409, 'الزبون بلا منطقة محدّدة — لا يمكن التحقق من نطاق فريقك.');
    }
    const zoneIds = await resolveTeamZoneIds(today, teamKey);
    if (!zoneIds.includes(neighborhood)) {
      throw new BookingError(403, 'منطقة الزبون ليست ضمن مسار فريقك اليوم (DEC-011).');
    }

    // 8. GPS / location_missing (DEC-004 D17).
    const lat = input.lat != null ? Number(input.lat) : null;
    const lng = input.lng != null ? Number(input.lng) : null;
    const accuracy = input.accuracy != null ? Number(input.accuracy) : null;
    const locationMissing = lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng);
    const locationMissingReasonId = Number(input.locationMissingReasonId) || null;
    if (locationMissing && !locationMissingReasonId) {
      throw new BookingError(400, 'GPS غير متاح — يجب اختيار سبب (locationMissingReasonId).');
    }

    // 9. Create the field_visit, already in_progress.
    const customerSnapshot = {
      name: client.name,
      address: client.detailed_address,
      mobile: client.mobile,
      teamKey,
      waterSource: client.water_source,
      fieldInitiated: true,
    };
    const timeSlot = now.toTimeString().slice(0, 5);
    const { rows: visitRows } = await db.query(
      `INSERT INTO field_visits (
         visit_type, visit_family, branch_id, client_id, status,
         scheduled_date, scheduled_time,
         origin_type, origin_id,
         team_snapshot, team_responsible_user_id,
         customer_snapshot, appointment_booked_at, created_by
       ) VALUES (
         'marketing', 'marketing', $1, $2, 'in_progress',
         $3, $4,
         'field_initiated', $5,
         $6::jsonb, $7,
         $8::jsonb, NOW(), $5
       )
       RETURNING id`,
      [
        branchId,
        input.clientId,
        today,
        timeSlot,
        input.performedByUserId,
        teamInfo.teamSnapshot ? JSON.stringify(teamInfo.teamSnapshot) : null,
        responsibleHrUserId,
        JSON.stringify(customerSnapshot),
      ],
    );
    const fieldVisitId = Number(visitRows[0].id);

    // 10. Start geo log (mirrors POST /:id/start).
    await db.query(
      `INSERT INTO visit_geo_logs (visit_id, actual_start_time, actual_start_lat, actual_start_lng,
         actual_start_accuracy, location_missing, location_missing_reason, started_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        fieldVisitId,
        now,
        locationMissing ? null : lat,
        locationMissing ? null : lng,
        accuracy && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        locationMissing,
        locationMissing ? locationMissingReasonId : null,
        input.performedByUserId,
      ],
    );

    // 11. Create + close the contact_target (DEC-005 / D23 reporting coherence).
    await db.query(
      `INSERT INTO contact_targets (
         branch_id, target_type, target_id, target_stage, visit_type,
         source_type, source_id, supervisor_hr_user_id, zone_id, status,
         date, team_key, work_location_geo_unit_id,
         closing_reason, closed_by, closed_at, latest_visit_id
       )
       VALUES ($1, 'client', $2, 'lead', 'marketing', 'lead', $2, $3, $4, 'closed',
               $5::date, $6, $4, 'field_initiated_visit', $7, NOW(), $8)
       ON CONFLICT (branch_id, target_type, target_id, work_location_geo_unit_id, date)
       WHERE work_location_geo_unit_id IS NOT NULL
       DO UPDATE SET
         status = 'closed',
         closing_reason = 'field_initiated_visit',
         closed_by = EXCLUDED.closed_by,
         closed_at = NOW(),
         latest_visit_id = EXCLUDED.latest_visit_id,
         team_key = EXCLUDED.team_key,
         updated_at = NOW()`,
      [
        branchId,
        input.clientId,
        responsibleHrUserId,
        neighborhood,
        today,
        teamKey,
        input.performedByUserId,
        fieldVisitId,
      ],
    );

    await db.query('COMMIT');
    return { fieldVisitId };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}

export { BookingError };
