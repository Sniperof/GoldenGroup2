import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningMarketingTargets } from '../services/planningMarketingTargets.js';
import { syncAssignedTasks } from '../services/assignedTasks.js';

const router = Router();

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

    // ── Step 1: collect all relevant client IDs for this team/date ─────────
    // NOTE: explicit type casts are required because telemarketing_task_lists.date
    // is character varying while open_tasks.assigned_for_date / excluded_for_date
    // are DATE — PostgreSQL cannot resolve the type of $2 in a UNION without casts.
    const { rows: clientIdRows } = await pool.query(
      `SELECT DISTINCT sub.client_id
       FROM (
         -- Has assigned task for this team today
         SELECT ot.client_id
           FROM open_tasks ot
          WHERE ot.assigned_team_key = $1
            AND ot.assigned_for_date = $2::date
            AND ot.branch_id         = $3
            AND ot.status            = 'assigned'

         UNION

         -- Was excluded today and belongs to this branch
         SELECT ot.client_id
           FROM open_tasks ot
          WHERE ot.excluded_for_date = $2::date
            AND ot.branch_id         = $3
            AND ot.status IN ('open', 'needs_follow_up')

         UNION

         -- Has entry in today's task list for this team (generated)
         SELECT tli.entity_id AS client_id
           FROM telemarketing_task_list_items tli
           JOIN telemarketing_task_lists tl ON tl.id = tli.task_list_id
          WHERE tl.team_key    = $1
            AND tl.date        = $2::text
            AND tl.branch_id   = $3
            AND tli.entity_type = 'client'
       ) sub`,
      [teamKey, date, branchId],
    );
    const clientIds = clientIdRows.map((r: any) => Number(r.client_id));

    if (clientIds.length === 0) {
      return res.json({ teamKey, date, clients: [], summary: { assigned: 0, inList: 0, booked: 0, closed: 0, excluded: 0 } });
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
         ON gu.id = NULLIF(c.neighborhood, '')::int
       LEFT JOIN contact_targets ct
         ON ct.branch_id    = c.branch_id
        AND ct.target_type  = 'client'
        AND ct.target_id    = c.id
        AND ct.target_stage = 'lead'
        AND ct.visit_type   = 'marketing'
        AND ct.source_type  = 'lead'
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
      completed: 4, closed: 4,
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

    // Summary counters for stats strip
    const summary = {
      assigned:  clients.filter(c => c.taskPhase === 'assigned').length,
      inList:    clients.filter(c => c.taskPhase === 'in_scheduling').length,
      booked:    clients.filter(c => ['scheduled','waiting_execution','in_execution','ended'].includes(c.taskPhase)).length,
      closed:    clients.filter(c => ['completed','closed'].includes(c.taskPhase)).length,
      excluded:  clients.filter(c => c.assignedCount === 0 && c.excludedCount > 0).length,
    };

    return res.json({ teamKey, date, clients, summary });
  } catch (err: any) {
    console.error('Failed to load assigned tasks:', err);
    return res.status(500).json({ error: err.message || 'Failed to load assigned tasks' });
  }
});

export default router;
