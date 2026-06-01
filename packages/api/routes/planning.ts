import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningMarketingTargets } from '../services/planningMarketingTargets.js';
import { syncAssignedTasks } from '../services/assignedTasks.js';

const router = Router();

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

    if (mode === 'planning') {
      await syncAssignedTasks({
        date,
        teamKey,
        branchId,
        performedBy: req.authContext?.userId ?? null,
      });
    }

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
         c.candidate_status   AS "candidateStatus",
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
    const { rows: apptRows } = await pool.query(
      `SELECT
         ta.entity_id   AS "clientId",
         ta.id          AS "appointmentId",
         ta.date        AS "appointmentDate",
         ta.time_slot   AS "appointmentTime"
       FROM telemarketing_appointments ta
       WHERE ta.team_key  = $1
         AND ta.date      = $2
         AND ta.branch_id = $3
         AND ta.entity_id = ANY($4::int[])
         AND ta.entity_type = 'client'
       ORDER BY ta.created_at DESC`,
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
              AND (ot.excluded_for_date IS NULL OR ot.excluded_for_date <> $2::date)

           UNION

           SELECT ot.client_id
             FROM open_tasks ot
            WHERE ot.excluded_for_date = $2::date
              AND ot.branch_id = $3
              AND ot.status IN ('open', 'needs_follow_up', 'assigned')
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
        generatedCount: 0,
        pendingSyncCount: 0,
        clients: [],
        summary: { assigned: 0, queued: 0, contacted: 0, booked: 0, closed: 0, excluded: 0 },
      });
    }

    const { rows: clientRows } = await pool.query(
      `SELECT
         c.id,
         c.name,
         c.mobile,
         c.contacts,
         c.candidate_status AS "candidateStatus",
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
       WHERE c.id = ANY($1::int[])`,
      [clientIds],
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

    const { rows: apptRows } = await pool.query(
      `SELECT
         ta.entity_id AS "clientId",
         ta.id AS "appointmentId",
         ta.date AS "appointmentDate",
         ta.time_slot AS "appointmentTime"
       FROM telemarketing_appointments ta
       WHERE ta.team_key = $1
         AND ta.date = $2
         AND ta.branch_id = $3
         AND ta.entity_id = ANY($4::int[])
         AND ta.entity_type = 'client'
       ORDER BY ta.created_at DESC`,
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

      let workspaceStatus: 'assigned' | 'queued' | 'contacted' | 'booked' | 'closed' | 'excluded' = 'assigned';
      if (generatedInTaskList) {
        if (appt?.appointmentDate || meta?.contactTargetStatus === 'booked') workspaceStatus = 'booked';
        else if (meta?.contactTargetStatus === 'closed') workspaceStatus = 'closed';
        else if (meta?.contactTargetStatus === 'contacted') workspaceStatus = 'contacted';
        else workspaceStatus = 'queued';
      } else if (excludedOnly) {
        workspaceStatus = 'excluded';
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
        latestCallOutcome: listItem?.callOutcome ?? meta?.contactTargetOutcome ?? null,
        appointmentDate: appt?.appointmentDate ?? null,
        appointmentTime: appt?.appointmentTime ?? null,
        attemptCount: tasks.reduce((sum: number, task: any) => sum + (Number(task.attemptCount) || 0), 0),
      };
    });

    const STATUS_ORDER: Record<string, number> = {
      assigned: 1,
      excluded: 2,
      queued: 3,
      contacted: 4,
      booked: 5,
      closed: 6,
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

    const generatedCount = clients.filter(client => client.generatedInTaskList).length;
    const pendingSyncCount = clients.filter(client => client.hasPendingSync).length;
    const summary = {
      assigned: clients.filter(client => client.workspaceStatus === 'assigned').length,
      queued: clients.filter(client => client.workspaceStatus === 'queued').length,
      contacted: clients.filter(client => client.workspaceStatus === 'contacted').length,
      booked: clients.filter(client => client.workspaceStatus === 'booked').length,
      closed: clients.filter(client => client.workspaceStatus === 'closed').length,
      excluded: clients.filter(client => client.workspaceStatus === 'excluded').length,
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
