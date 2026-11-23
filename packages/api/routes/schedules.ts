import { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import { getOrBuildAuthContext, requirePermission } from '../middleware/permission.js';
import { resolveListAccessScope } from '../services/authorizationService.js';
import type { AuthContext, AuthUser } from '@golden-crm/shared';
import { lockPlanningScheduleMutation } from '../services/planningTaskCuration.js';
import { mergeScheduledTeams } from '../services/scheduleSlotMerge.js';
import { isPastPlanningDay, PAST_DAY_LOCKED_RESPONSE } from '../services/planningPastDayLock.js';
import {
  loadResolvedTeams,
  loadScheduledTeams,
  loadTeamTypeCatalog,
  nextTeamKey,
  resolveTeam,
  serializeScheduledTeams,
  teamDisplayLabel,
  teamIdentity,
  type ResolvedTeam,
  type ScheduledTeam,
} from '../services/daySchedule.js';
import {
  SchedulePayloadError,
  parseScheduleTeams,
  validateScheduledTeams,
  type ScheduleEmployeeInfo,
} from '../services/scheduleValidation.js';

const router = Router();

// `:date` is a calendar day. A malformed value used to reach the DB and come
// back as a 500; reject it up front for every /:date route.
router.param('date', (req, res, next, value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    res.status(400).json({ error: 'صيغة التاريخ غير صالحة (YYYY-MM-DD)' });
    return;
  }
  next();
});

// Branch-isolation for the shared global day_schedules row (GAP-DS-005). A
// team's owning branch is DERIVED from its lead employee (employees.branch_id).
// A non-GLOBAL viewer must not see other branches' teams: they come back as
// `{ key, locked: true }` placeholders. Since DEC-026 phase 2 every team has an
// explicit key, so placeholders no longer hold array positions; the save
// restores foreign teams from the stored row by key (mergeScheduledTeams).

type ResolvedVisibility = {
  isVisible: (team: ResolvedTeam) => boolean;
  nameByEmployee: Map<number, string>;
};

async function resolveTeamVisibility(authContext: AuthContext, teams: ResolvedTeam[]): Promise<ResolvedVisibility> {
  // GLOBAL / super-admin: a specific selected branch (the branch switcher →
  // actingBranchId) narrows the view to that branch; "all branches" (no selection)
  // shows every branch's teams unredacted. Branch-scoped viewers always see only
  // their own branches.
  const plan = resolveListAccessScope(authContext, 'routes.assign.view');
  const isGlobal = authContext.isSuperAdmin || plan.scope === 'GLOBAL';
  const actingBranchId = authContext.actingBranchId ?? null;
  const allowed: Set<number> | null = isGlobal
    ? (actingBranchId == null ? null : new Set([actingBranchId]))
    : new Set(authContext.allowedBranchIds);

  const leadIds = [...new Set(teams.map(team => team.leadEmployeeId).filter((id): id is number => id != null))];
  const branchByEmployee = new Map<number, number>();
  const nameByEmployee = new Map<number, string>();
  if (leadIds.length > 0) {
    const { rows } = await pool.query<{ id: number; branchId: number; name: string }>(
      'SELECT id, branch_id AS "branchId", name FROM employees WHERE id = ANY($1::int[])',
      [leadIds],
    );
    rows.forEach(r => {
      branchByEmployee.set(Number(r.id), Number(r.branchId));
      if (typeof r.name === 'string' && r.name.trim()) nameByEmployee.set(Number(r.id), r.name.trim());
    });
  }

  const isVisible = (team: ResolvedTeam): boolean => {
    if (team.leadEmployeeId == null) return true; // no lead: nothing to leak
    const ownerBranch = branchByEmployee.get(team.leadEmployeeId);
    return allowed == null || ownerBranch == null || allowed.has(ownerBranch); // null owner-branch → permissive (GAP-DS-005)
  };

  return { isVisible, nameByEmployee };
}

async function scopeScheduleForViewer(authContext: AuthContext, date: string, teams: ResolvedTeam[]) {
  const { isVisible, nameByEmployee } = await resolveTeamVisibility(authContext, teams);
  return {
    date,
    teams: teams.map(team => {
      if (!isVisible(team)) return { key: team.key, locked: true as const };
      const leadName = team.leadEmployeeId != null ? nameByEmployee.get(team.leadEmployeeId) ?? null : null;
      return {
        key: team.key,
        teamType: team.teamType,
        teamTypeName: team.type?.name ?? null,
        members: team.members,
        leadEmployeeId: team.leadEmployeeId,
        leadName,
        teamLabel: teamDisplayLabel(team, leadName, team.type?.name),
      };
    }),
  };
}

/** Every team key the day has ever used, so a new team never reuses a number. */
async function loadUsedTeamKeys(db: PoolClient, date: string): Promise<string[]> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT substring(key FROM '^[0-9]{4}-[0-9]{2}-[0-9]{2}_(.+)$') AS key
       FROM route_assignments WHERE starts_with(key, $1 || '_')
     UNION SELECT team_key FROM telemarketing_task_lists WHERE date = $1
     UNION SELECT team_key FROM work_scopes WHERE date = $1::date
     UNION SELECT assigned_team_key FROM open_tasks WHERE assigned_for_date = $1::date AND assigned_team_key IS NOT NULL
     UNION SELECT team_key FROM planning_task_exclusions WHERE planning_date = $1::date
     UNION SELECT team_key FROM planning_day_cycles WHERE planning_date = $1::date
     UNION SELECT team_key FROM contact_targets WHERE date = $1::date AND team_key IS NOT NULL`,
    [date],
  );
  return rows.map(r => r.key).filter(Boolean);
}

async function loadScheduleEmployees(employeeIds: number[]): Promise<Map<number, ScheduleEmployeeInfo>> {
  if (employeeIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT
       e.id,
       e.name,
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
       (SELECT u.role_id
          FROM hr_users u
         WHERE u.employee_id = e.id
           AND u.is_active = TRUE
         ORDER BY u.id
         LIMIT 1) AS "roleId"
     FROM employees e
     WHERE e.id = ANY($1::int[])`,
    [employeeIds],
  );
  return new Map(rows.map(row => [Number(row.id), {
    id: Number(row.id),
    name: typeof row.name === 'string' ? row.name : null,
    status: row.status,
    branchId: row.branchId == null ? null : Number(row.branchId),
    roleId: row.roleId == null ? null : Number(row.roleId),
    canAppearInSchedule: row.canAppearInSchedule === true,
  }]));
}

async function loadBranchTeamTypeKeys(db: PoolClient, branchId: number): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT tt.key FROM branch_team_types btt JOIN team_types tt ON tt.id = btt.team_type_id
      WHERE btt.branch_id = $1 AND tt.is_active`,
    [branchId],
  );
  return new Set(rows.map(r => r.key));
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
router.get('/:date', requirePermission('planning.manage'), async (req, res) => {
  const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
  const date = String(req.params.date);
  const teams = await loadResolvedTeams(pool, date);
  res.json(await scopeScheduleForViewer(authContext, date, teams));
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
router.put('/:date', requirePermission('planning.manage'), async (req, res) => {
  const scheduleDate = String(Array.isArray(req.params.date) ? req.params.date[0] : req.params.date);
  if (isPastPlanningDay(scheduleDate)) {
    return res.status(409).json(PAST_DAY_LOCKED_RESPONSE);
  }
  const authContext = await getOrBuildAuthContext(req as Request & { user: AuthUser });
  const branchId = authContext.actingBranchId ?? (req as any).scope?.branchId ?? null;
  if (!branchId) {
    return res.status(400).json({ error: 'يجب تحديد فرع فعال قبل حفظ جدول الفرق' });
  }
  const plan = resolveListAccessScope(authContext, 'routes.assign.view');
  // Wholesale replace is safe ONLY for an all-branches GLOBAL view (saw every
  // team unredacted). A selected branch — GLOBAL or branch-scoped — saw foreign
  // teams as placeholders, so it MUST merge to keep other branches' teams.
  const isGlobal = authContext.isSuperAdmin || plan.scope === 'GLOBAL';
  const privileged = isGlobal && authContext.actingBranchId == null;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockPlanningScheduleMutation(db, scheduleDate);

    const catalog = await loadTeamTypeCatalog(db);
    const storedTeams = (await loadScheduledTeams(db, scheduleDate, { forUpdate: true }))
      .map(team => resolveTeam(team, catalog.get(team.teamType) ?? null));

    const usedKeys = new Set([...storedTeams.map(t => t.key), ...(await loadUsedTeamKeys(db, scheduleDate))]);
    for (const entry of Array.isArray(req.body?.teams) ? req.body.teams : []) {
      if (typeof entry?.key === 'string') usedKeys.add(entry.key);
    }
    let proposed: ScheduledTeam[];
    try {
      proposed = parseScheduleTeams(req.body, () => {
        const key = nextTeamKey(usedKeys);
        usedKeys.add(key);
        return key;
      });
    } catch (err) {
      await db.query('ROLLBACK');
      if (err instanceof SchedulePayloadError) return res.status(400).json({ error: err.message });
      throw err;
    }

    // Branch-isolation merge (GAP-DS-005): foreign teams always come from the
    // stored row; a payload that writes under a foreign key is rejected.
    let merged: ScheduledTeam[] = proposed;
    if (!privileged) {
      const { isVisible } = await resolveTeamVisibility(authContext, storedTeams);
      const visibleKeys = new Set(storedTeams.filter(isVisible).map(t => t.key));
      const merge = mergeScheduledTeams(proposed, storedTeams, team => visibleKeys.has(team.key));
      if (merge.conflictKey) {
        await db.query('ROLLBACK');
        return res.status(409).json({
          error: 'تعذّر الحفظ: الفريق يخص فرعاً آخر. أعد تحميل الصفحة ثم احفظ من جديد.',
          code: 'SCHEDULE_SLOT_OWNED_BY_OTHER_BRANCH',
          teamKey: merge.conflictKey,
        });
      }
      merged = merge.merged;
    }

    // Only the editor's own teams are validated; foreign teams are restored verbatim.
    const employeeIds = [...new Set(proposed.flatMap(t => Object.values(t.members).flat()))];
    const validation = validateScheduledTeams({
      teams: proposed,
      catalog,
      branchTeamTypes: await loadBranchTeamTypeKeys(db, Number(branchId)),
      storedTypeByKey: new Map(storedTeams.map(t => [t.key, t.teamType])),
      employees: await loadScheduleEmployees(employeeIds),
      branchId: Number(branchId),
    });
    if ('error' in validation) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: validation.error });
    }

    // A team bound to a work scope, an assignment or an exclusion for the day
    // keeps its identity (type + members). The shared date lock makes this
    // check atomic with sync, curation, reconciliation, and list generation.
    const { rows: frozenRows } = await db.query(
      `SELECT DISTINCT team_key AS "teamKey", team_snapshot AS "teamSnapshot"
         FROM planning_task_exclusions
        WHERE planning_date = $1::date
          AND exclusion_scope = 'team'
          AND revoked_at IS NULL
       UNION ALL
       SELECT DISTINCT team_key AS "teamKey", NULL::jsonb AS "teamSnapshot"
         FROM work_scopes
        WHERE date = $1::date
       UNION ALL
       SELECT DISTINCT assigned_team_key AS "teamKey", NULL::jsonb AS "teamSnapshot"
         FROM open_tasks
        WHERE assigned_for_date = $1::date
          AND assigned_team_key IS NOT NULL
          AND status IN (
            'assigned', 'in_scheduling', 'scheduled', 'waiting_execution',
            'in_execution', 'ended'
          )`,
      [scheduleDate],
    );
    const storedByKey = new Map(storedTeams.map(t => [t.key, t]));
    const mergedByKey = new Map(merged.map(t => [t.key, t]));
    const checkedKeys = new Set<string>();
    for (const row of frozenRows) {
      const teamKey = String(row.teamKey ?? '');
      if (!teamKey || checkedKeys.has(teamKey)) continue;
      checkedKeys.add(teamKey);
      const before = teamIdentity(row.teamSnapshot ?? storedByKey.get(teamKey), teamKey);
      const after = teamIdentity(mergedByKey.get(teamKey), teamKey);
      if (before !== after) {
        await db.query('ROLLBACK');
        return res.status(409).json({
          error: 'تعذّر الحفظ: هوية الفريق مرتبطة بنطاق عمل أو إسناد أو قرار استبعاد لهذا اليوم.',
          code: 'TEAM_SLOT_FROZEN',
          teamKey,
        });
      }
    }

    const { rows: generatedTeamRows } = await db.query(
      'SELECT DISTINCT team_key FROM telemarketing_task_lists WHERE date = $1',
      [scheduleDate],
    );
    for (const gr of generatedTeamRows) {
      const key = String(gr.team_key);
      if (storedByKey.has(key) && !mergedByKey.has(key)) {
        await db.query('ROLLBACK');
        return res.status(409).json({
          error: 'تعذّر الحفظ: لا يمكن حذف الفريق بعد توليد جهات اتصاله لهذا اليوم.',
          code: 'TEAM_FROZEN_AFTER_GENERATION',
          teamKey: key,
        });
      }
    }

    const stored = serializeScheduledTeams(merged);
    await db.query(
      `INSERT INTO day_schedules (date, teams, solos) VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET teams = $2, solos = $3`,
      [scheduleDate, JSON.stringify(stored.teams), JSON.stringify(stored.solos)],
    );
    await db.query('COMMIT');
    // Re-scope the response so the saver doesn't receive other branches' identities back.
    const saved = merged.map(team => resolveTeam(team, catalog.get(team.teamType) ?? null));
    return res.json(await scopeScheduleForViewer(authContext, scheduleDate, saved));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
});

export default router;
