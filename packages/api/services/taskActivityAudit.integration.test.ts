import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import { runWithChangeContext } from '../auditContext.js';

// Migration 475: the open_tasks triggers own the task activity log, hand-written
// rows merge into them, and visit task results keep every revision.
// Runs against the live dev database with an isolated fixture it removes.

async function logRows(taskId: number) {
  const { rows } = await pool.query(
    `SELECT event_type, old_value, new_value, performed_by, role, reason, source, context
       FROM task_activity_log WHERE task_id = $1 ORDER BY id`,
    [taskId],
  );
  return rows;
}

test('task activity log is written by the database, merged and attributed', async (t) => {
  const { rows: subject } = await pool.query(
    `SELECT c.id AS client_id, c.branch_id,
            (SELECT id FROM hr_users ORDER BY id LIMIT 1) AS user_id
       FROM clients c
      WHERE c.branch_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM open_tasks ot WHERE ot.client_id = c.id)
      ORDER BY c.id LIMIT 1`,
  );
  if (!subject[0]?.user_id) {
    t.skip('No branch-owned client / user available for an isolated fixture');
    return;
  }
  const clientId = Number(subject[0].client_id);
  const branchId = Number(subject[0].branch_id);
  const userId = Number(subject[0].user_id);
  const taskIds: number[] = [];

  // A request context with an actor, opened exactly as the middleware does.
  const { auditContextMiddleware, setAuditActor } = await import('../auditContext.js');
  const asUser = <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      auditContextMiddleware({} as any, {} as any, () => {
        setAuditActor(userId, 'audit_test_role');
        fn().then(resolve, reject);
      });
    });

  // One active task per (client, type) is enforced, so each fixture gets its own type.
  const fixtureTypes = ['device_demo', 'gift_delivery', 'golden_warranty_offer'];
  const createTask = async () => {
    const taskType = fixtureTypes[taskIds.length];
    const { rows } = await pool.query(
      `INSERT INTO open_tasks (client_id, branch_id, task_type, task_family, reason, status, source, due_date)
       VALUES ($1, $2, $3, 'marketing', 'new_lead', 'open', 'system', '2099-01-01')
       RETURNING id`,
      [clientId, branchId, taskType],
    );
    taskIds.push(Number(rows[0].id));
    return Number(rows[0].id);
  };

  try {
    // 1) creation + plain status change inside a request → actor attributed
    const taskA = await asUser(async () => {
      const id = await createTask();
      await pool.query(`UPDATE open_tasks SET status = 'assigned' WHERE id = $1`, [id]);
      await pool.query(`UPDATE open_tasks SET due_date = '2099-02-02' WHERE id = $1`, [id]);
      return id;
    });
    let rows = await logRows(taskA);
    assert.deepEqual(rows.map((r) => r.event_type), ['created', 'status_change', 'rescheduled']);
    assert.equal(rows[0].new_value, 'open');
    assert.equal(rows[1].old_value, 'open');
    assert.equal(rows[1].new_value, 'assigned');
    assert.equal(rows[2].old_value, '2099-01-01');
    assert.equal(rows[2].new_value, '2099-02-02');
    for (const r of rows) {
      assert.equal(r.performed_by, userId);
      assert.equal(r.role, 'audit_test_role');
      assert.equal(r.source, 'trigger');
    }

    // 2) outside any request → system, and no actor leaks from the pooled connection
    await pool.query(`UPDATE open_tasks SET status = 'open' WHERE id = $1`, [taskA]);
    rows = await logRows(taskA);
    const sys = rows[rows.length - 1];
    assert.equal(sys.performed_by, null);
    assert.equal(sys.role, 'system');

    // 3) hand-written row AFTER the update → merged (reason kept, real old value kept)
    await asUser(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE open_tasks SET status = 'cancelled' WHERE id = $1`, [taskA]);
        await client.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value, reason)
           VALUES ($1, 'status_change', $2, 'x', NULL, 'cancelled', 'سبب يدوي')`,
          [taskA, userId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
    rows = (await logRows(taskA)).filter((r) => r.new_value === 'cancelled');
    assert.equal(rows.length, 1, 'no duplicate row');
    assert.equal(rows[0].old_value, 'open');
    assert.equal(rows[0].reason, 'سبب يدوي');

    // 3b) UPDATE and hand-written row as separate autocommit statements → still one row
    await asUser(async () => {
      await pool.query(`UPDATE open_tasks SET priority = 'high' WHERE id = $1`, [taskA]);
      await pool.query(
        `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
         VALUES ($1, 'priority_changed', $2, 'x', NULL, 'high')`,
        [taskA, userId],
      );
    });
    rows = (await logRows(taskA)).filter((r) => r.event_type === 'priority_changed');
    assert.equal(rows.length, 1, 'no duplicate across autocommit statements');

    // 3c) team: assignment by key, same crew via snapshot (silent), release
    const { rows: sched } = await pool.query(
      `SELECT date FROM day_schedules
        WHERE jsonb_typeof(teams) = 'array' AND jsonb_array_length(teams) > 0
          AND date ~ '^\\d{4}-\\d{2}-\\d{2}$'
        ORDER BY date DESC LIMIT 1`,
    );
    if (sched[0]) {
      const forDate = sched[0].date as string;
      const { rows: slot } = await pool.query(
        `SELECT teams->0->>'supervisor' AS supervisor, teams->0->>'technician' AS technician
           FROM day_schedules WHERE date = $1`,
        [forDate],
      );
      await asUser(async () => {
        await pool.query(
          `UPDATE open_tasks SET assigned_team_key = 'team_0', assigned_for_date = $2::date WHERE id = $1`,
          [taskA, forDate],
        );
        await pool.query(
          `UPDATE open_tasks SET team_snapshot = jsonb_build_object(
             'teamKey', 'team_0',
             'supervisorEmployeeId', $2::int,
             'technicianEmployeeId', $3::int,
             'telemarketerEmployeeIds', '[]'::jsonb)
           WHERE id = $1`,
          [taskA, slot[0].supervisor, slot[0].technician],
        );
        await pool.query(
          `UPDATE open_tasks SET assigned_team_key = NULL, assigned_for_date = NULL, team_snapshot = NULL WHERE id = $1`,
          [taskA],
        );
      });
      rows = (await logRows(taskA)).filter((r) => r.event_type === 'team_changed');
      assert.equal(rows.length, 2, 'assign + release; same crew via snapshot is silent');
      assert.equal(rows[0].old_value, null);
      assert.match(rows[0].new_value, /^(مشرف|فني): /);
      assert.equal(rows[1].old_value, rows[0].new_value);
      assert.equal(rows[1].new_value, null);
      assert.equal(rows[0].performed_by, userId);
    }

    // 4) hand-written row BEFORE the update with a wrong (NULL) old value → corrected
    const taskB = await asUser(async () => {
      const id = await createTask();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO task_activity_log (task_id, event_type, performed_by, role, old_value, new_value)
           VALUES ($1, 'status_change', $2, 'x', NULL, 'needs_follow_up')`,
          [id, userId],
        );
        await client.query(`UPDATE open_tasks SET status = 'needs_follow_up' WHERE id = $1`, [id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return id;
    });
    rows = (await logRows(taskB)).filter((r) => r.event_type === 'status_change');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].old_value, 'open');
    assert.equal(rows[0].source, 'trigger');

    // 5) bulk update → one row per task, with change context
    const taskC = await createTask();
    await asUser(() => runWithChangeContext({ changeContext: 'visit_result', changeReason: 'bulk' }, async () => {
      await pool.query(`UPDATE open_tasks SET status = 'completed' WHERE id = ANY($1::int[])`, [[taskB, taskC]]);
    }));
    for (const id of [taskB, taskC]) {
      const done = (await logRows(id)).filter((r) => r.new_value === 'completed');
      assert.equal(done.length, 1);
      assert.equal(done[0].context, 'visit_result');
      assert.equal(done[0].reason, 'bulk');
    }
  } finally {
    if (taskIds.length) {
      await pool.query(`DELETE FROM open_tasks WHERE id = ANY($1::int[])`, [taskIds]);
    }
  }
});

test('editing a visit task result keeps the original revision', async (t) => {
  const { rows: subject } = await pool.query(
    `SELECT r.id, r.visit_task_id, r.closing_notes, vt.source_open_task_id AS open_task_id,
            (SELECT max(revision_no) FROM visit_task_result_revisions x WHERE x.visit_task_id = r.visit_task_id) AS last_no,
            (SELECT id FROM hr_users ORDER BY id LIMIT 1) AS user_id
       FROM visit_task_results r
       JOIN visit_tasks vt ON vt.id = r.visit_task_id
      WHERE vt.source_open_task_id IS NOT NULL
      ORDER BY r.id LIMIT 1`,
  );
  if (!subject[0]?.last_no) {
    t.skip('No recorded visit task result with a baseline revision');
    return;
  }
  const s = subject[0];
  const { auditContextMiddleware, setAuditActor } = await import('../auditContext.js');
  const { rows: maxLog } = await pool.query(`SELECT COALESCE(max(id), 0) AS id FROM task_activity_log`);
  const logBaseline = Number(maxLog[0].id);

  try {
    await new Promise<void>((resolve, reject) => {
      auditContextMiddleware({} as any, {} as any, () => {
        setAuditActor(Number(s.user_id), 'audit_test_role');
        runWithChangeContext({ changeContext: 'result_edit', changeReason: 'تصحيح خطأ إدخال' }, async () => {
          await pool.query(
            `UPDATE visit_task_results SET closing_notes = COALESCE(closing_notes, '') || ' [audit-test]' WHERE id = $1`,
            [s.id],
          );
        }).then(resolve, reject);
      });
    });

    const { rows: revisions } = await pool.query(
      `SELECT revision_no, edit_reason, recorded_by, payload
         FROM visit_task_result_revisions WHERE visit_task_id = $1 ORDER BY revision_no`,
      [s.visit_task_id],
    );
    const last = revisions[revisions.length - 1];
    const previous = revisions[revisions.length - 2];
    assert.equal(last.revision_no, Number(s.last_no) + 1);
    assert.equal(last.edit_reason, 'تصحيح خطأ إدخال');
    assert.equal(last.recorded_by, Number(s.user_id));
    assert.match(last.payload.result.closing_notes, /\[audit-test\]$/);
    assert.equal(previous.payload.result.closing_notes ?? null, s.closing_notes ?? null, 'original kept intact');

    const { rows: edited } = await pool.query(
      `SELECT event_type, reason, context FROM task_activity_log
        WHERE id > $1 AND task_id = $2 AND event_type = 'result_edited'`,
      [logBaseline, s.open_task_id],
    );
    assert.equal(edited.length, 1);
    assert.equal(edited[0].context, 'result_edit');

    await assert.rejects(
      pool.query(`UPDATE visit_task_result_revisions SET edit_reason = 'x' WHERE visit_task_id = $1`, [s.visit_task_id]),
      /append-only/,
    );
  } finally {
    // Restore the fixture without producing another revision.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL session_replication_role = replica`);
      await client.query(`UPDATE visit_task_results SET closing_notes = $2 WHERE id = $1`, [s.id, s.closing_notes]);
      await client.query(
        `DELETE FROM visit_task_result_revisions WHERE visit_task_id = $1 AND revision_no > $2`,
        [s.visit_task_id, s.last_no],
      );
      await client.query(`DELETE FROM task_activity_log WHERE id > $1 AND task_id = $2 AND event_type = 'result_edited'`, [logBaseline, s.open_task_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
});

test.after(async () => {
  await pool.end();
});
