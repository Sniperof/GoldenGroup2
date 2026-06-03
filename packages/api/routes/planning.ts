import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningMarketingTargets } from '../services/planningMarketingTargets.js';
import { syncAssignedTasks } from '../services/assignedTasks.js';
import { buildClientLifecycleStatusSql } from '../services/customerOwnership.js';

const router = Router();

type ContactTargetWorkspaceStatus = 'assigned' | 'queued' | 'contacted' | 'closed';

async function reconcileContactTargetWorkspace(
  date: string,
  teamKey: string,
  branchId: number,
  userId: number | null,
) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const { rows: taskRows } = await db.query(
      `SELECT
         ot.id AS "taskId",
         ot.client_id AS "clientId",
         ot.status,
         ot.excluded_for_date::text AS "excludedForDate",
         c.neighborhood AS "zoneId",
         ct.id AS "contactTargetId",
         ct.status AS "contactTargetStatus",
         ct.closing_reason AS "closingReason"
       FROM open_tasks ot
       JOIN clients c ON c.id = ot.client_id AND c.branch_id = ot.branch_id
       LEFT JOIN LATERAL (
         SELECT id, status, closing_reason
           FROM contact_targets
          WHERE branch_id = ot.branch_id
            AND target_type = 'client'
            AND target_id = ot.client_id
            AND visit_type = 'marketing'
            AND date = $2::date
            AND team_key = $1
          ORDER BY id DESC
          LIMIT 1
       ) ct ON true
       WHERE ot.branch_id = $3
         AND ot.client_id IS NOT NULL
         AND (
           (
             ot.assigned_team_key = $1
             AND ot.status = 'assigned'
             AND ot.assigned_for_date = $2::date
             AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $2::date)
           )
           OR (
             ot.excluded_for_date = $2::date
             AND ot.status IN ('open', 'needs_follow_up', 'assigned')
           )
         )
       ORDER BY ot.client_id, ot.id`,
      [teamKey, date, branchId],
    );

    const tasksByClient = new Map<number, any[]>();
    for (const row of taskRows) {
      const clientId = Number(row.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0) continue;
      if (!tasksByClient.has(clientId)) tasksByClient.set(clientId, []);
      tasksByClient.get(clientId)!.push(row);
    }

    for (const [clientId, clientTasks] of tasksByClient) {
      const first = clientTasks[0];
      let contactTargetId = Number(first.contactTargetId);

      if (!Number.isInteger(contactTargetId) || contactTargetId <= 0) {
        const { rows } = await db.query(
          `INSERT INTO contact_targets (
             branch_id, target_type, target_id, target_stage, visit_type,
             source_type, source_id, supervisor_hr_user_id, zone_id, status,
             date, team_key
           )
           VALUES ($1, 'client', $2, 'lead', 'marketing', 'lead', $2, NULL, $3, 'new', $4::date, $5)
           RETURNING id`,
          [branchId, clientId, first.zoneId ?? null, date, teamKey],
        );
        contactTargetId = Number(rows[0]?.id);
      }

      if (!Number.isInteger(contactTargetId) || contactTargetId <= 0) continue;

      const activeTasks = clientTasks.filter(task =>
        task.status === 'assigned' && task.excludedForDate !== date,
      );
      const allTasksExcluded = clientTasks.length > 0 && activeTasks.length === 0;

      for (const task of clientTasks) {
        const taskId = Number(task.taskId);
        if (!Number.isInteger(taskId) || taskId <= 0) continue;
        const linkStatus = task.excludedForDate === date
          ? 'excluded'
          : allTasksExcluded
            ? 'closed'
            : 'ready';

        await db.query(
          `INSERT INTO contact_target_open_tasks (
             contact_target_id, open_task_id, branch_id, team_key, date, link_status
           )
           VALUES ($1, $2, $3, $4, $5::date, $6)
           ON CONFLICT (contact_target_id, open_task_id, date)
           DO UPDATE SET
             branch_id = EXCLUDED.branch_id,
             team_key = EXCLUDED.team_key,
             link_status = EXCLUDED.link_status,
             updated_at = NOW()`,
          [contactTargetId, taskId, branchId, teamKey, date, linkStatus],
        );

        await db.query(
          `UPDATE open_tasks
              SET contact_target_id = $1,
                  updated_at = NOW()
            WHERE id = $2
              AND branch_id = $3`,
          [contactTargetId, taskId, branchId],
        );
      }

      if (allTasksExcluded) {
        await db.query(
          `UPDATE contact_targets
              SET status = 'closed',
                  closing_reason = 'manual_supervisor',
                  closed_by = COALESCE(closed_by, $2::int),
                  closed_at = COALESCE(closed_at, NOW()),
                  updated_at = NOW()
            WHERE id = $1
              AND branch_id = $3
              AND status IN ('new', 'queued', 'in_call_list', 'contacted')`,
          [contactTargetId, userId, branchId],
        );
      } else {
        await db.query(
          `UPDATE contact_targets
              SET status = 'new',
                  closing_reason = NULL,
                  closed_by = NULL,
                  closed_at = NULL,
                  updated_at = NOW()
            WHERE id = $1
              AND branch_id = $2
              AND status = 'closed'
              AND closing_reason = 'manual_supervisor'`,
          [contactTargetId, branchId],
        );
      }
    }

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

/**
 * @swagger
 * components:
 *   schemas:
 *     PlanningMarketingTarget:
 *       type: object
 *       properties:
 *         clientId:
 *           type: integer
 *         clientName:
 *           type: string
 *         phone:
 *           type: string
 *         zoneId:
 *           type: integer
 *         zoneName:
 *           type: string
 *         status:
 *           type: string
 *         tasks:
 *           type: array
 *           items:
 *             type: object
 *     AssignedTaskClient:
 *       type: object
 *       properties:
 *         clientId:
 *           type: integer
 *         clientName:
 *           type: string
 *         primaryPhone:
 *           type: string
 *         candidateStatus:
 *           type: string
 *         stationName:
 *           type: string
 *         tasks:
 *           type: array
 *           items:
 *             type: object
 *         assignedCount:
 *           type: integer
 *         excludedCount:
 *           type: integer
 *         taskPhase:
 *           type: string
 *         contactTargetStatus:
 *           type: string
 *         taskListItemStatus:
 *           type: string
 *         latestCallOutcome:
 *           type: string
 *         appointmentDate:
 *           type: string
 *         appointmentTime:
 *           type: string
 *         attemptCount:
 *           type: integer
 */

/**
 * @swagger
 * /api/planning/marketing-targets:
 *   get:
 *     tags: [Planning]
 *     summary: Get planning marketing targets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         required: true
 *         description: Date in YYYY-MM-DD format
 *       - in: query
 *         name: teamKey
 *         schema:
 *           type: string
 *         required: true
 *         description: Team key (team_X or solo_X)
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [assigned, planning]
 *         required: false
 *         description: Mode
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PlanningMarketingTarget'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/marketing-targets', requirePermission('planning.manage'), async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const teamKey = typeof req.query.teamKey === 'string' ? req.query.teamKey : '';
    const branchId = req.authContext?.actingBranchId ?? null;
    const mode = req.query.mode === 'assigned' ? 'assigned' : 'planning';

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    if (!/^(team|solo)_\d+$/.test(teamKey)) {
      return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
    }

    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

    const result = await getPlanningMarketingTargets({ date, teamKey, branchId, mode });

    return res.json(result);
  } catch (err: any) {
    console.error('Failed to calculate planning marketing targets:', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate marketing targets' });
  }
});

// GET /api/planning/assigned-tasks?date=...&teamKey=...
// Full-day dashboard: returns ALL clients visible to this team today,
// from initial assignment through closure. Never hides a client once it appears.
//
// Visibility scope (client appears if any of the following):
//   - Has an assigned task for this team today
//   - Has an entry in today's task list for this team (generated)
//   - Was excluded today but was assigned to this team
//
// Per-client columns:
//   clientId, name, primaryPhone, candidateStatus, stationName
//   tasks[]               — all relevant tasks with their statuses
//   assignedCount / excludedCount  — pre-generation counts
//   taskPhase             — most-advanced task phase (assigned→in_scheduling→scheduled→completed)
//   contactTargetStatus   — contact_targets.status
//   taskListItemStatus    — task_list_items.status for today's list
//   latestCallOutcome     — most recent outcome from call logs / task_list_item
//   appointmentDate/Time  — if appointment exists for this team today
//   attemptCount          — how many times telemarketer tried today
/**
 * @swagger
 * /api/planning/assigned-tasks:
 *   get:
 *     tags: [Planning]
 *     summary: Retrieve assigned tasks for a team and date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: true
 *         description: Branch context ID
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         required: true
 *         description: Date in YYYY-MM-DD format
 *       - in: query
 *         name: teamKey
 *         schema:
 *           type: string
 *         required: true
 *         description: Team key (team_X or solo_X)
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *         description: Filter by branch ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Search term
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 teamKey:
 *                   type: string
 *                 date:
 *                   type: string
 *                 taskListGenerated:
 *                   type: boolean
 *                 taskListGeneratedAt:
 *                   type: string
 *                   nullable: true
 *                 newEligibleCount:
 *                   type: integer
 *                 clients:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AssignedTaskClient'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     assigned:
 *                       type: integer
 *                     inList:
 *                       type: integer
 *                     booked:
 *                       type: integer
 *                     completed:
 *                       type: integer
 *                     closed:
 *                       type: integer
 *                     excluded:
 *                       type: integer
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
router.get('/assigned-tasks', requirePermission('planning.manage'), async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const teamKey = typeof req.query.teamKey === 'string' ? req.query.teamKey : '';
    const branchId = req.authContext?.actingBranchId ?? null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^(team|solo)_\d+$/.test(teamKey)) {
      return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
    }
    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

    // ── Step 1: determine whether a task list has been generated ────────────
    // Two modes:
    //   PRE-GENERATION  (no task list) → show all assigned contacts (mutable preview)
    //   POST-GENERATION (task list exists) → show ONLY what was generated + excluded
    //     New assignments after generation are invisible until a new generation is triggered.
    const { rows: taskListRows } = await pool.query(
      `SELECT id, created_at AS "createdAt" FROM telemarketing_task_lists
        WHERE team_key = $1 AND date = $2 AND branch_id = $3
        LIMIT 1`,
      [teamKey, date, branchId],
    );
    const taskListGenerated = taskListRows.length > 0;
    const taskListGeneratedAt = taskListRows[0]?.createdAt ?? null;

    // ── Step 2: collect relevant client IDs ──────────────────────────────────
    const { rows: clientIdRows } = await pool.query(
      `SELECT DISTINCT sub.client_id
       FROM (
         ${taskListGenerated
           ? `-- POST-GENERATION: only clients in the generated list
              SELECT tli.entity_id AS client_id
                FROM telemarketing_task_list_items tli
                JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
               WHERE tl.team_key    = $1
                 AND tl.date        = $2::text
                 AND tl.branch_id   = $3
                 AND tli.entity_type = 'client'`
           : `-- PRE-GENERATION: all assigned tasks for this team (any sync date)
              SELECT ot.client_id
                FROM open_tasks ot
               WHERE ot.assigned_team_key = $1
                 AND ot.branch_id         = $3
                 AND ot.status            = 'assigned'
                 AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $2::date)`}

         UNION

         -- Always: excluded contacts (visible regardless of generation state)
         SELECT ot.client_id
           FROM open_tasks ot
          WHERE ot.excluded_for_date = $2::date
            AND ot.branch_id         = $3
            AND ot.status IN ('open', 'needs_follow_up')
       ) sub`,
      [teamKey, date, branchId],
    );
    const clientIds = clientIdRows.map((r: any) => Number(r.client_id));

    if (clientIds.length === 0) {
      return res.json({
        teamKey,
        date,
        taskListGenerated,
        taskListGeneratedAt,
        newEligibleCount: 0,
        clients: [],
        summary: { assigned: 0, inList: 0, booked: 0, completed: 0, closed: 0, excluded: 0 },
      });
    }

    // ── Step 2: client meta (name, phone, classification, station) ────────
    const { rows: clientRows } = await pool.query(
      `SELECT
         c.id,
         c.name,
         c.mobile,
         c.contacts,
         ${buildClientLifecycleStatusSql('c')} AS "candidateStatus",
         gu.name              AS "stationName",
         ct.id                AS "contactTargetId",
         ct.status            AS "contactTargetStatus",
         ct.latest_call_outcome AS "contactTargetOutcome"
       FROM clients c
       LEFT JOIN geo_units gu
         ON gu.id = c.neighborhood
       LEFT JOIN contact_targets ct
         ON ct.branch_id    = c.branch_id
        AND ct.target_type  = 'client'
        AND ct.target_id    = c.id
        -- DEC-005 D30: target_stage / source_type pinned (or dropped).
        AND ct.visit_type   = 'marketing'
       WHERE c.id = ANY($1::int[])`,
      [clientIds],
    );
    const clientMetaById = new Map(clientRows.map((r: any) => [Number(r.id), r]));

    // ── Step 3: tasks for these clients ───────────────────────────────────
    const { rows: taskRows } = await pool.query(
      `SELECT
         ot.id                                    AS "taskId",
         ot.client_id                             AS "clientId",
         ot.task_type                             AS "taskType",
         ot.task_family                           AS "taskFamily",
         ot.status,
         ot.due_date                              AS "dueDate",
         ot.expected_date                         AS "expectedDate",
         ot.priority,
         ot.excluded_for_date                     AS "excludedForDate",
         ot.excluded_reason                       AS "excludedReason",
         ot.last_waiting_status                   AS "lastWaitingStatus",
         ot.attempt_count                         AS "attemptCount",
         COALESCE(ttc.arabic_label, ot.task_type) AS "taskTypeLabel"
       FROM open_tasks ot
       LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
       WHERE ot.client_id = ANY($1::int[])
         AND ot.branch_id = $2
         AND ot.status IN ('assigned','in_scheduling','scheduled','waiting_execution',
                           'in_execution','ended','completed','closed',
                           'open','needs_follow_up')
       ORDER BY ot.client_id, ot.created_at`,
      [clientIds, branchId],
    );

    // ── Step 4: task_list_items for these clients in today's list ─────────
    const { rows: listItemRows } = await pool.query(
      `SELECT
         tli.entity_id       AS "clientId",
         tli.id              AS "itemId",
         tli.status          AS "itemStatus",
         tli.call_outcome    AS "callOutcome",
         tli.open_task_id    AS "openTaskId"
       FROM telemarketing_task_list_items tli
       JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
       WHERE tl.team_key  = $1
         AND tl.date      = $2
         AND tl.branch_id = $3
         AND tli.entity_type = 'client'
         AND tli.entity_id = ANY($4::int[])`,
      [teamKey, date, branchId, clientIds],
    );
    const listItemByClient = new Map<number, any>();
    listItemRows.forEach((r: any) => listItemByClient.set(Number(r.clientId), r));

    // ── Step 5: appointments for these clients with this team today ────────
    // Source: field_visits (canonical post-Phase-4). team identified via team_snapshot->>'teamKey'.
    const { rows: apptRows } = await pool.query(
      `SELECT
         fv.client_id          AS "clientId",
         fv.id                 AS "appointmentId",
         fv.scheduled_date::text AS "appointmentDate",
         fv.scheduled_time     AS "appointmentTime"
       FROM field_visits fv
       WHERE fv.team_snapshot->>'teamKey' = $1
         AND fv.scheduled_date = $2::date
         AND fv.branch_id      = $3
         AND fv.client_id      = ANY($4::int[])
         AND fv.status         IN ('scheduled','in_progress','ended','completed')
         AND fv.visit_type     = 'marketing'
       ORDER BY fv.created_at DESC`,
      [teamKey, date, branchId, clientIds],
    );
    const apptByClient = new Map<number, any>();
    apptRows.forEach((r: any) => {
      if (!apptByClient.has(Number(r.clientId))) apptByClient.set(Number(r.clientId), r);
    });

    // ── Step 6: group tasks per client ────────────────────────────────────
    const tasksByClient = new Map<number, any[]>();
    taskRows.forEach((r: any) => {
      const id = Number(r.clientId);
      if (!tasksByClient.has(id)) tasksByClient.set(id, []);
      tasksByClient.get(id)!.push(r);
    });

    // ── Step 7: phase priority (higher = more advanced) ───────────────────
    const PHASE_ORDER: Record<string, number> = {
      assigned: 1, open: 1, needs_follow_up: 1,
      in_scheduling: 2,
      scheduled: 3, waiting_execution: 3, in_execution: 3, ended: 3,
      completed: 4,
      closed: 5,
    };

    function primaryPhone(meta: any): string | null {
      const contacts = Array.isArray(meta?.contacts) ? meta.contacts : [];
      const primary = contacts.find((c: any) => c?.isPrimary && c?.number);
      return primary?.number ?? meta?.mobile ?? null;
    }

    // ── Step 8: build client rows ─────────────────────────────────────────
    const clients = clientIds.map(id => {
      const meta = clientMetaById.get(id);
      const tasks = tasksByClient.get(id) ?? [];
      const listItem = listItemByClient.get(id) ?? null;
      const appt = apptByClient.get(id) ?? null;

      const assignedTasks = tasks.filter((t: any) => t.status === 'assigned');
      const excludedTasks = tasks.filter((t: any) => t.excludedForDate === date);

      // Most-advanced task status
      let topPhase = 0;
      let topStatus = 'assigned';
      tasks.forEach((t: any) => {
        const p = PHASE_ORDER[t.status] ?? 0;
        if (p > topPhase) { topPhase = p; topStatus = t.status; }
      });

      return {
        clientId: id,
        clientName: meta?.name ?? '',
        primaryPhone: primaryPhone(meta),
        candidateStatus: meta?.candidateStatus ?? null,
        stationName: meta?.stationName ?? null,
        tasks,
        assignedCount: assignedTasks.length,
        excludedCount: excludedTasks.length,
        // Dashboard columns
        taskPhase: topStatus,
        contactTargetStatus: meta?.contactTargetStatus ?? null,
        taskListItemStatus: listItem?.itemStatus ?? null,
        latestCallOutcome: listItem?.callOutcome ?? meta?.contactTargetOutcome ?? null,
        appointmentDate: appt?.appointmentDate ?? null,
        appointmentTime: appt?.appointmentTime ?? null,
        attemptCount: tasks.reduce((s: number, t: any) => s + (Number(t.attemptCount) || 0), 0),
      };
    });

    // Sort: excluded-only last, rest by phase desc then total tasks desc
    clients.sort((a, b) => {
      const aAllExcluded = a.assignedCount === 0 && a.taskPhase === 'assigned';
      const bAllExcluded = b.assignedCount === 0 && b.taskPhase === 'assigned';
      if (aAllExcluded !== bAllExcluded) return aAllExcluded ? 1 : -1;
      const pa = PHASE_ORDER[a.taskPhase] ?? 0;
      const pb = PHASE_ORDER[b.taskPhase] ?? 0;
      if (pb !== pa) return pb - pa;
      return (b.assignedCount + b.excludedCount) - (a.assignedCount + a.excludedCount);
    });

    let newEligibleCount = 0;
    if (taskListGenerated) {
      const { rows: deltaRows } = await pool.query(
        `SELECT COUNT(DISTINCT ot.client_id)::int AS count
           FROM open_tasks ot
          WHERE ot.assigned_team_key = $1
            AND ot.branch_id = $3
            AND ot.status = 'assigned'
            AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $2::date)
            AND NOT EXISTS (
              SELECT 1
                FROM telemarketing_task_list_items tli
                JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
               WHERE tl.team_key = $1
                 AND tl.date = $2
                 AND tl.branch_id = $3
                 AND tli.entity_type = 'client'
                 AND tli.entity_id = ot.client_id
            )`,
        [teamKey, date, branchId],
      );
      newEligibleCount = Number(deltaRows[0]?.count ?? 0);
    }

    // Summary counters for stats strip
    const summary = {
      assigned:  clients.filter(c => c.taskPhase === 'assigned').length,
      inList:    clients.filter(c => c.taskPhase === 'in_scheduling').length,
      booked:    clients.filter(c => ['scheduled','waiting_execution','in_execution','ended'].includes(c.taskPhase)).length,
      completed: clients.filter(c => c.taskPhase === 'completed').length,
      closed:    clients.filter(c => c.taskPhase === 'closed').length,
      excluded:  clients.filter(c => c.assignedCount === 0 && c.excludedCount > 0).length,
    };

    return res.json({ teamKey, date, taskListGenerated, taskListGeneratedAt, newEligibleCount, clients, summary });
  } catch (err: any) {
    console.error('Failed to load assigned tasks:', err);
    return res.status(500).json({ error: err.message || 'Failed to load assigned tasks' });
  }
});

/**
 * /api/planning/contact-targets-dashboard:
 * Daily planning workspace with dual layers:
 *   - Generated snapshot (contact_targets + today's task list for this team)
 *   - Live delta after generation (currently assigned / excluded tasks not yet in snapshot)
 *
 * PRE-GENERATION:
 *   Shows the live eligibility set from open_tasks.
 *
 * POST-GENERATION:
 *   Keeps the generated snapshot as the primary status source, but also returns
 *   live pending tasks so the UI can surface "new since last generation" and
 *   "generated row with extra live work" without pretending they are already in
 *   the call list.
 */
router.post('/contact-targets-dashboard/sync', requirePermission('planning.manage'), async (req, res) => {
  try {
    const date = typeof req.body?.date === 'string' ? req.body.date : '';
    const teamKey = typeof req.body?.teamKey === 'string' ? req.body.teamKey : '';
    const branchId = req.authContext?.actingBranchId ?? null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^(team|solo)_\d+$/.test(teamKey)) {
      return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
    }
    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

    const sync = await syncAssignedTasks({
      date,
      teamKey,
      branchId,
      performedBy: req.authContext?.userId ?? null,
    });

    await reconcileContactTargetWorkspace(date, teamKey, branchId, req.authContext?.userId ?? null);

    return res.json({
      date,
      teamKey,
      counts: {
        planned: sync.plannedTaskIds.length,
        eligible: sync.eligibleTaskIds.length,
        newlyAssigned: sync.newlyAssignedIds.length,
        released: sync.releasedIds.length,
      },
      taskIds: {
        newlyAssigned: sync.newlyAssignedIds,
        released: sync.releasedIds,
      },
    });
  } catch (err: any) {
    console.error('Failed to sync contact targets dashboard:', err);
    return res.status(500).json({ error: err.message || 'Failed to sync contact targets dashboard' });
  }
});

router.get('/contact-targets-dashboard', requirePermission('planning.manage'), async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const teamKey = typeof req.query.teamKey === 'string' ? req.query.teamKey : '';
    const branchId = req.authContext?.actingBranchId ?? null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (!/^(team|solo)_\d+$/.test(teamKey)) {
      return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
    }
    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

    const { rows: taskListRows } = await pool.query(
      `SELECT id, created_at AS "createdAt" FROM telemarketing_task_lists
        WHERE team_key = $1 AND date = $2 AND branch_id = $3
        LIMIT 1`,
      [teamKey, date, branchId],
    );
    const taskListGenerated = taskListRows.length > 0;
    const taskListGeneratedAt = taskListRows[0]?.createdAt ?? null;

    const { rows: clientIdRows } = await pool.query(
      `SELECT DISTINCT sub.client_id
         FROM (
           SELECT tli.entity_id AS client_id
             FROM telemarketing_task_list_items tli
             JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
            WHERE tl.team_key = $1
              AND tl.date = $2
              AND tl.branch_id = $3
              AND tli.entity_type = 'client'

           UNION

           SELECT ot.client_id
             FROM open_tasks ot
           WHERE ot.assigned_team_key = $1
             AND ot.branch_id = $3
             AND ot.status = 'assigned'
             AND ot.assigned_for_date = $4::date
             AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $4::date)

           UNION

           SELECT ot.client_id
             FROM open_tasks ot
           WHERE ot.excluded_for_date = $4::date
              AND ot.branch_id = $3
              AND ot.status IN ('open', 'needs_follow_up', 'assigned')

           UNION

           SELECT ct.target_id AS client_id
             FROM contact_targets ct
            WHERE ct.branch_id = $3
              AND ct.target_type = 'client'
              AND ct.visit_type = 'marketing'
              AND ct.date = $4::date
              AND ct.team_key = $1

           UNION

           SELECT ot.client_id
             FROM contact_target_open_tasks ctot
             JOIN open_tasks ot ON ot.id = ctot.open_task_id
            WHERE ctot.branch_id = $3
              AND ctot.team_key = $1
              AND ctot.date = $4::date
       ) sub`,
      [teamKey, date, branchId, date],
    );
    const clientIds = clientIdRows.map((r: any) => Number(r.client_id));

    if (clientIds.length === 0) {
      return res.json({
        teamKey,
        date,
        taskListGenerated,
        taskListGeneratedAt,
        newEligibleCount: 0,
        generatedCount: 0,
        pendingSyncCount: 0,
        clients: [],
        summary: { assigned: 0, queued: 0, contacted: 0, closed: 0 },
      });
    }

    const { rows: clientRows } = await pool.query(
      `SELECT
         c.id,
         c.name,
         c.mobile,
         c.contacts,
         ${buildClientLifecycleStatusSql('c')} AS "candidateStatus",
         gu.name AS "stationName",
         ct.id AS "contactTargetId",
         ct.status AS "contactTargetStatus",
         ct.latest_call_outcome AS "contactTargetOutcome"
       FROM clients c
       LEFT JOIN geo_units gu
         ON gu.id = c.neighborhood
       LEFT JOIN contact_targets ct
         ON ct.branch_id = c.branch_id
        AND ct.target_type = 'client'
        AND ct.target_id = c.id
        AND ct.visit_type = 'marketing'
        AND ct.date = $2::date
        AND ct.team_key = $3
       WHERE c.id = ANY($1::int[])`,
      [clientIds, date, teamKey],
    );
    const clientMetaById = new Map(clientRows.map((r: any) => [Number(r.id), r]));

    const { rows: taskRows } = await pool.query(
      `SELECT
         ot.id                                    AS "taskId",
         ot.client_id                             AS "clientId",
         ot.task_type                             AS "taskType",
         ot.task_family                           AS "taskFamily",
         ot.status,
         ot.due_date                              AS "dueDate",
         ot.expected_date                         AS "expectedDate",
         ot.priority,
         ot.excluded_for_date                     AS "excludedForDate",
         ot.excluded_reason                       AS "excludedReason",
         ot.last_waiting_status                   AS "lastWaitingStatus",
         ot.attempt_count                         AS "attemptCount",
         ctot.link_status                         AS "contactTargetTaskStatus",
         COALESCE(ttc.arabic_label, ot.task_type) AS "taskTypeLabel"
       FROM open_tasks ot
       LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
       LEFT JOIN contact_target_open_tasks ctot
         ON ctot.open_task_id = ot.id
        AND ctot.branch_id = ot.branch_id
        AND ctot.team_key = $3
        AND ctot.date = $4::date
       WHERE ot.client_id = ANY($1::int[])
         AND ot.branch_id = $2
         AND ot.status IN ('assigned','in_scheduling','scheduled','waiting_execution',
                           'in_execution','ended','completed','closed',
                           'open','needs_follow_up')
       ORDER BY ot.client_id, ot.created_at`,
      [clientIds, branchId, teamKey, date],
    );

    const { rows: listItemRows } = await pool.query(
      `SELECT
         tli.entity_id AS "clientId",
         tli.id AS "itemId",
         tli.status AS "itemStatus",
         tli.call_outcome AS "callOutcome",
         tli.open_task_id AS "openTaskId",
         tli.contact_target_id AS "contactTargetId"
       FROM telemarketing_task_list_items tli
       JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
       WHERE tl.team_key = $1
         AND tl.date = $2
         AND tl.branch_id = $3
         AND tli.entity_type = 'client'
         AND tli.entity_id = ANY($4::int[])`,
      [teamKey, date, branchId, clientIds],
    );
    const listItemByClient = new Map<number, any>();
    listItemRows.forEach((r: any) => listItemByClient.set(Number(r.clientId), r));

    // Source: field_visits (canonical post-Phase-4). team identified via team_snapshot->>'teamKey'.
    const { rows: apptRows } = await pool.query(
      `SELECT
         fv.client_id            AS "clientId",
         fv.id                   AS "appointmentId",
         fv.scheduled_date::text AS "appointmentDate",
         fv.scheduled_time       AS "appointmentTime"
       FROM field_visits fv
       WHERE fv.team_snapshot->>'teamKey' = $1
         AND fv.scheduled_date = $2::date
         AND fv.branch_id      = $3
         AND fv.client_id      = ANY($4::int[])
         AND fv.status         IN ('scheduled','in_progress','ended','completed')
         AND fv.visit_type     = 'marketing'
       ORDER BY fv.created_at DESC`,
      [teamKey, date, branchId, clientIds],
    );
    const apptByClient = new Map<number, any>();
    apptRows.forEach((r: any) => {
      if (!apptByClient.has(Number(r.clientId))) apptByClient.set(Number(r.clientId), r);
    });

    const tasksByClient = new Map<number, any[]>();
    taskRows.forEach((r: any) => {
      const id = Number(r.clientId);
      if (!tasksByClient.has(id)) tasksByClient.set(id, []);
      tasksByClient.get(id)!.push(r);
    });

    function primaryPhone(meta: any): string | null {
      const contacts = Array.isArray(meta?.contacts) ? meta.contacts : [];
      const primary = contacts.find((c: any) => c?.isPrimary && c?.number);
      return primary?.number ?? meta?.mobile ?? null;
    }

    const clients = clientIds.map(id => {
      const meta = clientMetaById.get(id);
      const tasks = tasksByClient.get(id) ?? [];
      const listItem = listItemByClient.get(id) ?? null;
      const appt = apptByClient.get(id) ?? null;

      const assignedTasks = tasks.filter((t: any) => t.status === 'assigned');
      const excludedTasks = tasks.filter((t: any) => t.excludedForDate === date);
      const generatedInTaskList = Boolean(listItem);
      const hasPendingSync = taskListGenerated && assignedTasks.length > 0;
      const excludedOnly = !generatedInTaskList && assignedTasks.length === 0 && excludedTasks.length > 0;

      let workspaceStatus: ContactTargetWorkspaceStatus = 'assigned';
      if (meta?.contactTargetStatus === 'closed' || excludedOnly) {
        workspaceStatus = 'closed';
      } else if (meta?.contactTargetStatus === 'contacted') {
        workspaceStatus = 'contacted';
      } else if (generatedInTaskList || meta?.contactTargetStatus === 'queued' || meta?.contactTargetStatus === 'in_call_list' || appt?.appointmentDate) {
        workspaceStatus = 'queued';
      }

      return {
        clientId: id,
        clientName: meta?.name ?? '',
        primaryPhone: primaryPhone(meta),
        candidateStatus: meta?.candidateStatus ?? null,
        stationName: meta?.stationName ?? null,
        tasks,
        assignedCount: assignedTasks.length,
        excludedCount: excludedTasks.length,
        generatedInTaskList,
        hasPendingSync,
        workspaceStatus,
        contactTargetId: meta?.contactTargetId ?? listItem?.contactTargetId ?? null,
        contactTargetStatus: meta?.contactTargetStatus ?? null,
        taskListItemStatus: listItem?.itemStatus ?? null,
        taskListOpenTaskId: listItem?.openTaskId ?? null,
        latestCallOutcome: listItem?.callOutcome ?? meta?.contactTargetOutcome ?? null,
        appointmentDate: appt?.appointmentDate ?? null,
        appointmentTime: appt?.appointmentTime ?? null,
        attemptCount: tasks.reduce((sum: number, task: any) => sum + (Number(task.attemptCount) || 0), 0),
      };
    });

    const STATUS_ORDER: Record<string, number> = {
      assigned: 1,
      queued: 2,
      contacted: 3,
      closed: 4,
    };

    clients.sort((a, b) => {
      if (a.generatedInTaskList !== b.generatedInTaskList) return a.generatedInTaskList ? -1 : 1;
      if (a.hasPendingSync !== b.hasPendingSync) return a.hasPendingSync ? -1 : 1;
      const pa = STATUS_ORDER[a.workspaceStatus] ?? 0;
      const pb = STATUS_ORDER[b.workspaceStatus] ?? 0;
      if (pa !== pb) return pa - pb;
      return (b.assignedCount + b.excludedCount) - (a.assignedCount + a.excludedCount);
    });

    let newEligibleCount = 0;
    if (taskListGenerated) {
      const { rows: deltaRows } = await pool.query(
        `SELECT COUNT(DISTINCT ot.client_id)::int AS count
           FROM open_tasks ot
          WHERE ot.assigned_team_key = $1
            AND ot.branch_id = $3
            AND ot.status = 'assigned'
            AND ot.assigned_for_date = $4::date
            AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $4::date)
            AND NOT EXISTS (
              SELECT 1
                FROM telemarketing_task_list_items tli
                JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
               WHERE tl.team_key = $1
                 AND tl.date = $2
                 AND tl.branch_id = $3
                 AND tli.entity_type = 'client'
                 AND tli.entity_id = ot.client_id
            )`,
        [teamKey, date, branchId, date],
      );
      newEligibleCount = Number(deltaRows[0]?.count ?? 0);
    }

    const generatedCount = clients.filter(client => client.generatedInTaskList).length;
    const pendingSyncCount = clients.filter(client => client.hasPendingSync).length;
    const summary = {
      assigned: clients.filter(client => client.workspaceStatus === 'assigned').length,
      queued: clients.filter(client => client.workspaceStatus === 'queued').length,
      contacted: clients.filter(client => client.workspaceStatus === 'contacted').length,
      closed: clients.filter(client => client.workspaceStatus === 'closed').length,
    };

    return res.json({
      teamKey,
      date,
      taskListGenerated,
      taskListGeneratedAt,
      newEligibleCount,
      generatedCount,
      pendingSyncCount,
      clients,
      summary,
    });
  } catch (err: any) {
    console.error('Failed to load contact targets dashboard:', err);
    return res.status(500).json({ error: err.message || 'Failed to load contact targets dashboard' });
  }
});

export default router;
