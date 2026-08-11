import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import {
  closePlanningDayCycle,
  previewPlanningDayCycleClose,
} from './planningDayCycle.js';

test('live planning cycle close is complete, idempotent and cleans its isolated fixture', async (t) => {
  const date = '2099-12-30';
  const teamKey = 'solo_999999';
  const listId = `cycle-integration-${Date.now()}`;
  let taskId: number | null = null;
  let targetId: number | null = null;

  const { rows: subjectRows } = await pool.query(
    `SELECT c.id AS "clientId", c.branch_id AS "branchId"
     FROM clients c
     WHERE c.branch_id IS NOT NULL
     ORDER BY c.id
     LIMIT 1`,
  );
  if (!subjectRows[0]) {
    t.skip('No branch-owned client is available for an isolated live fixture');
    return;
  }
  const branchId = Number(subjectRows[0].branchId);
  const clientId = Number(subjectRows[0].clientId);

  try {
    const task = await pool.query(
      `INSERT INTO open_tasks (
         client_id, branch_id, task_type, task_family, reason, status, source,
         last_waiting_status, assigned_team_key, assigned_for_date, assigned_at
       ) VALUES ($1, $2, 'device_demo', 'marketing', 'new_lead', 'assigned',
         'system', 'open', $3, $4::date, now())
       RETURNING id`,
      [clientId, branchId, teamKey, date],
    );
    taskId = Number(task.rows[0].id);

    const target = await pool.query(
      `INSERT INTO contact_targets (
         branch_id, target_type, target_id, target_stage, visit_type,
         source_type, source_id, status, date, team_key
       ) VALUES ($1, 'client', $2, 'lead', 'marketing', 'lead', $3, 'new', $4::date, $5)
       RETURNING id`,
      [branchId, clientId, taskId, date, teamKey],
    );
    targetId = Number(target.rows[0].id);

    await pool.query(
      `INSERT INTO contact_target_open_tasks (
         contact_target_id, open_task_id, branch_id, team_key, date, link_status
       ) VALUES ($1, $2, $3, $4, $5::date, 'ready')`,
      [targetId, taskId, branchId, teamKey, date],
    );
    await pool.query(
      `INSERT INTO telemarketing_task_lists (id, team_key, date, branch_id, status)
       VALUES ($1, $2, $3, $4, 'open')`,
      [listId, teamKey, date, branchId],
    );

    const preview = await previewPlanningDayCycleClose({ branchId, date, teamKey });
    assert.equal(preview.summary.contactTargetsClosed, 1);
    assert.equal(preview.summary.tasksReleased, 1);
    assert.equal(preview.summary.taskListsClosed, 1);
    assert.equal(preview.summary.linksClosed, 1);

    const closed = await closePlanningDayCycle({
      branchId,
      date,
      teamKey,
      closedBy: null,
      reason: 'plan_ended_manual',
    });
    assert.equal(closed.alreadyClosed, false);
    assert.deepEqual(closed.summary, preview.summary);

    const repeated = await closePlanningDayCycle({
      branchId,
      date,
      teamKey,
      closedBy: null,
      reason: 'plan_ended_manual',
    });
    assert.equal(repeated.alreadyClosed, true);
    assert.deepEqual(repeated.summary, closed.summary);

    const state = await pool.query(
      `SELECT
         ot.status AS "taskStatus",
         ot.assigned_team_key AS "assignedTeamKey",
         ct.status AS "targetStatus",
         ct.closing_reason AS "closingReason",
         ctot.link_status AS "linkStatus",
         tl.status AS "listStatus",
         pdc.status AS "cycleStatus",
         (SELECT COUNT(*)::int FROM task_activity_log tal
           WHERE tal.task_id = ot.id AND tal.reason = 'plan_ended_manual') AS "auditCount"
       FROM open_tasks ot
       JOIN contact_targets ct ON ct.id = $2
       JOIN contact_target_open_tasks ctot ON ctot.open_task_id = ot.id AND ctot.contact_target_id = ct.id
       JOIN telemarketing_task_lists tl ON tl.id = $3
       JOIN planning_day_cycles pdc
         ON pdc.branch_id = $4 AND pdc.planning_date = $5::date AND pdc.team_key = $6
       WHERE ot.id = $1`,
      [taskId, targetId, listId, branchId, date, teamKey],
    );
    assert.deepEqual(state.rows[0], {
      taskStatus: 'open',
      assignedTeamKey: null,
      targetStatus: 'closed',
      closingReason: 'plan_ended_manual',
      linkStatus: 'closed',
      listStatus: 'closed',
      cycleStatus: 'closed',
      auditCount: 1,
    });
  } finally {
    if (taskId != null) {
      await pool.query('DELETE FROM task_activity_log WHERE task_id = $1', [taskId]);
    }
    await pool.query('DELETE FROM telemarketing_task_lists WHERE id = $1', [listId]);
    if (targetId != null) {
      await pool.query('DELETE FROM contact_target_open_tasks WHERE contact_target_id = $1', [targetId]);
      await pool.query('DELETE FROM contact_targets WHERE id = $1', [targetId]);
    }
    if (taskId != null) {
      await pool.query('DELETE FROM open_tasks WHERE id = $1', [taskId]);
    }
    await pool.query(
      `DELETE FROM planning_day_cycles
       WHERE branch_id = $1 AND planning_date = $2::date AND team_key = $3`,
      [branchId, date, teamKey],
    );
    const residue = await pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM telemarketing_task_lists WHERE id = $1) AS list,
         EXISTS (SELECT 1 FROM planning_day_cycles
           WHERE branch_id = $2 AND planning_date = $3::date AND team_key = $4) AS cycle`,
      [listId, branchId, date, teamKey],
    );
    assert.deepEqual(residue.rows[0], { list: false, cycle: false });
    await pool.end();
  }
});
