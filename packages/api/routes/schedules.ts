import { Router } from 'express';
import pool from '../db.js';

const router = Router();

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
  const { rows } = await pool.query('SELECT * FROM day_schedules WHERE date = $1', [req.params.date]);
  if (rows.length > 0) {
    res.json(rows[0]);
  } else {
    res.json({ date: req.params.date, teams: [], solos: [] });
  }
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
  const validation = await validateSchedulePayload(req, teams, solos);
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }

  const { rows } = await pool.query(
    `INSERT INTO day_schedules (date, teams, solos) VALUES ($1, $2, $3)
    ON CONFLICT (date) DO UPDATE SET teams=$2, solos=$3 RETURNING *`,
    [req.params.date, JSON.stringify(teams), JSON.stringify(solos)]
  );
  res.json(rows[0]);
});

export default router;
