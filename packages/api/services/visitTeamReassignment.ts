// ============================================================
// services/visitTeamReassignment.ts — «الفريق الرديف» (migration 478)
// ============================================================
// Replaces part or all of a scheduled visit's crew. The original crew stays in
// field_visits.team_snapshot; the current one is written to the reassigned_*
// columns (which every reader already resolves per role) plus a full
// reassigned_team_snapshot, and each change is appended to
// field_visit_team_changes. Decisions D1-D8 are listed in the migration.
// ============================================================

import type { PoolClient } from 'pg';
import pool from '../db.js';

export class TeamReassignmentError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type TeamRole = 'supervisor' | 'technician' | 'trainee';
export const TEAM_ROLES: TeamRole[] = ['supervisor', 'technician', 'trainee'];

const SNAPSHOT_KEY: Record<TeamRole, string> = {
  supervisor: 'supervisorEmployeeId',
  technician: 'technicianEmployeeId',
  trainee: 'traineeEmployeeId',
};

const ROLE_LABEL: Record<TeamRole, string> = {
  supervisor: 'المشرف',
  technician: 'الفني',
  trainee: 'المتدرب',
};

export const TEAM_CHANGE_REASON_CATEGORY = 'visit_team_change_reasons';

export type TeamMembers = Record<TeamRole, number | null>;

/** 'solo' = emergency / one-technician slot (technician is responsible). */
export type TeamKind = 'team' | 'solo';

function toId(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
}

export function membersFromSnapshot(snapshot: any): TeamMembers {
  return {
    supervisor: toId(snapshot?.supervisorEmployeeId),
    technician: toId(snapshot?.technicianEmployeeId),
    trainee: toId(snapshot?.traineeEmployeeId),
  };
}

/** Effective crew = reassigned value per role, else the original (same rule as every reader). */
export function effectiveMembers(visit: {
  team_snapshot: any;
  reassigned_supervisor_id: number | null;
  reassigned_technician_id: number | null;
  reassigned_trainee_id: number | null;
}): TeamMembers {
  const original = membersFromSnapshot(visit.team_snapshot);
  return {
    supervisor: toId(visit.reassigned_supervisor_id) ?? original.supervisor,
    technician: toId(visit.reassigned_technician_id) ?? original.technician,
    trainee: toId(visit.reassigned_trainee_id) ?? original.trainee,
  };
}

export function teamKindOf(teamSnapshot: any): TeamKind {
  return /^solo_/.test(String(teamSnapshot?.teamKey ?? '')) ? 'solo' : 'team';
}

export function responsibleRole(kind: TeamKind): TeamRole {
  return kind === 'solo' ? 'technician' : 'supervisor';
}

export function sameMembers(a: TeamMembers, b: TeamMembers): boolean {
  return TEAM_ROLES.every((role) => a[role] === b[role]);
}

/**
 * D2: the replaced crew must keep a valid shape. Readers resolve each role as
 * COALESCE(reassigned, original), so a role that exists in the original crew
 * cannot be emptied — only replaced.
 */
export function validateRequestedTeam(kind: TeamKind, original: TeamMembers, requested: TeamMembers): void {
  if (kind === 'team') {
    if (!requested.supervisor) throw new TeamReassignmentError(400, 'الفريق القياسي يجب أن يضم مشرفاً.');
    if (!requested.technician) throw new TeamReassignmentError(400, 'الفريق القياسي يجب أن يضم فنياً.');
  } else {
    if (!requested.technician) throw new TeamReassignmentError(400, 'فريق الطوارئ يجب أن يضم فنياً.');
    if (requested.supervisor) throw new TeamReassignmentError(400, 'فريق الطوارئ لا يضم مشرفاً.');
  }
  for (const role of TEAM_ROLES) {
    if (original[role] && !requested[role]) {
      throw new TeamReassignmentError(
        400,
        `لا يمكن إزالة ${ROLE_LABEL[role]} من الفريق، يمكن استبداله فقط.`,
      );
    }
  }
  const ids = TEAM_ROLES.map((r) => requested[r]).filter((id): id is number => id != null);
  if (new Set(ids).size !== ids.length) {
    throw new TeamReassignmentError(400, 'لا يمكن أن يشغل موظف واحد أكثر من دور في الفريق.');
  }
}

export function buildTeamSnapshot(originalSnapshot: any, members: TeamMembers, teamKey: string | null) {
  return {
    teamKey: teamKey ?? originalSnapshot?.teamKey ?? null,
    supervisorEmployeeId: members.supervisor,
    technicianEmployeeId: members.technician,
    traineeEmployeeId: members.trainee,
    telemarketerEmployeeIds: Array.isArray(originalSnapshot?.telemarketerEmployeeIds)
      ? originalSnapshot.telemarketerEmployeeIds
      : [],
  };
}

interface LockedVisit {
  id: number;
  branch_id: number;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  team_snapshot: any;
  reassigned_supervisor_id: number | null;
  reassigned_technician_id: number | null;
  reassigned_trainee_id: number | null;
  team_responsible_user_id: number | null;
}

const VISIT_COLUMNS = `id, branch_id, status, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
  scheduled_time, team_snapshot, reassigned_supervisor_id, reassigned_technician_id,
  reassigned_trainee_id, team_responsible_user_id`;

/** Eligible people for one slot: active, same branch, account role fits the slot (as the schedule requires). */
async function loadEligibleEmployees(db: PoolClient | typeof pool, branchId: number, ids: number[] | null) {
  const { rows } = await db.query(
    `SELECT e.id, e.name, LOWER(r.team_slot_type) AS slot, u.id AS hr_user_id
       FROM employees e
       JOIN hr_users u ON u.employee_id = e.id AND u.is_active = TRUE
       JOIN roles r ON r.id = u.role_id
      WHERE e.status = 'active'
        AND e.branch_id = $1
        AND LOWER(r.team_slot_type) IN ('supervisor', 'technician', 'trainee')
        AND ($2::int[] IS NULL OR e.id = ANY($2::int[]))
      ORDER BY e.name`,
    [branchId, ids],
  );
  return rows as Array<{ id: number; name: string; slot: TeamRole; hr_user_id: number }>;
}

/** Employees (of `ids`) already on another non-cancelled visit in the same branch/date/slot. */
async function findBusyEmployees(db: PoolClient | typeof pool, visit: LockedVisit, ids: number[]) {
  if (ids.length === 0 || !visit.scheduled_date || !visit.scheduled_time) return new Map<number, number>();
  const { rows } = await db.query(
    `SELECT fv.id AS visit_id, m.member_id
       FROM field_visits fv
       CROSS JOIN LATERAL unnest(public.field_visit_member_ids(
         fv.team_snapshot, fv.reassigned_supervisor_id,
         fv.reassigned_technician_id, fv.reassigned_trainee_id)) AS m(member_id)
      WHERE fv.id <> $1
        AND fv.status <> 'cancelled'
        AND fv.branch_id = $2
        AND fv.scheduled_date = $3::date
        AND substring(COALESCE(fv.scheduled_time, '') from 1 for 5) = substring($4 from 1 for 5)
        AND m.member_id = ANY($5::int[])`,
    [visit.id, visit.branch_id, visit.scheduled_date, visit.scheduled_time, ids],
  );
  return new Map<number, number>(rows.map((r: any) => [Number(r.member_id), Number(r.visit_id)]));
}

// ─── Options for the modal ────────────────────────────────────────────────

export async function getTeamReassignmentOptions(visitId: number) {
  const { rows } = await pool.query(`SELECT ${VISIT_COLUMNS} FROM field_visits WHERE id = $1`, [visitId]);
  const visit = rows[0] as LockedVisit | undefined;
  if (!visit) throw new TeamReassignmentError(404, 'الزيارة غير موجودة');

  const kind = teamKindOf(visit.team_snapshot);
  const current = effectiveMembers(visit);
  const employees = await loadEligibleEmployees(pool, visit.branch_id, null);
  const busy = await findBusyEmployees(pool, visit, employees.map((e) => e.id));

  // Shortcut (D2): the day's teams with the same shape as this visit.
  const dayTeams: Array<{ teamKey: string; members: TeamMembers }> = [];
  if (visit.scheduled_date) {
    const { rows: schedRows } = await pool.query(
      'SELECT teams, solos FROM day_schedules WHERE date = $1',
      [visit.scheduled_date],
    );
    const slots: any[] = kind === 'solo' ? schedRows[0]?.solos ?? [] : schedRows[0]?.teams ?? [];
    slots.forEach((slot: any, index: number) => {
      dayTeams.push({
        teamKey: `${kind === 'solo' ? 'solo' : 'team'}_${index}`,
        members: {
          supervisor: kind === 'solo' ? null : toId(slot?.supervisor),
          technician: toId(slot?.technician),
          trainee: toId(slot?.trainee),
        },
      });
    });
  }

  const { rows: reasons } = await pool.query(
    `SELECT id, value, COALESCE(metadata->>'label', value) AS label
       FROM system_lists
      WHERE category = $1 AND is_active = TRUE
      ORDER BY display_order, id`,
    [TEAM_CHANGE_REASON_CATEGORY],
  );

  // Names for people who may not be eligible candidates (e.g. the original
  // crew, or day-schedule members of another branch/status).
  const original = membersFromSnapshot(visit.team_snapshot);
  const nameIds = new Set<number>();
  for (const team of [original, current, ...dayTeams.map((t) => t.members)]) {
    for (const role of TEAM_ROLES) if (team[role] != null) nameIds.add(team[role] as number);
  }
  const names: Record<string, string> = {};
  if (nameIds.size > 0) {
    const { rows: nameRows } = await pool.query(
      'SELECT id, name FROM employees WHERE id = ANY($1::int[])',
      [[...nameIds]],
    );
    nameRows.forEach((r: any) => { names[String(r.id)] = r.name; });
  }

  return {
    visitId: visit.id,
    status: visit.status,
    kind,
    original,
    current,
    names,
    candidates: employees.map((e) => ({
      id: Number(e.id),
      name: e.name,
      role: e.slot,
      busyVisitId: busy.get(Number(e.id)) ?? null,
    })),
    dayTeams,
    reasons,
  };
}

// ─── The change itself ────────────────────────────────────────────────────

export interface ReassignTeamInput {
  visitId: number;
  members: TeamMembers;
  /** Set when the user picked a whole team of the day (shortcut). */
  teamKey?: string | null;
  reasonId: number;
  note?: string | null;
  actorUserId: number;
  /** Authorization is the route's job; this receives its verdict per branch. */
  canReassignInBranch: (branchId: number) => boolean;
}

export async function reassignVisitTeam(input: ReassignTeamInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT ${VISIT_COLUMNS} FROM field_visits WHERE id = $1 FOR UPDATE`,
      [input.visitId],
    );
    const visit = rows[0] as LockedVisit | undefined;
    if (!visit) throw new TeamReassignmentError(404, 'الزيارة غير موجودة');
    if (!input.canReassignInBranch(Number(visit.branch_id))) {
      throw new TeamReassignmentError(403, 'ليس لديك صلاحية تغيير فريق زيارات هذا الفرع.');
    }
    // D8: once execution starts, the crew that started is the crew that worked.
    if (visit.status !== 'scheduled') {
      throw new TeamReassignmentError(409, 'يمكن تغيير الفريق فقط قبل بدء الزيارة.');
    }

    const { rows: reasonRows } = await client.query(
      `SELECT id, COALESCE(metadata->>'label', value) AS label FROM system_lists
        WHERE id = $1 AND category = $2 AND is_active = TRUE`,
      [input.reasonId, TEAM_CHANGE_REASON_CATEGORY],
    );
    if (reasonRows.length === 0) throw new TeamReassignmentError(400, 'سبب تغيير الفريق مطلوب أو غير فعّال.');
    const reasonLabel: string = reasonRows[0].label;

    const kind = teamKindOf(visit.team_snapshot);
    const original = membersFromSnapshot(visit.team_snapshot);
    const current = effectiveMembers(visit);
    const requested: TeamMembers = {
      supervisor: toId(input.members.supervisor),
      technician: toId(input.members.technician),
      trainee: toId(input.members.trainee),
    };
    validateRequestedTeam(kind, original, requested);
    if (sameMembers(current, requested)) {
      throw new TeamReassignmentError(400, 'لا يوجد تغيير على الفريق الحالي.');
    }

    // D6: validate only the people being brought in; the rest were valid at booking.
    const changedRoles = TEAM_ROLES.filter((role) => requested[role] !== current[role] && requested[role] != null);
    const incomingIds = changedRoles.map((role) => requested[role] as number);
    const eligible = new Map(
      (await loadEligibleEmployees(client, Number(visit.branch_id), incomingIds)).map((e) => [Number(e.id), e]),
    );
    for (const role of changedRoles) {
      const id = requested[role] as number;
      const employee = eligible.get(id);
      if (!employee) {
        throw new TeamReassignmentError(
          400,
          `${ROLE_LABEL[role]} المختار غير متاح: يجب أن يكون موظفاً فعّالاً من فرع الزيارة وله حساب فعّال.`,
        );
      }
      if (employee.slot !== role) {
        throw new TeamReassignmentError(400, `دور «${employee.name}» لا يناسب خانة ${ROLE_LABEL[role]}.`);
      }
    }
    const busy = await findBusyEmployees(client, visit, incomingIds);
    if (busy.size > 0) {
      const [employeeId, otherVisitId] = [...busy.entries()][0];
      const name = eligible.get(employeeId)?.name ?? `#${employeeId}`;
      throw new TeamReassignmentError(409, `«${name}» لديه زيارة أخرى (#${otherVisitId}) في نفس الموعد.`);
    }

    // D3: responsible follows the responsible role, and must be an active account.
    const responsibleEmployeeId = requested[responsibleRole(kind)] as number;
    const { rows: respRows } = await client.query(
      `SELECT id FROM hr_users WHERE employee_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1`,
      [responsibleEmployeeId],
    );
    if (respRows.length === 0) {
      throw new TeamReassignmentError(400, `${ROLE_LABEL[responsibleRole(kind)]} الجديد ليس له حساب مستخدم فعّال.`);
    }
    const newResponsibleUserId = Number(respRows[0].id);

    const fromTeam = buildTeamSnapshot(visit.team_snapshot, current, null);
    const pickedTeamKey = typeof input.teamKey === 'string' && /^(team|solo)_\d+$/.test(input.teamKey)
      ? input.teamKey
      : null;
    const toTeam = buildTeamSnapshot(visit.team_snapshot, requested, pickedTeamKey);
    const backToOriginal = sameMembers(original, requested)
      && (pickedTeamKey == null || pickedTeamKey === visit.team_snapshot?.teamKey);

    // Transaction-local context for the task-log triggers (migration 475): the
    // team_changed rows on the linked tasks say why the crew changed.
    await client.query(
      `SELECT set_config('app.change_context', 'visit_team_change', true),
              set_config('app.change_reason', $1, true)`,
      [reasonLabel],
    );

    if (backToOriginal) {
      await client.query(
        `UPDATE field_visits
            SET reassigned_supervisor_id = NULL, reassigned_technician_id = NULL,
                reassigned_trainee_id = NULL, reassigned_team_snapshot = NULL,
                reassigned_at = NULL, reassigned_by = NULL,
                team_responsible_user_id = $2, updated_at = NOW()
          WHERE id = $1`,
        [visit.id, newResponsibleUserId],
      );
    } else {
      await client.query(
        `UPDATE field_visits
            SET reassigned_supervisor_id = $2, reassigned_technician_id = $3,
                reassigned_trainee_id = $4, reassigned_team_snapshot = $5::jsonb,
                reassigned_at = NOW(), reassigned_by = $6,
                team_responsible_user_id = $7, updated_at = NOW()
          WHERE id = $1`,
        [
          visit.id, requested.supervisor, requested.technician, requested.trainee,
          JSON.stringify(toTeam), input.actorUserId, newResponsibleUserId,
        ],
      );
    }

    // D3: pending "not started" alerts move to the new responsible.
    await client.query(
      `UPDATE visit_scheduled_alerts SET responsible_user_id = $2
        WHERE visit_id = $1 AND resolved_at IS NULL`,
      [visit.id, newResponsibleUserId],
    );

    // D5: unfinished linked tasks carry the crew that will actually go.
    await client.query(
      `UPDATE open_tasks ot
          SET team_snapshot = $2::jsonb, updated_at = NOW()
        WHERE ot.id IN (
          SELECT vt.source_open_task_id FROM visit_tasks vt
           WHERE vt.field_visit_id = $1 AND vt.source_open_task_id IS NOT NULL
        )
          AND ot.status NOT IN ('completed', 'cancelled', 'closed')`,
      [visit.id, JSON.stringify(toTeam)],
    );

    // D4 (+ D7 through the outbox trigger on this table).
    await client.query(
      `INSERT INTO field_visit_team_changes (
         field_visit_id, from_team, to_team, from_responsible_user_id,
         to_responsible_user_id, reason_id, note, changed_by
       ) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8)`,
      [
        visit.id, JSON.stringify(fromTeam), JSON.stringify(toTeam),
        visit.team_responsible_user_id, newResponsibleUserId, input.reasonId,
        typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
        input.actorUserId,
      ],
    );

    await client.query('COMMIT');
    return { visitId: visit.id, team: toTeam, responsibleUserId: newResponsibleUserId, revertedToOriginal: backToOriginal };
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505' && err?.constraint === 'uq_field_visits_team_slot') {
      throw new TeamReassignmentError(409, 'أحد أعضاء الفريق الجديد لديه زيارة أخرى في نفس الموعد.');
    }
    throw err;
  } finally {
    client.release();
  }
}

/** History rows for the visit detail page, newest first. */
export async function listVisitTeamChanges(visitId: number) {
  const { rows } = await pool.query(
    `SELECT c.id, c.from_team AS "fromTeam", c.to_team AS "toTeam", c.note,
            c.changed_at AS "changedAt", hu.name AS "changedByName",
            COALESCE(sl.metadata->>'label', sl.value) AS "reasonLabel"
       FROM field_visit_team_changes c
       LEFT JOIN hr_users hu ON hu.id = c.changed_by
       LEFT JOIN system_lists sl ON sl.id = c.reason_id
      WHERE c.field_visit_id = $1
      ORDER BY c.changed_at DESC, c.id DESC`,
    [visitId],
  );
  return rows;
}
