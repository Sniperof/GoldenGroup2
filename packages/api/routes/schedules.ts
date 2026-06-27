import { Router, type Request } from 'express';
import pool from '../db.js';
import { getOrBuildAuthContext } from '../middleware/permission.js';
import { resolveListAccessScope } from '../services/authorizationService.js';
import type { AuthContext, AuthUser } from '@golden-crm/shared';

const router = Router();

// Branch-isolation for the shared global day_schedules row (GAP-DS-005). A slot's
// owning branch is DERIVED from its lead employee (team → supervisor, solo →
// technician → employees.branch_id). A non-GLOBAL viewer must not see slots owned
// by other branches, but the array index IS the team_key (route_assignments key
// `date_team_N`), so slots can never be removed/reordered — out-of-scope slots are
// replaced IN PLACE with a `{ locked: true }` placeholder that preserves the index.
const LOCKED_SLOT = { locked: true } as const;

function isLockedSlot(slot: any): boolean {
  return Boolean(slot) && typeof slot === 'object' && slot.locked === true;
}

function slotOwnerEmployeeId(slot: any, isSolo: boolean): number | null {
  if (!slot || typeof slot !== 'object') return null;
  const candidate = isSolo ? slot.technician : (slot.supervisor ?? slot.technician);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

async function scopeScheduleForViewer(authContext: AuthContext, schedule: any) {
  const teams: any[] = Array.isArray(schedule.teams) ? schedule.teams : [];
  const solos: any[] = Array.isArray(schedule.solos) ? schedule.solos : [];

  // GLOBAL / super-admin: a specific selected branch (the branch switcher →
  // actingBranchId) narrows the view to that branch; "all branches" (no selection)
  // shows every branch's teams unredacted. Branch-scoped viewers always see only
  // their own branches.
  const plan = resolveListAccessScope(authContext, 'routes.assign.view');
  const isGlobal = authContext.isSuperAdmin || plan.scope === 'GLOBAL';
  const actingBranchId = authContext.actingBranchId ?? null;
  let allowed: Set<number> | null;
  if (isGlobal) {
    allowed = actingBranchId == null ? null : new Set([actingBranchId]);
  } else {
    allowed = new Set(authContext.allowedBranchIds);
  }
  const ownerIds = [
    ...teams.map(t => slotOwnerEmployeeId(t, false)),
    ...solos.map(s => slotOwnerEmployeeId(s, true)),
  ].filter((id): id is number => id != null);

  const branchByEmployee = new Map<number, number>();
  const nameByEmployee = new Map<number, string>();
  if (ownerIds.length > 0) {
    const { rows } = await pool.query<{ id: number; branchId: number; name: string }>(
      'SELECT id, branch_id AS "branchId", name FROM employees WHERE id = ANY($1::int[])',
      [[...new Set(ownerIds)]],
    );
    rows.forEach(r => {
      branchByEmployee.set(Number(r.id), Number(r.branchId));
      if (typeof r.name === 'string' && r.name.trim()) {
        nameByEmployee.set(Number(r.id), r.name.trim());
      }
    });
  }

  const isVisible = (slot: any, isSolo: boolean): boolean => {
    const empId = slotOwnerEmployeeId(slot, isSolo);
    if (empId == null) return true;                 // empty/unowned slot: nothing to leak
    const ownerBranch = branchByEmployee.get(empId);
    return allowed == null || ownerBranch == null || allowed.has(ownerBranch); // null owner-branch → permissive (GAP-DS-005)
  };

  const enrichTeam = (team: any, index: number) => {
    const supervisorName = nameByEmployee.get(Number(team?.supervisor)) ?? null;
    return {
      ...team,
      teamKey: `team_${index}`,
      supervisorName,
      teamLabel: supervisorName ? `فريق ${supervisorName}` : `فريق #${index + 1}`,
    };
  };

  const enrichSolo = (solo: any, index: number) => {
    const technicianName = nameByEmployee.get(Number(solo?.technician)) ?? null;
    return {
      ...solo,
      teamKey: `solo_${index}`,
      technicianName,
      teamLabel: technicianName ? `طوارئ: ${technicianName}` : `فريق طوارئ #${index + 1}`,
    };
  };

  return {
    ...schedule,
    teams: teams.map((t, index) => (isVisible(t, false) ? enrichTeam(t, index) : { ...LOCKED_SLOT })),
    solos: solos.map((s, index) => (isVisible(s, true) ? enrichSolo(s, index) : { ...LOCKED_SLOT })),
  };
}

type ScheduleRole = 'supervisor' | 'technician' | 'telemarketer' | 'trainee';

interface ScheduleAssignment {
  id: number;
  role: ScheduleRole;
  label: string;
}

function toEmployeeId(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : null;
}

function addAssignment(
  assignments: ScheduleAssignment[],
  value: unknown,
  role: ScheduleRole,
  label: string,
) {
  if (value == null) {
    return;
  }

  const id = toEmployeeId(value);
  if (id == null) {
    const error = new Error(`Invalid employee id in ${label}`);
    (error as any).status = 400;
    throw error;
  }

  assignments.push({ id, role, label });
}

function collectScheduleAssignments(teams: unknown, solos: unknown): ScheduleAssignment[] {
  if (!Array.isArray(teams) || !Array.isArray(solos)) {
    const error = new Error('Invalid schedule payload');
    (error as any).status = 400;
    throw error;
  }

  const assignments: ScheduleAssignment[] = [];

  teams.forEach((team: any, index) => {
    if (!team || typeof team !== 'object' || Array.isArray(team)) {
      const error = new Error(`Invalid team at index ${index}`);
      (error as any).status = 400;
      throw error;
    }

    if (Array.isArray(team.trainee)) {
      const error = new Error(`Team ${index + 1} can have only one trainee`);
      (error as any).status = 400;
      throw error;
    }

    if (team.trainees != null) {
      const error = new Error(`Team ${index + 1} must use trainee, not trainees`);
      (error as any).status = 400;
      throw error;
    }

    addAssignment(assignments, team.supervisor, 'supervisor', `team ${index + 1} supervisor`);
    addAssignment(assignments, team.technician, 'technician', `team ${index + 1} technician`);
    addAssignment(assignments, team.trainee, 'trainee', `team ${index + 1} trainee`);

    if (team.telemarketers != null && !Array.isArray(team.telemarketers)) {
      const error = new Error(`Invalid telemarketers list in team ${index + 1}`);
      (error as any).status = 400;
      throw error;
    }

    (team.telemarketers || []).forEach((telemarketerId: unknown, teleIndex: number) => {
      addAssignment(
        assignments,
        telemarketerId,
        'telemarketer',
        `team ${index + 1} telemarketer ${teleIndex + 1}`,
      );
    });
  });

  solos.forEach((solo: any, index) => {
    if (!solo || typeof solo !== 'object' || Array.isArray(solo)) {
      const error = new Error(`Invalid solo slot at index ${index}`);
      (error as any).status = 400;
      throw error;
    }

    addAssignment(assignments, solo.technician, 'technician', `emergency ${index + 1} technician`);
    addAssignment(assignments, solo.trainee, 'trainee', `emergency ${index + 1} trainee`);

    if (solo.telemarketers != null && !Array.isArray(solo.telemarketers)) {
      const error = new Error(`Invalid telemarketers list in emergency ${index + 1}`);
      (error as any).status = 400;
      throw error;
    }

    (solo.telemarketers || []).forEach((telemarketerId: unknown, teleIndex: number) => {
      addAssignment(
        assignments,
        telemarketerId,
        'telemarketer',
        `emergency ${index + 1} telemarketer ${teleIndex + 1}`,
      );
    });
  });

  return assignments;
}

async function validateSchedulePayload(req: any, teams: unknown, solos: unknown) {
  const branchId = req.authContext?.actingBranchId ?? req.scope?.branchId ?? null;
  if (!branchId) {
    return {
      ok: false,
      status: 400,
      error: 'يجب تحديد فرع فعال قبل حفظ جدول الفرق',
    };
  }

  let assignments: ScheduleAssignment[];
  try {
    assignments = collectScheduleAssignments(teams, solos);
  } catch (err: any) {
    return {
      ok: false,
      status: err.status || 400,
      error: err.message || 'صيغة جدول الفرق غير صحيحة',
    };
  }

  const seen = new Map<number, string>();
  for (const assignment of assignments) {
    const previous = seen.get(assignment.id);
    if (previous) {
      return {
        ok: false,
        status: 400,
        error: `لا يمكن تكرار الموظف #${assignment.id} في أكثر من خانة (${previous} و ${assignment.label})`,
      };
    }
    seen.set(assignment.id, assignment.label);
  }

  const employeeIds = [...seen.keys()];
  if (employeeIds.length === 0) {
    return { ok: true };
  }

  const { rows } = await pool.query(
    `SELECT
       e.id,
       e.role,
       e.status,
       e.branch_id AS "branchId",
       EXISTS (
         SELECT 1
           FROM hr_users su
           JOIN role_permission_grants srpg ON srpg.role_id = su.role_id
           JOIN permissions sp ON sp.id = srpg.permission_id
          WHERE su.employee_id = e.id
            AND su.is_active = TRUE
            AND sp.key = 'planning.schedule.appear'
       ) AS "canAppearInSchedule",
       (SELECT r.team_slot_type
          FROM hr_users u
          JOIN roles r ON r.id = u.role_id
         WHERE u.employee_id = e.id
           AND u.is_active = TRUE
         LIMIT 1) AS "teamSlotType"
     FROM employees e
     WHERE e.id = ANY($1::int[])`,
    [employeeIds],
  );

  const employeesById = new Map<number, any>(rows.map(row => [Number(row.id), row]));
  for (const assignment of assignments) {
    const employee = employeesById.get(assignment.id);
    if (!employee) {
      return {
        ok: false,
        status: 400,
        error: `الموظف #${assignment.id} غير موجود`,
      };
    }

    if (employee.status !== 'active') {
      return {
        ok: false,
        status: 400,
        error: `الموظف #${assignment.id} غير نشط ولا يمكن حفظه في جدول الفرق`,
      };
    }

    if (employee.canAppearInSchedule !== true) {
      return {
        ok: false,
        status: 400,
        error: `الموظف #${assignment.id} لا يملك صلاحية الظهور في جدولة الفرق`,
      };
    }

    if (Number(employee.branchId) !== Number(branchId)) {
      return {
        ok: false,
        status: 400,
        error: `الموظف #${assignment.id} لا يتبع الفرع الحالي`,
      };
    }

    const expectedSlot = assignment.role.toUpperCase();
    if (employee.teamSlotType !== expectedSlot) {
      return {
        ok: false,
        status: 400,
        error: `دور الموظف #${assignment.id} لا يناسب خانة ${assignment.label}`,
      };
    }
  }

  // Validate each standard team: supervisor + technician required.
  for (let teamIdx = 0; teamIdx < (teams as any[]).length; teamIdx++) {
    const team = (teams as any[])[teamIdx];
    const teamNum = teamIdx + 1;

    if (toEmployeeId(team.supervisor) == null) {
      return { ok: false, status: 400, error: `الفريق ${teamNum} يجب أن يضم مشرفاً` };
    }
    if (toEmployeeId(team.technician) == null) {
      return { ok: false, status: 400, error: `الفريق ${teamNum} يجب أن يضم فنياً` };
    }
  }

  // Validate emergency slots: technician is required; trainee and telemarketer are both optional and independent
  for (let soloIdx = 0; soloIdx < (solos as any[]).length; soloIdx++) {
    const solo = (solos as any[])[soloIdx];
    const soloNum = soloIdx + 1;

    if (toEmployeeId(solo.technician) == null) {
      return { ok: false, status: 400, error: `فريق الطوارئ ${soloNum} يجب أن يضم فنياً` };
    }
  }

  return { ok: true };
}

/**
 * @swagger
 * components:
 *   schemas:
 *     DaySchedule:
 *       type: object
 *       properties:
 *         date:
 *           type: string
 *           format: date
 *         teams:
 *           type: array
 *           items:
 *             type: object
 *         solos:
 *           type: array
 *           items:
 *             type: object
 */

/**
 * @swagger
 * /api/schedules/{date}:
 *   get:
 *     tags: [Schedules]
 *     summary: Retrieve day schedule for a specific date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Day schedule retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DaySchedule'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/:date', async (req, res) => {
  const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
  const { rows } = await pool.query('SELECT * FROM day_schedules WHERE date = $1', [req.params.date]);
  if (rows.length === 0) {
    return res.json({ date: req.params.date, teams: [], solos: [] });
  }
  res.json(await scopeScheduleForViewer(authContext, rows[0]));
});

/**
 * @swagger
 * /api/schedules/{date}:
 *   put:
 *     tags: [Schedules]
 *     summary: Create or update day schedule for a specific date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Branch ID
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date (YYYY-MM-DD)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DaySchedule'
 *     responses:
 *       200:
 *         description: Day schedule updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DaySchedule'
 *       400:
 *         description: Validation failed (e.g. inactive employee or missing roles)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/:date', async (req, res) => {
  const { teams = [], solos = [] } = req.body ?? {};
  const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
  const plan = resolveListAccessScope(authContext, 'routes.assign.view');
  // Wholesale replace is safe ONLY for an all-branches GLOBAL view (saw every slot
  // unredacted). A selected branch — GLOBAL or branch-scoped — saw foreign slots as
  // `{ locked: true }`, so it MUST merge to avoid wiping other branches' teams.
  const isGlobal = authContext.isSuperAdmin || plan.scope === 'GLOBAL';
  const privileged = isGlobal && authContext.actingBranchId == null;

  // Branch-isolation merge (GAP-DS-005). A branch manager only ever edits its own
  // slots; foreign slots reach the client as `{ locked: true }` placeholders (see
  // scopeScheduleForViewer) that preserve the team_key index. On save we:
  //   1. validate ONLY the editor's own (non-locked) slots — all must be its branch,
  //   2. write a MERGED array: locked slots are restored verbatim from the stored row
  //      by index, so a branch save never wipes another branch's teams.
  // The index alignment relies on the FE never removing/reordering a locked slot.
  const ownTeams = privileged ? teams : (teams as any[]).filter(t => !isLockedSlot(t));
  const ownSolos = privileged ? solos : (solos as any[]).filter(s => !isLockedSlot(s));
  const validation = await validateSchedulePayload(req, ownTeams, ownSolos);
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }

  let mergedTeams: any[] = teams;
  let mergedSolos: any[] = solos;
  if (!privileged && ((teams as any[]).some(isLockedSlot) || (solos as any[]).some(isLockedSlot))) {
    const { rows: storedRows } = await pool.query(
      'SELECT teams, solos FROM day_schedules WHERE date = $1',
      [req.params.date],
    );
    const storedTeams: any[] = Array.isArray(storedRows[0]?.teams) ? storedRows[0].teams : [];
    const storedSolos: any[] = Array.isArray(storedRows[0]?.solos) ? storedRows[0].solos : [];
    // Keep the index: a locked placeholder is replaced by the stored slot it stood for.
    mergedTeams = (teams as any[]).map((t, i) => (isLockedSlot(t) ? storedTeams[i] : t));
    mergedSolos = (solos as any[]).map((s, i) => (isLockedSlot(s) ? storedSolos[i] : s));
  }

  // DEC-009 لبنة 8 (freeze): a team whose contact targets are already generated for
  // this date cannot be deleted — its committed call list and assigned tasks depend
  // on the slot index (team_N). Composition may still change; only removal is blocked.
  const { rows: generatedTeamRows } = await pool.query(
    'SELECT DISTINCT team_key FROM telemarketing_task_lists WHERE date = $1',
    [req.params.date],
  );
  for (const gr of generatedTeamRows) {
    const m = String(gr.team_key).match(/^(team|solo)_(\d+)$/);
    if (!m) continue;
    const idx = Number(m[2]);
    const slot = m[1] === 'team' ? mergedTeams[idx] : mergedSolos[idx];
    const slotMissing = slot == null || (typeof slot === 'object' && Object.keys(slot).length === 0);
    if (slotMissing) {
      return res.status(409).json({
        error: `تعذّر الحفظ: لا يمكن حذف الفريق بعد توليد جهات اتصاله لهذا اليوم (DEC-009 لبنة 8).`,
        code: 'TEAM_FROZEN_AFTER_GENERATION',
        teamKey: gr.team_key,
      });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO day_schedules (date, teams, solos) VALUES ($1, $2, $3)
    ON CONFLICT (date) DO UPDATE SET teams=$2, solos=$3 RETURNING *`,
    [req.params.date, JSON.stringify(mergedTeams), JSON.stringify(mergedSolos)]
  );
  // Re-scope the response so the saver doesn't receive other branches' identities back.
  res.json(await scopeScheduleForViewer(authContext, rows[0]));
});

export default router;
