import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../db.js';
import { reassignVisitTeam, TeamReassignmentError } from './visitTeamReassignment.js';

// «الفريق الرديف» end to end on the live dev database (migration 478), with an
// isolated 2099 fixture that is removed afterwards. Fixture visits are written
// with triggers off so creating them notifies nobody; the change under test
// runs with every trigger on.

const DATE = '2099-11-01';
const TIME = '10:00';

test('reassigning a scheduled visit crew: validation, cascade, history, revert', async (t) => {
  const { rows: crews } = await pool.query(
    `WITH eligible AS (
       SELECT e.id, e.branch_id, LOWER(r.team_slot_type) AS slot, u.id AS hr_user_id
         FROM employees e
         JOIN hr_users u ON u.employee_id = e.id AND u.is_active
         JOIN roles r ON r.id = u.role_id
        WHERE e.status = 'active' AND LOWER(r.team_slot_type) IN ('supervisor', 'technician')
     )
     SELECT branch_id,
            array_agg(id ORDER BY id) FILTER (WHERE slot = 'supervisor') AS sups,
            array_agg(hr_user_id ORDER BY id) FILTER (WHERE slot = 'supervisor') AS sup_users,
            array_agg(id ORDER BY id) FILTER (WHERE slot = 'technician') AS techs
       FROM eligible GROUP BY branch_id
      HAVING count(*) FILTER (WHERE slot = 'supervisor') >= 3
         AND count(*) FILTER (WHERE slot = 'technician') >= 2
      ORDER BY branch_id LIMIT 1`,
  );
  const { rows: clientRows } = crews[0]
    ? await pool.query(
      `SELECT c.id FROM clients c
        WHERE c.branch_id = $1 AND NOT EXISTS (SELECT 1 FROM open_tasks ot WHERE ot.client_id = c.id)
        ORDER BY c.id LIMIT 1`,
      [crews[0].branch_id],
    )
    : { rows: [] as any[] };
  const { rows: reasonRows } = await pool.query(
    `SELECT id FROM system_lists WHERE category = 'visit_team_change_reasons' AND is_active ORDER BY display_order LIMIT 1`,
  );
  if (!crews[0] || !clientRows[0] || !reasonRows[0]) {
    t.skip('No branch with enough eligible crew, a free client, or the reason list');
    return;
  }
  const branchId = Number(crews[0].branch_id);
  const [s1, s2, s3] = crews[0].sups.map(Number);
  const [s1User, , s3User] = crews[0].sup_users.map(Number);
  const [t1, t2] = crews[0].techs.map(Number);
  const clientId = Number(clientRows[0].id);
  const reasonId = Number(reasonRows[0].id);
  const actor = s1User;
  const allow = () => true;

  const visitIds: number[] = [];
  let taskId: number | null = null;

  const insertVisit = async (teamKey: string, sup: number, tech: number, responsible: number | null) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      const { rows } = await client.query(
        `INSERT INTO field_visits (visit_type, visit_family, branch_id, client_id, status,
                                   scheduled_date, scheduled_time, team_snapshot, team_responsible_user_id)
         VALUES ('service', 'service', $1, $2, 'scheduled', $3::date, $4, $5::jsonb, $6)
         RETURNING id`,
        [branchId, clientId, DATE, TIME,
          JSON.stringify({ teamKey, supervisorEmployeeId: sup, technicianEmployeeId: tech, traineeEmployeeId: null, telemarketerEmployeeIds: [] }),
          responsible],
      );
      await client.query('COMMIT');
      visitIds.push(Number(rows[0].id));
      return Number(rows[0].id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  try {
    const visitA = await insertVisit('team_0', s1, t1, s1User);
    await insertVisit('team_1', s2, t2, null); // t2 is busy in the same slot

    const { rows: taskRows } = await pool.query(
      `INSERT INTO open_tasks (client_id, branch_id, task_type, task_family, reason, status, source, team_snapshot)
       VALUES ($1, $2, 'emergency_maintenance', 'service', 'service_request', 'scheduled', 'system', $3::jsonb)
       RETURNING id`,
      [clientId, branchId, JSON.stringify({ teamKey: 'team_0', supervisorEmployeeId: s1, technicianEmployeeId: t1 })],
    );
    taskId = Number(taskRows[0].id);
    await pool.query(
      `INSERT INTO visit_tasks (field_visit_id, source_open_task_id, task_type, task_family, status)
       VALUES ($1, $2, 'emergency_maintenance', 'service', 'pending')`,
      [visitA, taskId],
    );
    await pool.query(
      `INSERT INTO visit_scheduled_alerts (visit_id, responsible_user_id) VALUES ($1, $2)`,
      [visitA, s1User],
    );

    // 1) a busy replacement is rejected
    await assert.rejects(
      reassignVisitTeam({ visitId: visitA, members: { supervisor: s1, technician: t2, trainee: null }, reasonId, actorUserId: actor, canReassignInBranch: allow }),
      (e: unknown) => e instanceof TeamReassignmentError && e.statusCode === 409 && /زيارة أخرى/.test(e.message),
    );

    // 2) no change is rejected
    await assert.rejects(
      reassignVisitTeam({ visitId: visitA, members: { supervisor: s1, technician: t1, trainee: null }, reasonId, actorUserId: actor, canReassignInBranch: allow }),
      /لا يوجد تغيير/,
    );

    // 3) replacing the supervisor
    await reassignVisitTeam({
      visitId: visitA, members: { supervisor: s3, technician: t1, trainee: null },
      reasonId, note: 'اختبار', actorUserId: actor, canReassignInBranch: allow,
    });
    const { rows: [v] } = await pool.query(
      `SELECT reassigned_supervisor_id, reassigned_technician_id, team_responsible_user_id,
              reassigned_team_snapshot, reassigned_by
         FROM field_visits WHERE id = $1`,
      [visitA],
    );
    assert.equal(v.reassigned_supervisor_id, s3);
    assert.equal(v.reassigned_technician_id, t1);
    assert.equal(v.team_responsible_user_id, s3User, 'responsible follows the new supervisor');
    assert.equal(v.reassigned_team_snapshot.supervisorEmployeeId, s3);
    assert.equal(v.reassigned_by, actor);

    const { rows: [alert] } = await pool.query('SELECT responsible_user_id FROM visit_scheduled_alerts WHERE visit_id = $1', [visitA]);
    assert.equal(alert.responsible_user_id, s3User, 'pending alert moved to the new responsible');

    const { rows: [task] } = await pool.query('SELECT team_snapshot FROM open_tasks WHERE id = $1', [taskId]);
    assert.equal(task.team_snapshot.supervisorEmployeeId, s3, 'linked task carries the new crew');

    const { rows: teamLog } = await pool.query(
      `SELECT context, reason FROM task_activity_log WHERE task_id = $1 AND event_type = 'team_changed'`,
      [taskId],
    );
    assert.equal(teamLog.length, 1);
    assert.equal(teamLog[0].context, 'visit_team_change');
    assert.ok(teamLog[0].reason, 'reason label recorded on the task log');

    const { rows: history } = await pool.query(
      `SELECT id, from_team, to_team, from_responsible_user_id, to_responsible_user_id, note
         FROM field_visit_team_changes WHERE field_visit_id = $1`,
      [visitA],
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].from_team.supervisorEmployeeId, s1);
    assert.equal(history[0].to_team.supervisorEmployeeId, s3);
    assert.equal(history[0].note, 'اختبار');

    const { rows: outbox } = await pool.query(
      `SELECT 1 FROM app_notification_outbox WHERE entity_type = 'field_visit_team_change' AND entity_id = $1`,
      [history[0].id],
    );
    assert.equal(outbox.length, 1, 'customer notification queued');

    // 4) the new supervisor now occupies the slot by person, not by team key
    await assert.rejects(
      pool.query(
        `INSERT INTO field_visits (visit_type, visit_family, branch_id, client_id, status,
                                   scheduled_date, scheduled_time, team_snapshot)
         VALUES ('service', 'service', $1, $2, 'scheduled', $3::date, $4, $5::jsonb)`,
        [branchId, clientId, DATE, TIME,
          JSON.stringify({ teamKey: 'team_9', supervisorEmployeeId: s3, technicianEmployeeId: null })],
      ),
      (e: any) => e?.code === '23505' && e?.constraint === 'uq_field_visits_team_slot',
    );

    // 5) reverting to the original crew is an ordinary, recorded change
    await reassignVisitTeam({
      visitId: visitA, members: { supervisor: s1, technician: t1, trainee: null },
      reasonId, actorUserId: actor, canReassignInBranch: allow,
    });
    const { rows: [reverted] } = await pool.query(
      `SELECT reassigned_supervisor_id, reassigned_team_snapshot, team_responsible_user_id FROM field_visits WHERE id = $1`,
      [visitA],
    );
    assert.equal(reverted.reassigned_supervisor_id, null);
    assert.equal(reverted.reassigned_team_snapshot, null);
    assert.equal(reverted.team_responsible_user_id, s1User);
    const { rows: [{ count }] } = await pool.query(
      'SELECT count(*)::int AS count FROM field_visit_team_changes WHERE field_visit_id = $1',
      [visitA],
    );
    assert.equal(count, 2);

    // 6) only a scheduled visit can change crew
    await pool.query(`UPDATE field_visits SET status = 'in_progress' WHERE id = $1`, [visitA]);
    await assert.rejects(
      reassignVisitTeam({ visitId: visitA, members: { supervisor: s3, technician: t1, trainee: null }, reasonId, actorUserId: actor, canReassignInBranch: allow }),
      (e: unknown) => e instanceof TeamReassignmentError && e.statusCode === 409,
    );

    // 7) branch scope is checked before anything changes
    await pool.query(`UPDATE field_visits SET status = 'scheduled' WHERE id = $1`, [visitA]);
    await assert.rejects(
      reassignVisitTeam({ visitId: visitA, members: { supervisor: s3, technician: t1, trainee: null }, reasonId, actorUserId: actor, canReassignInBranch: () => false }),
      (e: unknown) => e instanceof TeamReassignmentError && e.statusCode === 403,
    );
  } finally {
    // Normal mode on purpose: replica mode would also skip the FK cascades
    // (history, alerts, task log) and leave orphans behind.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (visitIds.length) {
        await client.query(
          `DELETE FROM app_notification_outbox
            WHERE (entity_type = 'field_visit' AND entity_id = ANY($1::bigint[]))
               OR (entity_type = 'field_visit_team_change' AND entity_id IN (
                    SELECT id FROM field_visit_team_changes WHERE field_visit_id = ANY($1::bigint[])))`,
          [visitIds],
        );
        await client.query('DELETE FROM visit_tasks WHERE field_visit_id = ANY($1::bigint[])', [visitIds]);
        // The crew swaps used real employees: drop the fixture events from their timelines (migration 480).
        await client.query(
          `DELETE FROM employee_activity_log
            WHERE event_type IN ('visit_crew_added', 'visit_crew_removed') AND reference_id = ANY($1::bigint[])`,
          [visitIds],
        );
        await client.query('DELETE FROM field_visits WHERE id = ANY($1::bigint[])', [visitIds]);
      }
      if (taskId) await client.query('DELETE FROM open_tasks WHERE id = $1', [taskId]);
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
